import type { PackagedPortableExportEvidence } from "./verify-packaged-portable-export.ts";

export const PACKAGED_BACKUP_PHASES = [
  "configure",
  "restart",
  "reconfigure",
  "restore",
] as const;

export type PackagedBackupPhase = typeof PACKAGED_BACKUP_PHASES[number];

export const requiredAssertionsByPhase: Readonly<
  Record<PackagedBackupPhase, readonly string[]>
> = {
  configure: [
    "fixture-seeded",
    "manual-export-created",
    "transient-scope-seeded-and-readable",
    "folder-a-test-activated",
  ],
  restart: [
    "configured-before-picker",
    "archive-listed-and-readable-before-picker",
    "archive-name-traversal-denied",
    "ambient-parent-and-sibling-plugin-fs-reads-denied",
    "wrong-hash-removal-denied",
    "right-hash-removal-succeeded",
    "stale-transient-scope-denied",
    "manual-export-replaced",
    "fake-export-token-denied",
    "old-folder-probe-created",
  ],
  reconfigure: [
    "folder-b-test-activated",
    "old-folder-backup-api-read-denied",
    "old-folder-plugin-fs-read-denied",
    "eight-to-seven-retention",
    "foreign-bytes-untouched",
    "restore-target-recorded",
  ],
  restore: [
    "deleted-essay-previewed",
    "merge-applied",
    "essay-count-restored",
    "relationships-restored",
    "figure-bytes-restored",
    "completed",
  ],
};

export interface PackagedBackupPhaseEvidence {
  schemaVersion: 1;
  phase: PackagedBackupPhase;
  featureSha: string;
  bundleIdentifier: string;
  appVersion: string;
  passed: true;
  selectionInvocations: number;
  assertions: string[];
  archiveNames?: string[];
  exportPath?: string;
}

export interface IndependentPackagedBackupEvidence {
  processExitCodes: number[];
  executableSha256: string;
  packageSha256: string;
  manualExportSha256AfterConfigure: string;
  manualExportSha256AfterRestart: string;
  configuredExport: PackagedPortableExportEvidence;
  restartedExport: PackagedPortableExportEvidence;
  sentinelHashesBefore: Record<string, string>;
  sentinelHashesAfter: Record<string, string>;
  oldFolderSnapshotBefore: Record<string, string>;
  oldFolderSnapshotAfter: Record<string, string>;
  activeArchiveNames: string[];
  foreignFileName: string;
  restoredLibrary: PackagedPortableExportEvidence;
}

export interface VerifyPackagedBackupSmokeInput {
  expected: {
    featureSha: string;
    bundleIdentifier: string;
    appVersion: string;
    exportPath: string;
  };
  phases: PackagedBackupPhaseEvidence[];
  independent: IndependentPackagedBackupEvidence;
}

export interface PackagedBackupSmokeResult {
  passed: true;
  evidence: "packaged-backup-smoke";
  featureSha: string;
  bundleIdentifier: string;
  appVersion: string;
  processLaunches: 4;
  retainedArchives: 7;
  executableSha256: string;
  packageSha256: string;
  manualExportSha256AfterConfigure: string;
  manualExportSha256AfterRestart: string;
  restoredLibrary: PackagedPortableExportEvidence;
}

function requireSha256(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`packaged backup smoke has an invalid ${label} SHA-256`);
  }
}

function equalRecord(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const rightEntries = Object.entries(right).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

/**
 * Combines phase reports with observations made outside the packaged process.
 * Paths remain input-only so the published result is privacy-safe.
 */
export function verifyPackagedBackupSmoke(
  input: VerifyPackagedBackupSmokeInput,
): PackagedBackupSmokeResult {
  const { expected, independent, phases } = input;
  if (phases.length !== PACKAGED_BACKUP_PHASES.length) {
    throw new Error("packaged backup smoke requires four phase reports");
  }
  if (
    independent.processExitCodes.length !== PACKAGED_BACKUP_PHASES.length ||
    independent.processExitCodes.some((code) => code !== 0)
  ) {
    throw new Error(
      "packaged backup smoke requires four successful packaged launches",
    );
  }

  for (let index = 0; index < PACKAGED_BACKUP_PHASES.length; index += 1) {
    const expectedPhase = PACKAGED_BACKUP_PHASES[index];
    const evidence = phases[index];
    if (evidence?.phase !== expectedPhase || evidence.schemaVersion !== 1) {
      throw new Error(
        `packaged backup smoke is missing ${expectedPhase} evidence`,
      );
    }
    if (!evidence.passed) {
      throw new Error(`${expectedPhase} did not pass`);
    }
    if (evidence.featureSha !== expected.featureSha) {
      throw new Error(`${expectedPhase} used the wrong feature SHA`);
    }
    if (evidence.bundleIdentifier !== expected.bundleIdentifier) {
      throw new Error(`${expectedPhase} used the wrong bundle identifier`);
    }
    if (evidence.appVersion !== expected.appVersion) {
      throw new Error(`${expectedPhase} used the wrong app version`);
    }

    const expectedSelections = expectedPhase === "configure" ||
        expectedPhase === "reconfigure"
      ? 1
      : 0;
    if (evidence.selectionInvocations !== expectedSelections) {
      const detail = expectedSelections === 0
        ? "unexpectedly invoked folder selection"
        : "did not invoke folder selection exactly once";
      throw new Error(`${expectedPhase} ${detail}`);
    }
    for (const assertion of requiredAssertionsByPhase[expectedPhase]) {
      if (!evidence.assertions.includes(assertion)) {
        throw new Error(`${expectedPhase} is missing assertion: ${assertion}`);
      }
    }
    if (
      (expectedPhase === "configure" || expectedPhase === "restart") &&
      evidence.exportPath !== expected.exportPath
    ) {
      throw new Error(`${expectedPhase} used the wrong manual export path`);
    }
  }

  for (
    const name of ["parent", "sibling", "exportSibling", "foreign", "transient"]
  ) {
    if (!(name in independent.sentinelHashesBefore)) {
      throw new Error(
        `packaged backup smoke missing required sentinel: ${name}`,
      );
    }
  }
  for (
    const [name, before] of Object.entries(independent.sentinelHashesBefore)
  ) {
    if (independent.sentinelHashesAfter[name] !== before) {
      throw new Error(`packaged backup smoke changed sentinel: ${name}`);
    }
    requireSha256(before, `${name} sentinel`);
  }
  if (
    Object.keys(independent.sentinelHashesBefore).length === 0 ||
    Object.keys(independent.sentinelHashesBefore).length !==
      Object.keys(independent.sentinelHashesAfter).length
  ) {
    throw new Error("packaged backup smoke has incomplete sentinel evidence");
  }
  if (
    !equalRecord(
      independent.oldFolderSnapshotBefore,
      independent.oldFolderSnapshotAfter,
    )
  ) {
    throw new Error("packaged backup smoke old backup folder changed");
  }
  if (
    !Object.keys(independent.oldFolderSnapshotBefore).some((path) =>
      path.endsWith(".tesina")
    )
  ) {
    throw new Error(
      "packaged backup smoke old backup folder snapshot has no archive",
    );
  }
  if (independent.activeArchiveNames.includes(independent.foreignFileName)) {
    throw new Error(
      "packaged backup smoke foreign evidence was classified as an owned archive",
    );
  }
  if (
    independent.activeArchiveNames.length !== 7 ||
    new Set(independent.activeArchiveNames).size !== 7
  ) {
    throw new Error(
      "packaged backup smoke did not retain exactly seven archives",
    );
  }
  const reconfigurePhase = phases[2];
  const expectedFolderNames = [
    ...independent.activeArchiveNames,
    independent.foreignFileName,
  ].sort();
  if (
    reconfigurePhase.archiveNames === undefined ||
    JSON.stringify([...reconfigurePhase.archiveNames].sort()) !==
      JSON.stringify(expectedFolderNames)
  ) {
    throw new Error("packaged backup smoke archive set did not match disk");
  }

  requireSha256(independent.executableSha256, "executable");
  requireSha256(independent.packageSha256, "package");
  requireSha256(
    independent.manualExportSha256AfterConfigure,
    "configure export",
  );
  requireSha256(
    independent.manualExportSha256AfterRestart,
    "restart export",
  );
  if (
    independent.manualExportSha256AfterConfigure ===
      independent.manualExportSha256AfterRestart
  ) {
    throw new Error(
      "packaged backup smoke restart did not replace the manual export",
    );
  }
  if (
    !independent.configuredExport.passed ||
    !independent.restartedExport.passed
  ) {
    throw new Error(
      "packaged backup smoke manual exports were not independently validated",
    );
  }
  requireSha256(
    independent.restoredLibrary.assetAggregateSha256,
    "restored asset aggregate",
  );
  if (!independent.restoredLibrary.passed) {
    throw new Error("packaged backup smoke restored library did not pass");
  }

  return {
    passed: true,
    evidence: "packaged-backup-smoke",
    featureSha: expected.featureSha,
    bundleIdentifier: expected.bundleIdentifier,
    appVersion: expected.appVersion,
    processLaunches: 4,
    retainedArchives: 7,
    executableSha256: independent.executableSha256,
    packageSha256: independent.packageSha256,
    manualExportSha256AfterConfigure:
      independent.manualExportSha256AfterConfigure,
    manualExportSha256AfterRestart: independent.manualExportSha256AfterRestart,
    restoredLibrary: independent.restoredLibrary,
  };
}

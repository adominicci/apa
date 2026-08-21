import { describe, expect, it } from "vitest";
import type { PackagedPortableExportEvidence } from "./verify-packaged-portable-export.ts";
import {
  PACKAGED_BACKUP_PHASES,
  requiredAssertionsByPhase,
  verifyPackagedBackupSmoke,
  type VerifyPackagedBackupSmokeInput,
} from "./verify-packaged-backup-smoke.ts";

const SHA = "a".repeat(40);
const IDENTIFIER = `app.tesina.desktop.backup-smoke.${"b".repeat(32)}`;
const HASH = "c".repeat(64);

const restoredLibrary: PackagedPortableExportEvidence = {
  passed: true,
  evidence: "packaged-portable-export-reopen",
  counts: { essays: 16, references: 30, collections: 1, assets: 38 },
  relationships: { citationNodes: 54, citationItems: 63, figures: 38 },
  assetBytes: 95_818,
  assetAggregateSha256: "d".repeat(64),
};

function validInput(): VerifyPackagedBackupSmokeInput {
  return {
    expected: {
      featureSha: SHA,
      bundleIdentifier: IDENTIFIER,
      appVersion: "0.1.19",
      exportPath: "/owned/export/Tesina Library.tesina",
    },
    phases: PACKAGED_BACKUP_PHASES.map((phase) => ({
      schemaVersion: 1,
      phase,
      featureSha: SHA,
      bundleIdentifier: IDENTIFIER,
      appVersion: "0.1.19",
      passed: true,
      selectionInvocations: phase === "configure" || phase === "reconfigure"
        ? 1
        : 0,
      assertions: [...requiredAssertionsByPhase[phase]],
      ...(phase === "reconfigure"
        ? {
          archiveNames: [
            ...Array.from(
              { length: 7 },
              (_, index) => `Tesina Backup ${index}.tesina`,
            ),
            "Foreign Evidence.tesina",
          ],
        }
        : {}),
      ...(phase === "configure" || phase === "restart"
        ? { exportPath: "/owned/export/Tesina Library.tesina" }
        : {}),
    })),
    independent: {
      processExitCodes: [0, 0, 0, 0],
      executableSha256: HASH,
      packageSha256: "e".repeat(64),
      manualExportSha256AfterConfigure: "f".repeat(64),
      manualExportSha256AfterRestart: "1".repeat(64),
      configuredExport: restoredLibrary,
      restartedExport: restoredLibrary,
      sentinelHashesBefore: {
        parent: "2".repeat(64),
        sibling: "3".repeat(64),
        exportSibling: "4".repeat(64),
        foreign: "5".repeat(64),
        transient: "7".repeat(64),
      },
      sentinelHashesAfter: {
        parent: "2".repeat(64),
        sibling: "3".repeat(64),
        exportSibling: "4".repeat(64),
        foreign: "5".repeat(64),
        transient: "7".repeat(64),
      },
      oldFolderSnapshotBefore: {
        "Tesina Backups/owned-1.tesina": "6".repeat(64),
      },
      oldFolderSnapshotAfter: {
        "Tesina Backups/owned-1.tesina": "6".repeat(64),
      },
      activeArchiveNames: Array.from(
        { length: 7 },
        (_, index) => `Tesina Backup ${index}.tesina`,
      ),
      foreignFileName: "Foreign Evidence.tesina",
      restoredLibrary,
    },
  };
}

describe("packaged backup smoke verification", () => {
  it("requires the exact assertions emitted by the packaged runtime phases", () => {
    expect(requiredAssertionsByPhase).toEqual({
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
    });
  });

  it("accepts four successful launches with exact restart, retention, and restore evidence", () => {
    expect(verifyPackagedBackupSmoke(validInput())).toMatchObject({
      passed: true,
      evidence: "packaged-backup-smoke",
      featureSha: SHA,
      bundleIdentifier: IDENTIFIER,
      appVersion: "0.1.19",
      processLaunches: 4,
      retainedArchives: 7,
      restoredLibrary,
      executableSha256: HASH,
      packageSha256: "e".repeat(64),
    });
  });

  it("rejects a restart that selected a folder again", () => {
    const input = validInput();
    input.phases[1]!.selectionInvocations = 1;

    expect(() => verifyPackagedBackupSmoke(input)).toThrow(
      "restart unexpectedly invoked folder selection",
    );
  });

  it("rejects missing phase assertions or a mismatched feature SHA", () => {
    const missing = validInput();
    missing.phases[2]!.assertions = [];
    expect(() => verifyPackagedBackupSmoke(missing)).toThrow(
      "reconfigure is missing assertion",
    );

    const wrongSha = validInput();
    wrongSha.phases[3]!.featureSha = "9".repeat(40);
    expect(() => verifyPackagedBackupSmoke(wrongSha)).toThrow(
      "restore used the wrong feature SHA",
    );
  });

  it("rejects changed sentinels, old-folder writes, and foreign retention targets", () => {
    const changedSentinel = validInput();
    changedSentinel.independent.sentinelHashesAfter.sibling = "9".repeat(64);
    expect(() => verifyPackagedBackupSmoke(changedSentinel)).toThrow(
      "changed sentinel: sibling",
    );

    const changedOldFolder = validInput();
    changedOldFolder.independent.oldFolderSnapshotAfter[
      "Tesina Backups/owned-2.tesina"
    ] = "8".repeat(64);
    expect(() => verifyPackagedBackupSmoke(changedOldFolder)).toThrow(
      "old backup folder changed",
    );

    const retainedForeign = validInput();
    retainedForeign.independent.activeArchiveNames.push(
      "Foreign Evidence.tesina",
    );
    expect(() => verifyPackagedBackupSmoke(retainedForeign)).toThrow(
      "foreign evidence was classified as an owned archive",
    );

    const missingTransient = validInput();
    delete missingTransient.independent.sentinelHashesBefore.transient;
    delete missingTransient.independent.sentinelHashesAfter.transient;
    expect(() => verifyPackagedBackupSmoke(missingTransient)).toThrow(
      "missing required sentinel: transient",
    );

    const emptyOldFolder = validInput();
    emptyOldFolder.independent.oldFolderSnapshotBefore = {};
    emptyOldFolder.independent.oldFolderSnapshotAfter = {};
    expect(() => verifyPackagedBackupSmoke(emptyOldFolder)).toThrow(
      "old backup folder snapshot has no archive",
    );
  });

  it("rejects fewer than four successful launches or a non-SHA artifact digest", () => {
    const failedProcess = validInput();
    failedProcess.independent.processExitCodes[2] = 1;
    expect(() => verifyPackagedBackupSmoke(failedProcess)).toThrow(
      "four successful packaged launches",
    );

    const invalidHash = validInput();
    invalidHash.independent.packageSha256 = "not-a-sha";
    expect(() => verifyPackagedBackupSmoke(invalidHash)).toThrow(
      "package SHA-256",
    );
  });

  it("requires two independently validated, distinct manual publications", () => {
    const unchanged = validInput();
    unchanged.independent.manualExportSha256AfterRestart =
      unchanged.independent.manualExportSha256AfterConfigure;
    expect(() => verifyPackagedBackupSmoke(unchanged)).toThrow(
      "restart did not replace the manual export",
    );

    const invalid = validInput();
    invalid.independent.restartedExport = {
      ...restoredLibrary,
      passed: false,
    } as never;
    expect(() => verifyPackagedBackupSmoke(invalid)).toThrow(
      "manual exports were not independently validated",
    );
  });
});

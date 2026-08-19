import type {
  BackupAdapterStatus,
  BackupRunOutcome,
} from "$lib/state/backup.svelte";
import type { PendingBackupConfiguration } from "./backupRuntime.ts";
import type { ImportApplyResult, ImportPreviewResult } from "./importFlow.ts";
import type { exportLibraryToChosenFile } from "./portableRuntime.ts";
import { fullLibraryFixture } from "$lib/portable/fixtures/libraries";
import { canonicalJsonBytes } from "$lib/portable/canonicalJson";
import { sha256Hex } from "$lib/portable/archive";
import { BACKUP_NAME_PATTERN } from "$lib/portable/retention";
import { collectFigureSources } from "$lib/portable/snapshot";

export type PackagedBackupSmokePhase =
  | "configure"
  | "restart"
  | "reconfigure"
  | "restore";

export const PACKAGED_BACKUP_SMOKE_STATE_PATH =
  "packaged-backup-smoke/state.json";
export const FOREIGN_EVIDENCE_FILE = "Foreign Evidence.tesina";
export const EVIDENCE_PATHS: Record<PackagedBackupSmokePhase, string> = {
  configure: "packaged-backup-smoke/evidence-configure.json",
  restart: "packaged-backup-smoke/evidence-restart.json",
  reconfigure: "packaged-backup-smoke/evidence-reconfigure.json",
  restore: "packaged-backup-smoke/evidence-restore.json",
};

const MAX_MARKER_BYTES = 64 * 1024;
const WRONG_SHA256 = "0".repeat(64);
const DEFAULT_EXPORT_NAME = "Tesina Library.tesina";

interface SmokeFolderState {
  canonicalFolderPath: string;
  backupSetId: string;
  testFileName: string;
  oldProbeFileName?: string;
}

export interface PackagedBackupSmokeStateV1 {
  schemaVersion: 1;
  completedPhase: PackagedBackupSmokePhase;
  featureSha: string;
  transientPath: string;
  transientSha256: string;
  exportPath: string;
  fixture: {
    deletedEssayId: string;
    essayCount: number;
    referenceCount: number;
    collectionCount: number;
    assetCount: number;
  };
  folderA: SmokeFolderState;
  folderB?: SmokeFolderState;
  restoreTarget?: string;
}

export interface PackagedBackupSmokeEvidenceV1 {
  schemaVersion: 1;
  phase: PackagedBackupSmokePhase;
  featureSha: string;
  bundleIdentifier: string;
  appVersion: string;
  passed: boolean;
  selectionInvocations: number;
  assertions: string[];
  archiveNames?: string[];
  exportPath?: string;
  errorCode?: string;
}

interface SmokeAppData {
  readBytes(path: string): Promise<Uint8Array | null>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  list(path: string): Promise<string[]>;
}

export interface PackagedBackupSmokeDeps {
  context(): Promise<{
    phase: PackagedBackupSmokePhase;
    proofCommitSha: string;
  }>;
  appVersion(): Promise<string>;
  bundleIdentifier(): Promise<string>;
  loadUiSettings(): Promise<void>;
  flushUiSettings(): Promise<void>;
  appData: SmokeAppData;
  exportLibrary: typeof exportLibraryToChosenFile;
  /** Feature-only native command: grants and returns one transient proof path. */
  seedTransientScope(): Promise<string>;
  /** Direct plugin-fs read for transient access and scope-denial proofs. */
  readExternalFile(path: string): Promise<Uint8Array>;
  /** Calls external_destination_exists with an intentionally fake token. */
  fakeDestinationExists(path: string): Promise<boolean>;
  pickAndBegin(): Promise<PendingBackupConfiguration | null>;
  /** Feature-only native process counter; resets on every packaged launch. */
  pickerCallCount(): Promise<number>;
  writeWizardTest(
    backupSetId: string,
  ): Promise<{ fileName: string; contentDigest: string }>;
  activate(
    test: { contentDigest: string },
  ): Promise<{ canonicalFolderPath: string; backupSetId: string }>;
  status(): Promise<BackupAdapterStatus>;
  listArchives(): Promise<{ fileName: string; byteLength: number }[]>;
  readArchive(fileName: string): Promise<Uint8Array>;
  removeArchive(fileName: string, expectedSha256: string): Promise<void>;
  runManual(): Promise<BackupRunOutcome>;
  previewBackup(fileName: string): Promise<ImportPreviewResult>;
  applyImport(confirmed: ImportPreviewResult): Promise<ImportApplyResult>;
  now(): number;
  sleep(milliseconds: number): Promise<void>;
  exit(code: number): Promise<void>;
  reportError(error: unknown): void;
}

function errorCode(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return error instanceof Error ? error.name : "unknown";
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`invalid packaged backup smoke ${label}`);
  }
  return value;
}

function requireCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`invalid packaged backup smoke ${label}`);
  }
  return value as number;
}

function parseFolder(value: unknown, label: string): SmokeFolderState {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid packaged backup smoke ${label}`);
  }
  const folder = value as Record<string, unknown>;
  const parsed: SmokeFolderState = {
    canonicalFolderPath: requireString(
      folder.canonicalFolderPath,
      `${label}.canonicalFolderPath`,
    ),
    backupSetId: requireString(folder.backupSetId, `${label}.backupSetId`),
    testFileName: requireString(folder.testFileName, `${label}.testFileName`),
  };
  if (folder.oldProbeFileName !== undefined) {
    parsed.oldProbeFileName = requireString(
      folder.oldProbeFileName,
      `${label}.oldProbeFileName`,
    );
  }
  return parsed;
}

function parseState(value: unknown): PackagedBackupSmokeStateV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid packaged backup smoke state");
  }
  const state = value as Record<string, unknown>;
  const fixture = state.fixture;
  if (
    fixture === null || typeof fixture !== "object" || Array.isArray(fixture)
  ) {
    throw new Error("invalid packaged backup smoke fixture state");
  }
  const counts = fixture as Record<string, unknown>;
  const completedPhase = state.completedPhase;
  if (
    completedPhase !== "configure" && completedPhase !== "restart" &&
    completedPhase !== "reconfigure" && completedPhase !== "restore"
  ) {
    throw new Error("invalid packaged backup smoke completed phase");
  }
  if (state.schemaVersion !== 1) {
    throw new Error("unsupported packaged backup smoke state");
  }
  return {
    schemaVersion: 1,
    completedPhase,
    featureSha: requireString(state.featureSha, "featureSha"),
    transientPath: requireString(state.transientPath, "transientPath"),
    transientSha256: requireString(
      state.transientSha256,
      "transientSha256",
    ),
    exportPath: requireString(state.exportPath, "exportPath"),
    fixture: {
      deletedEssayId: requireString(
        counts.deletedEssayId,
        "fixture.deletedEssayId",
      ),
      essayCount: requireCount(counts.essayCount, "fixture.essayCount"),
      referenceCount: requireCount(
        counts.referenceCount,
        "fixture.referenceCount",
      ),
      collectionCount: requireCount(
        counts.collectionCount,
        "fixture.collectionCount",
      ),
      assetCount: requireCount(counts.assetCount, "fixture.assetCount"),
    },
    folderA: parseFolder(state.folderA, "folderA"),
    ...(state.folderB === undefined
      ? {}
      : { folderB: parseFolder(state.folderB, "folderB") }),
    ...(state.restoreTarget === undefined ? {} : {
      restoreTarget: requireString(state.restoreTarget, "restoreTarget"),
    }),
  };
}

async function readBoundedState(
  appData: SmokeAppData,
): Promise<PackagedBackupSmokeStateV1 | null> {
  const bytes = await appData.readBytes(PACKAGED_BACKUP_SMOKE_STATE_PATH);
  if (bytes === null) return null;
  if (bytes.byteLength > MAX_MARKER_BYTES) {
    throw new Error("packaged backup smoke state exceeds 64 KiB");
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return parseState(JSON.parse(text));
}

async function writeBoundedJson(
  appData: SmokeAppData,
  path: string,
  value: unknown,
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2));
  if (bytes.byteLength > MAX_MARKER_BYTES) {
    throw new Error(`packaged backup smoke marker exceeds 64 KiB: ${path}`);
  }
  await appData.writeBytes(path, bytes);
}

async function mustReject(
  operation: () => Promise<unknown>,
  label: string,
  expectedCode?: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (expectedCode !== undefined && errorCode(error) !== expectedCode) {
      throw new Error(`${label} failed with ${errorCode(error)}`);
    }
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

function isFsScopeDenied(error: unknown): boolean {
  const message = typeof error === "string"
    ? error
    : error instanceof Error
    ? error.message
    : "";
  return message.startsWith("forbidden path:");
}

async function mustRejectFsScope(
  operation: () => Promise<unknown>,
  label: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (!isFsScopeDenied(error)) {
      throw new Error(`${label} did not fail at the plugin-fs scope`);
    }
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

function externalPathParts(path: string): {
  canonicalPath: string;
  parentPath: string;
  separator: "/" | "\\";
} {
  const canonicalPath = path.replace(/[\\/]+$/, "");
  const separatorIndex = Math.max(
    canonicalPath.lastIndexOf("/"),
    canonicalPath.lastIndexOf("\\"),
  );
  if (separatorIndex <= 0) {
    throw new Error("packaged backup smoke selected folder has no parent");
  }
  const separator = canonicalPath[separatorIndex];
  if (separator !== "/" && separator !== "\\") {
    throw new Error("packaged backup smoke selected folder has no separator");
  }
  return {
    canonicalPath,
    parentPath: canonicalPath.slice(0, separatorIndex),
    separator,
  };
}

function joinExternalPath(
  base: string,
  separator: "/" | "\\",
  ...segments: string[]
): string {
  return [base, ...segments].join(separator);
}

async function requirePickerCallCount(
  deps: PackagedBackupSmokeDeps,
  expected: number,
): Promise<number> {
  const actual = await deps.pickerCallCount();
  if (actual !== expected) {
    throw new Error(
      `packaged backup smoke expected ${expected} picker calls, got ${actual}`,
    );
  }
  return actual;
}

function requireConfigured(
  status: BackupAdapterStatus,
  expectedSetId: string,
): void {
  if (
    !status.configured || !status.folderAvailable ||
    status.backupSetId !== expectedSetId
  ) {
    throw new Error("packaged backup smoke configuration mismatch");
  }
}

async function seedFullFixture(appData: SmokeAppData): Promise<
  PackagedBackupSmokeStateV1["fixture"]
> {
  const fixture = fullLibraryFixture();
  for (const essay of fixture.essays) {
    await appData.writeBytes(
      `essays/${essay.id}.json`,
      canonicalJsonBytes(essay),
    );
  }
  await appData.writeBytes("library.json", canonicalJsonBytes(fixture.library));
  for (
    const [path, bytes] of Object.entries({
      ...fixture.assets,
      ...fixture.orphanAssets,
    })
  ) {
    await appData.writeBytes(path, bytes);
  }
  return {
    deletedEssayId: fixture.essays[0].id,
    essayCount: fixture.essays.length,
    referenceCount: fixture.library.references.length,
    collectionCount: fixture.library.collections.length,
    assetCount: Object.keys(fixture.assets).length,
  };
}

async function pickTestAndActivate(
  deps: PackagedBackupSmokeDeps,
): Promise<SmokeFolderState> {
  const pending = await deps.pickAndBegin();
  if (pending === null) {
    throw new Error("backup smoke folder selection cancelled");
  }
  const test = await deps.writeWizardTest(pending.backupSetId);
  const active = await deps.activate(test);
  if (
    active.backupSetId !== pending.backupSetId ||
    active.canonicalFolderPath !== pending.canonicalFolderPath
  ) {
    throw new Error("backup smoke activated a different pending folder");
  }
  requireConfigured(await deps.status(), pending.backupSetId);
  return {
    canonicalFolderPath: pending.canonicalFolderPath,
    backupSetId: pending.backupSetId,
    testFileName: test.fileName,
  };
}

async function runConfigure(
  deps: PackagedBackupSmokeDeps,
  featureSha: string,
): Promise<{
  state: PackagedBackupSmokeStateV1;
  assertions: string[];
  archiveNames: string[];
  exportPath: string;
  selectionInvocations: number;
}> {
  await requirePickerCallCount(deps, 0);
  if (await readBoundedState(deps.appData) !== null) {
    throw new Error("configure requires an empty packaged backup smoke state");
  }
  const fixture = await seedFullFixture(deps.appData);
  const exported = await deps.exportLibrary(DEFAULT_EXPORT_NAME);
  if (exported === null) {
    throw new Error("manual export selection was unavailable");
  }
  const transientPath = await deps.seedTransientScope();
  const transientBytes = await deps.readExternalFile(transientPath);
  if (transientBytes.byteLength === 0) {
    throw new Error("transient scope proof file is empty");
  }
  const folderA = await pickTestAndActivate(deps);
  const selectionInvocations = await requirePickerCallCount(deps, 1);
  const state: PackagedBackupSmokeStateV1 = {
    schemaVersion: 1,
    completedPhase: "configure",
    featureSha,
    transientPath,
    transientSha256: await sha256Hex(transientBytes),
    exportPath: exported.path,
    fixture,
    folderA,
  };
  return {
    state,
    assertions: [
      "fixture-seeded",
      "manual-export-created",
      "transient-scope-seeded-and-readable",
      "folder-a-test-activated",
    ],
    archiveNames: [folderA.testFileName],
    exportPath: exported.path,
    selectionInvocations,
  };
}

async function requirePriorState(
  deps: PackagedBackupSmokeDeps,
  featureSha: string,
  phase: PackagedBackupSmokePhase,
): Promise<PackagedBackupSmokeStateV1> {
  const state = await readBoundedState(deps.appData);
  if (state === null || state.completedPhase !== phase) {
    throw new Error(`packaged backup smoke expected completed ${phase}`);
  }
  if (state.featureSha !== featureSha) {
    throw new Error("packaged backup smoke commit changed between launches");
  }
  return state;
}

async function runRestart(
  deps: PackagedBackupSmokeDeps,
  featureSha: string,
): Promise<{
  state: PackagedBackupSmokeStateV1;
  assertions: string[];
  archiveNames: string[];
  exportPath: string;
  selectionInvocations: number;
}> {
  await requirePickerCallCount(deps, 0);
  const state = await requirePriorState(deps, featureSha, "configure");
  requireConfigured(await deps.status(), state.folderA.backupSetId);
  const before = await deps.listArchives();
  if (
    !before.some((archive) => archive.fileName === state.folderA.testFileName)
  ) {
    throw new Error("configured archive was not listed after restart");
  }
  const testBytes = await deps.readArchive(state.folderA.testFileName);
  if (testBytes.byteLength === 0) {
    throw new Error("configured archive was empty");
  }
  await mustReject(
    () => deps.readArchive("../Parent Evidence.bin"),
    "parent-path archive read",
    "invalid_file_name",
  );
  await mustReject(
    () => deps.readArchive("../Sibling/Sibling Evidence.bin"),
    "sibling-path archive read",
    "invalid_file_name",
  );
  const folderAPath = externalPathParts(state.folderA.canonicalFolderPath);
  await mustRejectFsScope(
    () =>
      deps.readExternalFile(
        joinExternalPath(
          folderAPath.parentPath,
          folderAPath.separator,
          "Parent Evidence.bin",
        ),
      ),
    "ambient parent evidence read",
  );
  await mustRejectFsScope(
    () =>
      deps.readExternalFile(
        joinExternalPath(
          folderAPath.parentPath,
          folderAPath.separator,
          "Sibling",
          "Sibling Evidence.bin",
        ),
      ),
    "ambient sibling evidence read",
  );
  await mustReject(
    () => deps.removeArchive(state.folderA.testFileName, WRONG_SHA256),
    "wrong-hash removal",
    "hash_mismatch",
  );
  await deps.removeArchive(
    state.folderA.testFileName,
    await sha256Hex(testBytes),
  );
  await mustRejectFsScope(
    () => deps.readExternalFile(state.transientPath),
    "stale transient scope read",
  );
  const exported = await deps.exportLibrary(DEFAULT_EXPORT_NAME);
  if (exported === null || exported.path !== state.exportPath) {
    throw new Error("manual export replacement used a different destination");
  }
  await mustReject(
    () => deps.fakeDestinationExists(state.exportPath),
    "fake export authorization",
  );
  const probe = await deps.runManual();
  if (probe.kind !== "success") {
    throw new Error(`old-folder probe backup failed: ${probe.kind}`);
  }
  await deps.readArchive(probe.fileName);
  state.completedPhase = "restart";
  state.folderA.oldProbeFileName = probe.fileName;
  return {
    state,
    assertions: [
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
    archiveNames: (await deps.listArchives()).map((archive) =>
      archive.fileName
    ),
    exportPath: exported.path,
    selectionInvocations: await requirePickerCallCount(deps, 0),
  };
}

async function waitForNextSecond(
  deps: PackagedBackupSmokeDeps,
  priorSecond: number,
): Promise<number> {
  const deadline = deps.now() + 2_500;
  while (deps.now() <= deadline) {
    const current = Math.floor(deps.now() / 1_000);
    if (current > priorSecond) return current;
    await deps.sleep(25);
  }
  throw new Error("clock did not advance to a distinct backup second");
}

async function runReconfigure(
  deps: PackagedBackupSmokeDeps,
  featureSha: string,
): Promise<{
  state: PackagedBackupSmokeStateV1;
  assertions: string[];
  archiveNames: string[];
  selectionInvocations: number;
}> {
  await requirePickerCallCount(deps, 0);
  const state = await requirePriorState(deps, featureSha, "restart");
  const folderB = await pickTestAndActivate(deps);
  const selectionInvocations = await requirePickerCallCount(deps, 1);
  if (
    folderB.backupSetId === state.folderA.backupSetId ||
    folderB.canonicalFolderPath === state.folderA.canonicalFolderPath
  ) {
    throw new Error("reconfiguration reused folder A identity");
  }
  const oldProbeFileName = requireString(
    state.folderA.oldProbeFileName,
    "folderA.oldProbeFileName",
  );
  await mustReject(
    () => deps.readArchive(oldProbeFileName),
    "old folder archive read",
  );
  const folderAPath = externalPathParts(state.folderA.canonicalFolderPath);
  await mustRejectFsScope(
    () =>
      deps.readExternalFile(
        joinExternalPath(
          folderAPath.canonicalPath,
          folderAPath.separator,
          "Tesina Backups",
          oldProbeFileName,
        ),
      ),
    "old folder plugin-fs archive read",
  );
  const foreignBefore = await deps.readArchive(FOREIGN_EVIDENCE_FILE);
  const foreignSha256 = await sha256Hex(foreignBefore);
  const created: string[] = [folderB.testFileName];
  let priorSecond = Math.floor(deps.now() / 1_000);
  for (let index = 0; index < 7; index += 1) {
    priorSecond = await waitForNextSecond(deps, priorSecond);
    const outcome = await deps.runManual();
    if (outcome.kind !== "success") {
      throw new Error(`manual backup ${index + 1} failed: ${outcome.kind}`);
    }
    created.push(outcome.fileName);
  }
  const archives = await deps.listArchives();
  const owned = archives.filter((archive) =>
    BACKUP_NAME_PATTERN.test(archive.fileName) &&
    archive.fileName.includes(` - ${folderB.backupSetId.slice(0, 8)} - `)
  );
  if (created.length !== 8 || owned.length !== 7) {
    throw new Error(
      `retention expected 8 created and 7 retained, got ${created.length}/${owned.length}`,
    );
  }
  if (!archives.some((archive) => archive.fileName === FOREIGN_EVIDENCE_FILE)) {
    throw new Error("foreign evidence file disappeared during retention");
  }
  const foreignAfter = await deps.readArchive(FOREIGN_EVIDENCE_FILE);
  if (await sha256Hex(foreignAfter) !== foreignSha256) {
    throw new Error("foreign evidence bytes changed during retention");
  }
  const restoreTarget = created.at(-1)!;
  if (!owned.some((archive) => archive.fileName === restoreTarget)) {
    throw new Error("newest backup was not retained for restore");
  }
  state.completedPhase = "reconfigure";
  state.folderB = folderB;
  state.restoreTarget = restoreTarget;
  return {
    state,
    assertions: [
      "folder-b-test-activated",
      "old-folder-backup-api-read-denied",
      "old-folder-plugin-fs-read-denied",
      "eight-to-seven-retention",
      "foreign-bytes-untouched",
      "restore-target-recorded",
    ],
    archiveNames: archives.map((archive) => archive.fileName).sort(),
    selectionInvocations,
  };
}

async function runRestore(
  deps: PackagedBackupSmokeDeps,
  featureSha: string,
): Promise<{
  state: PackagedBackupSmokeStateV1;
  assertions: string[];
  archiveNames: string[];
  selectionInvocations: number;
}> {
  await requirePickerCallCount(deps, 0);
  const state = await requirePriorState(deps, featureSha, "reconfigure");
  const restoreTarget = requireString(state.restoreTarget, "restoreTarget");
  const deletedPath = `essays/${state.fixture.deletedEssayId}.json`;
  if (await deps.appData.readBytes(deletedPath) !== null) {
    throw new Error("runner did not delete the restore-proof essay");
  }
  const preview = await deps.previewBackup(restoreTarget);
  if (
    preview.preview.essays.new !== 1 ||
    preview.preview.essays.conflicting !== 0 ||
    preview.preview.references.new !== 0 ||
    preview.preview.references.conflicting !== 0 ||
    preview.preview.collections.new !== 0 ||
    preview.preview.collections.conflicting !== 0 ||
    preview.preview.assets.added !== 0
  ) {
    throw new Error("restore preview did not isolate the deleted essay");
  }
  const applied = await deps.applyImport(preview);
  if (applied.kind !== "applied") {
    throw new Error("restore changed before Merge could apply");
  }

  const fixture = fullLibraryFixture();
  const expectedEssay = fixture.essays.find((essay) =>
    essay.id === state.fixture.deletedEssayId
  );
  if (expectedEssay === undefined) throw new Error("fixture essay is missing");
  const restoredBytes = await deps.appData.readBytes(deletedPath);
  if (restoredBytes === null) {
    throw new Error("Merge did not restore the essay");
  }
  const restored = JSON.parse(
    new TextDecoder().decode(restoredBytes),
  ) as typeof expectedEssay;
  const essayNames = (await deps.appData.list("essays")).filter((name) =>
    name.endsWith(".json")
  );
  if (essayNames.length !== state.fixture.essayCount) {
    throw new Error("restored essay count does not match the fixture");
  }
  const libraryBytes = await deps.appData.readBytes("library.json");
  if (libraryBytes === null) throw new Error("restored library is missing");
  const library = JSON.parse(new TextDecoder().decode(libraryBytes)) as {
    references: { id: string }[];
    collections?: unknown[];
  };
  if (
    library.references.length !== state.fixture.referenceCount ||
    (library.collections?.length ?? 0) !== state.fixture.collectionCount
  ) {
    throw new Error("restored library counts do not match the fixture");
  }
  const referenceIds = new Set(
    library.references.map((reference) => reference.id),
  );
  const restoredSnapshotIds = restored.referencesSnapshot.map((reference) =>
    reference.id
  );
  if (
    JSON.stringify(restoredSnapshotIds) !==
      JSON.stringify(
        expectedEssay.referencesSnapshot.map((reference) => reference.id),
      ) ||
    restoredSnapshotIds.some((id) => !referenceIds.has(id))
  ) {
    throw new Error("restored reference relationships do not match");
  }
  const expectedFigures = collectFigureSources(expectedEssay.content);
  if (
    JSON.stringify(collectFigureSources(restored.content)) !==
      JSON.stringify(expectedFigures)
  ) {
    throw new Error("restored figure relationships do not match");
  }
  for (const path of expectedFigures) {
    const actual = await deps.appData.readBytes(path);
    const expected = fixture.assets[path];
    if (
      actual === null || expected === undefined ||
      await sha256Hex(actual) !== await sha256Hex(expected)
    ) {
      throw new Error(`restored figure bytes do not match: ${path}`);
    }
  }
  state.completedPhase = "restore";
  return {
    state,
    assertions: [
      "deleted-essay-previewed",
      "merge-applied",
      "essay-count-restored",
      "relationships-restored",
      "figure-bytes-restored",
      "completed",
    ],
    archiveNames: (await deps.listArchives()).map((archive) => archive.fileName)
      .sort(),
    selectionInvocations: await requirePickerCallCount(deps, 0),
  };
}

async function productionDeps(): Promise<PackagedBackupSmokeDeps> {
  const [
    { invoke },
    { readFile },
    { getIdentifier, getVersion },
    { exit },
    backupRuntime,
    portableRuntime,
    { appDataImportFs },
    { uiLocale },
  ] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/plugin-fs"),
    import("@tauri-apps/api/app"),
    import("@tauri-apps/plugin-process"),
    import("./backupRuntime.ts"),
    import("./portableRuntime.ts"),
    import("./appDataFs.ts"),
    import("$lib/state/uiLocale.svelte"),
  ]);
  return {
    context: () =>
      invoke("packaged_backup_smoke_context") as Promise<{
        phase: PackagedBackupSmokePhase;
        proofCommitSha: string;
      }>,
    appVersion: getVersion,
    bundleIdentifier: getIdentifier,
    loadUiSettings: () => uiLocale.load(),
    flushUiSettings: () => uiLocale.flushPending(),
    appData: appDataImportFs,
    exportLibrary: portableRuntime.exportLibraryToChosenFile,
    seedTransientScope: () =>
      invoke<string>("packaged_backup_smoke_seed_transient_scope"),
    readExternalFile: readFile,
    fakeDestinationExists: (path) =>
      invoke<boolean>("external_destination_exists", {
        path,
        authorizationToken: "00000000-0000-4000-8000-000000000000",
      }),
    pickAndBegin: backupRuntime.pickAndBeginBackupConfiguration,
    pickerCallCount: () =>
      invoke<number>("packaged_backup_smoke_picker_call_count"),
    writeWizardTest: backupRuntime.writeWizardTestBackup,
    activate: backupRuntime.activateBackupConfiguration,
    status: () => backupRuntime.tauriBackupAdapter.status(),
    listArchives: () => backupRuntime.tauriBackupAdapter.listArchives(),
    readArchive: (fileName) =>
      backupRuntime.tauriBackupAdapter.readArchive(fileName),
    removeArchive: (fileName, expectedSha256) =>
      backupRuntime.tauriBackupAdapter.removeArchive(fileName, expectedSha256),
    runManual: () => backupRuntime.backupStore().runManual(),
    previewBackup: backupRuntime.previewBackupArchive,
    applyImport: portableRuntime.applyImportWithRuntime,
    now: () => Date.now(),
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    exit,
    reportError: (error) =>
      console.error("Packaged backup smoke failed", error),
  };
}

/** Four-launch, build-gated production acceptance scenario. */
export async function runPackagedBackupSmoke(
  injected?: PackagedBackupSmokeDeps,
): Promise<void> {
  const deps = injected ?? await productionDeps();
  let phase: PackagedBackupSmokePhase | null = null;
  let featureSha = "unknown";
  let metadata: { appVersion: string; bundleIdentifier: string } | null = null;
  try {
    const context = await deps.context();
    phase = context.phase;
    featureSha = requireString(context.proofCommitSha, "proofCommitSha");
    metadata = {
      appVersion: await deps.appVersion(),
      bundleIdentifier: await deps.bundleIdentifier(),
    };
    // The ordinary startup safety phase loads this store before backup work.
    // The build-only path must do the same so status history survives launches
    // and a backup update cannot overwrite unrelated persisted UI settings.
    await deps.loadUiSettings();
    const result = phase === "configure"
      ? await runConfigure(deps, featureSha)
      : phase === "restart"
      ? await runRestart(deps, featureSha)
      : phase === "reconfigure"
      ? await runReconfigure(deps, featureSha)
      : await runRestore(deps, featureSha);
    await writeBoundedJson(
      deps.appData,
      PACKAGED_BACKUP_SMOKE_STATE_PATH,
      result.state,
    );
    const resultExportPath = "exportPath" in result &&
        typeof result.exportPath === "string"
      ? result.exportPath
      : undefined;
    const evidence: PackagedBackupSmokeEvidenceV1 = {
      schemaVersion: 1,
      phase,
      featureSha,
      bundleIdentifier: metadata.bundleIdentifier,
      appVersion: metadata.appVersion,
      passed: true,
      selectionInvocations: result.selectionInvocations,
      assertions: result.assertions,
      archiveNames: result.archiveNames,
      ...(resultExportPath === undefined
        ? {}
        : { exportPath: resultExportPath }),
    };
    await writeBoundedJson(deps.appData, EVIDENCE_PATHS[phase], evidence);
    // Activation records the validated test in UI status asynchronously.
    // This build exits immediately, so drain it just as a normal safe close
    // would after the durable phase markers and before process termination.
    await deps.flushUiSettings();
    await deps.exit(0);
  } catch (error) {
    if (phase !== null && metadata !== null) {
      let selectionInvocations = 0;
      try {
        selectionInvocations = await deps.pickerCallCount();
      } catch {
        // The original error remains authoritative when native IPC is down.
      }
      const failed: PackagedBackupSmokeEvidenceV1 = {
        schemaVersion: 1,
        phase,
        featureSha,
        bundleIdentifier: metadata.bundleIdentifier,
        appVersion: metadata.appVersion,
        passed: false,
        selectionInvocations,
        assertions: [],
        errorCode: errorCode(error),
      };
      try {
        await writeBoundedJson(deps.appData, EVIDENCE_PATHS[phase], failed);
      } catch {
        // Preserve the original failure; the runner also observes exit 1.
      }
      try {
        await deps.flushUiSettings();
      } catch {
        // Preserve the original failure when status persistence also fails.
      }
    }
    deps.reportError(error);
    await deps.exit(1);
  }
}

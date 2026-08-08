/**
 * Runtime wiring for automatic library backups (tasks 9.6/9.7/10.x): a thin
 * Tauri adapter over the Rust backup-directory commands, the app-lifetime
 * `BackupStore` factory, and the wizard/settings helpers. Selected-folder
 * I/O always runs through `invoke` (off the UI thread on the Rust side) and
 * every failure is normalized to a stable `code` so the UI can offer
 * non-blocking Retry / Choose another folder without ever claiming remote
 * provider sync succeeded.
 */

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  type BackupAdapter,
  type BackupAdapterStatus,
  BackupStore,
} from "$lib/state/backup.svelte";
import { uiLocale } from "$lib/state/uiLocale.svelte";
import { backupFileName } from "$lib/portable/retention";
import type { RetentionLedgerEntry } from "$lib/portable/retention";
import { validateArchive } from "$lib/portable/validate";
import { ARCHIVE_LIMITS } from "$lib/portable/limits";
import { snapshotContentDigest } from "$lib/portable/contentDigest";
import { persistence } from "./coordinator.ts";
import { operations } from "./operationCoordinator.ts";
import { appDataImportFs, appDataSnapshotIo } from "./appDataFs.ts";
import { captureStableSnapshot } from "./librarySnapshot.ts";
import { libraryArchiveService } from "./portableRuntime.ts";
import {
  type ImportFlowDeps,
  type ImportPreviewResult,
  previewImport,
} from "./importFlow.ts";

// ---------------------------------------------------------------------------
// Error normalization
// ---------------------------------------------------------------------------

/**
 * The Rust adapter rejects with a serialized `{ code, detail }` object
 * (snake_case codes). Anything else — a killed webview bridge, a thrown
 * string — becomes a stable `io` code so retry paths never depend on
 * message text.
 */
export function normalizeBackupError(error: unknown): Error & {
  code: string;
  detail: string;
} {
  let code = "io";
  let detail = "";
  if (error !== null && typeof error === "object") {
    const raw = error as { code?: unknown; detail?: unknown };
    if (typeof raw.code === "string") code = raw.code;
    if (typeof raw.detail === "string") detail = raw.detail;
  }
  if (detail === "") detail = String(error);
  return Object.assign(new Error(`${code}: ${detail}`), { code, detail });
}

async function invokeBackup<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalizeBackupError(error);
  }
}

// ---------------------------------------------------------------------------
// Tauri adapter (BackupAdapter over the Rust command surface)
// ---------------------------------------------------------------------------

export const tauriBackupAdapter: BackupAdapter = {
  status(): Promise<BackupAdapterStatus> {
    return invokeBackup<BackupAdapterStatus>("backup_status");
  },
  async writeArchive(fileName, bytes) {
    const sha256 = await invokeBackup<string>("backup_write_archive", {
      fileName,
      bytes: Array.from(bytes),
    });
    return { sha256 };
  },
  async readArchive(fileName) {
    const bytes = await invokeBackup<number[]>("backup_read_archive", {
      fileName,
    });
    return new Uint8Array(bytes);
  },
  listArchives() {
    return invokeBackup<{ fileName: string; byteLength: number }[]>(
      "backup_list_archives",
    );
  },
  async removeArchive(fileName, expectedSha256) {
    await invokeBackup<void>("backup_remove_archive", {
      fileName,
      expectedSha256,
    });
  },
  ledgerEntries() {
    return invokeBackup<RetentionLedgerEntry[]>("backup_ledger_entries");
  },
};

// ---------------------------------------------------------------------------
// BackupStore factory + lazy singleton
// ---------------------------------------------------------------------------

function currentContentDigest(): Promise<string> {
  // Mirror portableRuntime's capture wiring: flush pending persistence and
  // read one stable revision under the maintenance lease, then digest it.
  return persistence.runMaintenance(async () => {
    const snapshot = await captureStableSnapshot({
      io: appDataSnapshotIo,
      flushPending: () => persistence.flushPending(),
      generation: () => persistence.activityGeneration,
    });
    return await snapshotContentDigest(snapshot);
  });
}

/** Wires a BackupStore to the real Tauri adapters (design §9). */
export function createBackupStore(): BackupStore {
  return new BackupStore({
    adapter: tauriBackupAdapter,
    packageArchive: async (backupSetId) => {
      const service = await libraryArchiveService();
      const { bytes, contentDigest } = await service.package({ backupSetId });
      return { bytes, contentDigest };
    },
    currentContentDigest,
    validateArchiveBytes: async (bytes) => {
      await validateArchive(bytes, ARCHIVE_LIMITS);
    },
    settings: uiLocale,
    runOperation: (kind, fn) => operations.run(kind, fn),
    subscribeActivity: (listener) => persistence.subscribeActivity(listener),
    now: () => new Date(),
  });
}

let cachedStore: BackupStore | null = null;

/** The one app-lifetime backup coordinator. */
export function backupStore(): BackupStore {
  cachedStore ??= createBackupStore();
  return cachedStore;
}

// ---------------------------------------------------------------------------
// Setup wizard helpers (design §8/§11)
// ---------------------------------------------------------------------------

export interface PendingBackupConfiguration {
  canonicalFolderPath: string;
  /** Exact destination shown before consent (incl. `Tesina Backups`). */
  backupSubfolderPath: string;
}

/** Native recursive folder picker. Null when the user cancels. */
export async function pickBackupFolder(): Promise<string | null> {
  const selected = await open({ directory: true, recursive: true });
  if (selected === null) return null;
  return Array.isArray(selected) ? (selected[0] ?? null) : selected;
}

/** Validates the picked folder and creates the pending `Tesina Backups`. */
export function beginBackupConfiguration(
  path: string,
): Promise<PendingBackupConfiguration> {
  return invokeBackup<PendingBackupConfiguration>(
    "backup_begin_configuration",
    { path },
  );
}

/**
 * Wizard test-backup filename (design §10): the pending configuration has
 * no `backupSetId` yet — Rust generates it only at activation — so the
 * grammar's middle component is a fresh random 8-hex value instead of a set
 * prefix. The name still matches the strict retained-backup grammar and the
 * random component preserves collision avoidance in a shared synced folder;
 * activation records the file in the ledger under the new set id, which is
 * what makes it the first retained recovery archive (ledger-first
 * classification never reads the name's set component).
 */
export function testBackupFileName(now: () => Date = () => new Date()): string {
  return backupFileName(crypto.randomUUID(), now().toISOString());
}

/**
 * Packages and writes the REAL test archive into the pending subfolder,
 * then reopens and fully validates it. The archive has no manifest
 * `backup` field (no set id exists yet); retention never parses manifests,
 * so the ledger entry written at activation still counts it toward seven.
 */
export function writeWizardTestBackup(): Promise<{
  fileName: string;
  contentDigest: string;
}> {
  return operations.run("backup", async () => {
    const service = await libraryArchiveService();
    const packaged = await service.package();
    const fileName = testBackupFileName();
    await invokeBackup<string>("backup_write_test_archive", {
      fileName,
      bytes: Array.from(packaged.bytes),
    });
    // Spec: validated test = written, reopened, and fully validated.
    const reread = await tauriBackupAdapter.readArchive(fileName);
    await validateArchive(reread, ARCHIVE_LIMITS);
    return { fileName, contentDigest: packaged.contentDigest };
  });
}

/**
 * Activates the pending configuration (Rust requires a successful test
 * write first) and records the validated test as the first success.
 */
export async function activateBackupConfiguration(
  test: { contentDigest: string },
): Promise<{ canonicalFolderPath: string; backupSetId: string }> {
  const active = await invokeBackup<{
    canonicalFolderPath: string;
    backupSetId: string;
  }>("backup_activate_configuration");
  const now = new Date().toISOString();
  uiLocale.updateBackup({
    configuredAt: now,
    lastAttemptAt: now,
    lastSuccessAt: now,
    lastSuccessContentDigest: test.contentDigest,
    lastErrorCode: undefined,
  });
  return active;
}

/** Cancels the pending selection; Rust removes only its own test files. */
export function cancelBackupConfiguration(): Promise<void> {
  return invokeBackup<void>("backup_cancel_configuration");
}

/**
 * Turn off: deletes the native authorization record (archive bytes remain
 * untouched) and clears the status cache, keeping only the card preference.
 */
export async function disableBackup(): Promise<void> {
  await invokeBackup<void>("backup_disable");
  uiLocale.clearBackup({ keepCardPreference: true });
}

/** Reveals the `Tesina Backups` subfolder in the system file explorer. */
export async function revealBackupFolder(): Promise<void> {
  const status = await tauriBackupAdapter.status();
  if (!status.configured || status.folderPath === undefined) {
    throw normalizeBackupError({
      code: "not_configured",
      detail: "automatic backup is not configured",
    });
  }
  await revealItemInDir(`${status.folderPath}/Tesina Backups`);
}

// ---------------------------------------------------------------------------
// Restore by merging (spec: list retained files, then the standard Merge)
// ---------------------------------------------------------------------------

function backupImportDeps(
  service: Awaited<ReturnType<typeof libraryArchiveService>>,
): ImportFlowDeps {
  return {
    fs: appDataImportFs,
    runMaintenance: (fn) => persistence.runMaintenance(fn),
    flushPending: () => persistence.flushPending(),
    createRollback: async (transactionId) => {
      const { relPath, sha256 } = await service.createRollback(transactionId);
      return { relPath, sha256 };
    },
    uuid: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  };
}

/**
 * Reads one archive from the configured backup folder under the same size
 * limit as import validation, then produces the standard Merge preview.
 */
export async function previewBackupArchive(
  fileName: string,
): Promise<ImportPreviewResult> {
  const listing = await tauriBackupAdapter.listArchives();
  const entry = listing.find((archive) => archive.fileName === fileName);
  if (
    entry !== undefined && entry.byteLength > ARCHIVE_LIMITS.maxArchiveBytes
  ) {
    throw Object.assign(new Error("backup archive exceeds the size limit"), {
      code: "portable/file-too-large",
    });
  }
  const bytes = await tauriBackupAdapter.readArchive(fileName);
  if (bytes.byteLength > ARCHIVE_LIMITS.maxArchiveBytes) {
    throw Object.assign(new Error("backup archive exceeds the size limit"), {
      code: "portable/file-too-large",
    });
  }
  const service = await libraryArchiveService();
  return await previewImport(bytes, backupImportDeps(service));
}

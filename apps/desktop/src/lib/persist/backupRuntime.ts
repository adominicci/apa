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
import {
  libraryArchiveService,
  recoverImportTransaction,
} from "./portableRuntime.ts";
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

async function invokeBackupBinary<T>(
  command: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<T> {
  try {
    return await invoke<T>(command, bytes, {
      headers: { "x-tesina-file-name": fileName },
    });
  } catch (error) {
    const normalized = normalizeBackupError(error);
    if (normalized.code === "file_too_large") {
      normalized.code = "portable/file-too-large";
    }
    throw normalized;
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
    const sha256 = await invokeBackupBinary<string>(
      "backup_write_archive",
      fileName,
      bytes,
    );
    return { sha256 };
  },
  async readArchive(fileName) {
    const bytes = await invokeBackupBinary<ArrayBuffer | Uint8Array>(
      "backup_read_archive",
      fileName,
      new Uint8Array(),
    );
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  },
  async confirmArchive(fileName, expectedSha256) {
    await invokeBackup<void>("backup_confirm_archive", {
      fileName,
      expectedSha256,
    });
  },
  async discardPendingArchive(fileName, expectedSha256) {
    await invokeBackup<void>("backup_discard_pending_archive", {
      fileName,
      expectedSha256,
    });
  },
  listArchives() {
    return invokeBackup<{ fileName: string; byteLength: number }[]>(
      "backup_list_archives",
    );
  },
  listArchiveNames() {
    return invokeBackup<string[]>("backup_list_archive_names");
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

function throwIfBackupCancelled(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw Object.assign(new Error("backup cancelled"), { code: "cancelled" });
}

/**
 * Couples the app-lifetime operation token to Rust's selected-folder epoch.
 * The cancellation command is awaited so shutdown cannot release the token
 * while a native worker can still publish or ledger a late result.
 */
async function runBackupOperation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  return await operations.run("backup", async (handle) => {
    let cancellation: Promise<void> | null = null;
    const cancelNative = () => {
      cancellation ??= invokeBackup<void>("backup_cancel_current_operations");
    };
    handle.signal.addEventListener("abort", cancelNative, { once: true });
    try {
      throwIfBackupCancelled(handle.signal);
      return await operation(handle.signal);
    } finally {
      handle.signal.removeEventListener("abort", cancelNative);
      if (cancellation !== null) await cancellation;
    }
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
    runOperation: (_kind, fn) => runBackupOperation(fn),
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
  /** Native-generated identity reused by the test manifest and activation. */
  backupSetId: string;
}

/**
 * Picks and validates the exact folder inside one native trust boundary.
 * No renderer-controlled path or cumulative dialog scope can be substituted.
 */
export function pickAndBeginBackupConfiguration(): Promise<
  PendingBackupConfiguration | null
> {
  return invokeBackup<PendingBackupConfiguration | null>(
    "backup_pick_and_begin_configuration",
  );
}

/**
 * Wizard test-backup filename (design §10): native setup creates the pending
 * backup-set identity before any bytes are written. The test name therefore
 * uses the exact same prefix as every later automatic backup in that set.
 */
export function testBackupFileName(
  backupSetId: string,
  now: () => Date = () => new Date(),
): string {
  return backupFileName(backupSetId, now().toISOString());
}

/**
 * Packages and writes the REAL test archive into the pending subfolder,
 * then reopens and fully validates it. The manifest and filename both carry
 * the native pending set identity that activation will make authoritative.
 */
export function writeWizardTestBackup(backupSetId: string): Promise<{
  fileName: string;
  contentDigest: string;
}> {
  return runBackupOperation(async (signal) => {
    throwIfBackupCancelled(signal);
    const service = await libraryArchiveService();
    throwIfBackupCancelled(signal);
    const packaged = await service.package({ backupSetId });
    throwIfBackupCancelled(signal);
    const fileName = testBackupFileName(backupSetId);
    await invokeBackupBinary<string>(
      "backup_write_test_archive",
      fileName,
      packaged.bytes,
    );
    throwIfBackupCancelled(signal);
    // Spec: validated test = written, reopened, and fully validated.
    const rereadBytes = await invokeBackupBinary<ArrayBuffer | Uint8Array>(
      "backup_read_test_archive",
      fileName,
      new Uint8Array(),
    );
    throwIfBackupCancelled(signal);
    const reread = rereadBytes instanceof Uint8Array
      ? rereadBytes
      : new Uint8Array(rereadBytes);
    await validateArchive(reread, ARCHIVE_LIMITS);
    throwIfBackupCancelled(signal);
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
    recoverImport: recoverImportTransaction,
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

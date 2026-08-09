/**
 * Runtime wiring for portable library archives: one place that assembles
 * the archive service, import flow, recovery, and native dialogs from the
 * real Tauri adapters. Components consume this factory; tests inject fakes
 * at the layer below (importFlow/archiveService are already pure).
 */

import { getVersion } from "@tauri-apps/api/app";
import { open, save } from "@tauri-apps/plugin-dialog";
import { persistence } from "./coordinator.ts";
import { operations } from "./operationCoordinator.ts";
import {
  appDataImportFs,
  appDataReplacementJournal,
  appDataSnapshotIo,
  externalDialogFs,
} from "./appDataFs.ts";
import { captureStableSnapshot } from "./librarySnapshot.ts";
import {
  createLibraryArchiveService,
  type LibraryArchiveService,
} from "./archiveService.ts";
import {
  PortableFileError,
  readTesinaBounded,
  recoverReplacements,
} from "./portableFiles.ts";
import {
  applyConfirmedImport,
  type ImportApplyResult,
  type ImportFlowDeps,
  type ImportPreviewResult,
  previewImport,
} from "./importFlow.ts";
import {
  recoverPendingImports,
  type RecoveryDeps,
  type RecoveryOutcome,
} from "./importJournal.ts";
import { readArchiveStructure, sha256Hex } from "$lib/portable/archive";
import { snapshotContentDigest } from "$lib/portable/contentDigest";
import { ARCHIVE_LIMITS } from "$lib/portable/limits";

function nowIso(): string {
  return new Date().toISOString();
}

let cachedService: LibraryArchiveService | null = null;

/** The one shared archive service (manual export, rollback, backups). */
export async function libraryArchiveService(): Promise<LibraryArchiveService> {
  if (cachedService) return cachedService;
  const appVersion = await getVersion();
  cachedService = createLibraryArchiveService({
    captureSnapshot: () =>
      captureStableSnapshot({
        io: appDataSnapshotIo,
        flushPending: () => persistence.flushPending(),
        generation: () => persistence.activityGeneration,
      }),
    runMaintenance: (fn) => persistence.runMaintenance(fn),
    computeContentDigest: (content) =>
      snapshotContentDigest({
        essays: content.essays,
        library: content.library,
        assets: content.assets,
      }),
    appVersion,
    now: nowIso,
    uuid: () => crypto.randomUUID(),
    sha256: sha256Hex,
    writeAppDataFile: (relPath, bytes) =>
      appDataImportFs.writeBytes(relPath, bytes),
    externalFs: externalDialogFs(),
    replacementJournal: appDataReplacementJournal,
  });
  return cachedService;
}

function importFlowDeps(service: LibraryArchiveService): ImportFlowDeps {
  return {
    fs: appDataImportFs,
    runMaintenance: (fn) => persistence.runMaintenance(fn),
    flushPending: () => persistence.flushPending(),
    createRollback: async (transactionId) => {
      // Import staging already holds the maintenance lease; the leased
      // variant would chain behind the running lease and deadlock.
      const { relPath, sha256 } = await service.createRollbackWithinMaintenance(
        transactionId,
      );
      return { relPath, sha256 };
    },
    uuid: () => crypto.randomUUID(),
    now: nowIso,
  };
}

/** Native save dialog + scoped recovery and recoverable export. */
export async function exportLibraryToChosenFile(
  defaultFileName: string,
): Promise<{ path: string } | null> {
  const destination = await save({
    defaultPath: defaultFileName,
    filters: [{ name: "Tesina", extensions: ["tesina"] }],
  });
  if (destination === null) return null;
  // Dialog grants are deliberately session-only. Re-selecting this exact
  // destination renews access to it and its operation-owned siblings, which
  // is the first safe point to resume an interrupted replacement.
  const fs = externalDialogFs();
  await recoverReplacements(
    {
      fs,
      validate: async (bytes) => {
        await readArchiveStructure(bytes, ARCHIVE_LIMITS);
      },
      uuid: () => crypto.randomUUID(),
      sha256: sha256Hex,
    },
    appDataReplacementJournal,
    destination,
  );
  if (
    (await appDataReplacementJournal.list()).some((record) =>
      record.destinationPath === destination
    )
  ) {
    throw new PortableFileError(
      "portable/replacement-recovery-required",
      "the interrupted export destination still requires recovery",
      destination,
    );
  }
  const service = await libraryArchiveService();
  return await operations.run("export", async (handle) => {
    const result = await service.exportToFile(destination, handle.signal);
    return { path: result.path };
  });
}

/** Native open dialog + bounded read + validated preview. Null on cancel. */
export async function pickAndPreviewImport(): Promise<
  ImportPreviewResult | null
> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Tesina", extensions: ["tesina"] }],
  });
  if (selected === null) return null;
  const path = Array.isArray(selected) ? selected[0] : selected;
  const bytes = await readTesinaBounded(
    externalDialogFs(),
    path,
    ARCHIVE_LIMITS.maxArchiveBytes,
  );
  const service = await libraryArchiveService();
  return await previewImport(bytes, importFlowDeps(service));
}

/** Applies a confirmed preview under the operation coordinator. */
export async function applyImportWithRuntime(
  confirmed: ImportPreviewResult,
): Promise<ImportApplyResult> {
  const service = await libraryArchiveService();
  return await operations.run("import", (handle) =>
    applyConfirmedImport(
      confirmed,
      importFlowDeps(service),
      () => handle.markRecoverable(),
    ));
}

function recoveryDeps(): RecoveryDeps {
  return {
    fs: appDataImportFs,
    readRollbackLibrary: async (relPath, expectedSha256) => {
      const bytes = await appDataImportFs.readBytes(relPath);
      if (bytes === null || (await sha256Hex(bytes)) !== expectedSha256) {
        throw new Error("rollback archive is missing or corrupted");
      }
      const { files } = await readArchiveStructure(bytes, ARCHIVE_LIMITS);
      const library = files.get("library.json");
      if (library === undefined) {
        throw new Error("rollback archive has no library.json");
      }
      return library;
    },
  };
}

/**
 * Startup recovery (task 6.6): pending imports run before the library becomes
 * interactive. Manual-export records wait for a fresh save-dialog grant and
 * are recovered by exportLibraryToChosenFile on that destination's next use.
 */
export async function runStartupRecovery(): Promise<RecoveryOutcome[]> {
  return await recoverPendingImports(recoveryDeps());
}

/**
 * Privacy-safe diagnostic payload for the recovery-required state: codes,
 * relative paths, and hashes only — never essay content or user names.
 */
export async function buildRecoveryDiagnostic(
  outcomes: RecoveryOutcome[],
): Promise<string> {
  const transactions = await appDataImportFs.list("imports");
  return JSON.stringify(
    {
      generatedAt: nowIso(),
      appVersion: await getVersion(),
      outcomes,
      pendingTransactionIds: transactions,
    },
    null,
    2,
  );
}

/**
 * Runtime wiring for portable library archives: one place that assembles
 * the archive service, import flow, recovery, and native dialogs from the
 * real Tauri adapters. Components consume this factory; tests inject fakes
 * at the layer below (importFlow/archiveService are already pure).
 */

import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { persistence } from "./coordinator.ts";
import { type OperationHandle, operations } from "./operationCoordinator.ts";
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
import { type ExternalFs, readTesinaBounded } from "./portableFiles.ts";
import {
  applyConfirmedImport,
  type ImportApplyResult,
  type ImportFlowDeps,
  type ImportPreviewResult,
  previewImport,
} from "./importFlow.ts";
import {
  type ImportFs,
  recoverPendingImports,
  type RecoveryDeps,
  type RecoveryOutcome,
} from "./importJournal.ts";
import { readArchiveStructure, sha256Hex } from "$lib/portable/archive";
import { snapshotContentDigest } from "$lib/portable/contentDigest";
import { ARCHIVE_LIMITS, type ArchiveLimits } from "$lib/portable/limits";

function nowIso(): string {
  return new Date().toISOString();
}

let cachedService: LibraryArchiveService | null = null;

async function createProductionArchiveService(
  externalFs: ExternalFs,
): Promise<LibraryArchiveService> {
  const appVersion = await getVersion();
  return createLibraryArchiveService({
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
    externalFs,
    replacementJournal: appDataReplacementJournal,
  });
}

export interface PortableLibraryRuntimeDeps {
  getArchiveService(): Promise<LibraryArchiveService>;
  externalFs: ExternalFs;
  importFs: ImportFs;
  runMaintenance<T>(operation: () => Promise<T>): Promise<T>;
  flushPending(): Promise<void>;
  runOperation<T>(
    kind: "export" | "import",
    operation: (handle: OperationHandle) => Promise<T>,
  ): Promise<T>;
  uuid(): string;
  now(): string;
  limits?: ArchiveLimits;
}

export interface PortableLibraryRuntime {
  exportToFile(destinationPath: string): Promise<{ path: string }>;
  previewFile(path: string): Promise<ImportPreviewResult>;
  applyImport(confirmed: ImportPreviewResult): Promise<ImportApplyResult>;
  recoverImportTransaction(transactionId: string): Promise<RecoveryOutcome>;
  runStartupRecovery(): Promise<RecoveryOutcome[]>;
}

/**
 * Injectable application runtime used by both native UI entry points and the
 * application-level integration harness. Archive/import algorithms remain in
 * their focused modules; this factory owns their real orchestration boundary.
 */
export function createPortableLibraryRuntime(
  deps: PortableLibraryRuntimeDeps,
): PortableLibraryRuntime {
  const limits = deps.limits ?? ARCHIVE_LIMITS;

  function recoveryDeps(): RecoveryDeps {
    return {
      fs: deps.importFs,
      readRollbackLibrary: async (relPath, expectedSha256) => {
        const bytes = await deps.importFs.readBytes(relPath);
        if (bytes === null || (await sha256Hex(bytes)) !== expectedSha256) {
          throw new Error("rollback archive is missing or corrupted");
        }
        const { files } = await readArchiveStructure(bytes, limits);
        const library = files.get("library.json");
        if (library === undefined) {
          throw new Error("rollback archive has no library.json");
        }
        return library;
      },
    };
  }

  async function recoverImportTransaction(
    transactionId: string,
  ): Promise<RecoveryOutcome> {
    const outcomes = await recoverPendingImports(recoveryDeps());
    return outcomes.find((outcome) =>
      "transactionId" in outcome && outcome.transactionId === transactionId
    ) ?? {
      kind: "recovery-required" as const,
      transactionId,
      reason: "the durable import journal was not found during recovery",
    };
  }

  function importFlowDeps(service: LibraryArchiveService): ImportFlowDeps {
    return {
      fs: deps.importFs,
      runMaintenance: deps.runMaintenance,
      flushPending: deps.flushPending,
      createRollback: async (transactionId) => {
        // Import staging already holds the maintenance lease; reacquiring it
        // through createRollback would deadlock behind the running lease.
        const { relPath, sha256 } = await service
          .createRollbackWithinMaintenance(transactionId);
        return { relPath, sha256 };
      },
      recoverImport: recoverImportTransaction,
      uuid: deps.uuid,
      now: deps.now,
      limits,
    };
  }

  return {
    async exportToFile(destinationPath) {
      const service = await deps.getArchiveService();
      return await deps.runOperation("export", async (handle) => {
        const result = await service.exportToFile(
          destinationPath,
          handle.signal,
        );
        return { path: result.path };
      });
    },

    async previewFile(path) {
      const bytes = await readTesinaBounded(
        deps.externalFs,
        path,
        limits.maxArchiveBytes,
      );
      const service = await deps.getArchiveService();
      return await previewImport(bytes, importFlowDeps(service));
    },

    async applyImport(confirmed) {
      const service = await deps.getArchiveService();
      return await deps.runOperation("import", (handle) =>
        applyConfirmedImport(
          confirmed,
          importFlowDeps(service),
          () => handle.markRecoverable(),
        ));
    },

    recoverImportTransaction,

    async runStartupRecovery() {
      return await recoverPendingImports(recoveryDeps());
    },
  };
}

/** The one shared archive service (manual export, rollback, backups). */
export async function libraryArchiveService(): Promise<LibraryArchiveService> {
  if (cachedService) return cachedService;
  cachedService = await createProductionArchiveService(externalDialogFs());
  return cachedService;
}

let cachedRuntime: PortableLibraryRuntime | null = null;

function createProductionPortableLibraryRuntime(
  getArchiveService: () => Promise<LibraryArchiveService>,
  externalFs: ExternalFs,
): PortableLibraryRuntime {
  return createPortableLibraryRuntime({
    getArchiveService,
    externalFs,
    importFs: appDataImportFs,
    runMaintenance: (operation) => persistence.runMaintenance(operation),
    flushPending: () => persistence.flushPending(),
    runOperation: (kind, operation) => operations.run(kind, operation),
    uuid: () => crypto.randomUUID(),
    now: nowIso,
  });
}

function productionPortableLibraryRuntime(): PortableLibraryRuntime {
  if (cachedRuntime) return cachedRuntime;
  cachedRuntime = createProductionPortableLibraryRuntime(
    libraryArchiveService,
    externalDialogFs(),
  );
  return cachedRuntime;
}

interface NativeSaveSelection {
  path: string;
  authorizationToken: string;
}

/** Native save dialog + exact one-lifecycle authorization and export. */
export async function exportLibraryToChosenFile(
  defaultFileName: string,
): Promise<{ path: string } | null> {
  const selection = await invoke<NativeSaveSelection | null>(
    "external_pick_save_destination",
    { suggestedName: defaultFileName },
  );
  if (selection === null) return null;

  try {
    const externalFs = externalDialogFs(selection.authorizationToken);
    const service = await createProductionArchiveService(externalFs);
    const runtime = createProductionPortableLibraryRuntime(
      () => Promise.resolve(service),
      externalFs,
    );
    return await runtime.exportToFile(selection.path);
  } finally {
    await invoke("external_finish_save_authorization", {
      authorizationToken: selection.authorizationToken,
    });
  }
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
  return await productionPortableLibraryRuntime().previewFile(path);
}

/** Applies a confirmed preview under the operation coordinator. */
export async function applyImportWithRuntime(
  confirmed: ImportPreviewResult,
): Promise<ImportApplyResult> {
  return await productionPortableLibraryRuntime().applyImport(confirmed);
}

export async function recoverImportTransaction(transactionId: string) {
  return await productionPortableLibraryRuntime().recoverImportTransaction(
    transactionId,
  );
}

/**
 * Startup recovery (task 6.6): pending imports run before the library becomes
 * interactive. Manual-export records wait for a fresh save-dialog grant and
 * are recovered by exportLibraryToChosenFile on that destination's next use.
 */
export async function runStartupRecovery(): Promise<RecoveryOutcome[]> {
  return await productionPortableLibraryRuntime().runStartupRecovery();
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

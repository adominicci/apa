/**
 * The one archive service (design §7, task 4.5): manual export, rollback
 * creation, test backup, scheduled backup, and Back up now all package
 * through the same capture → assemble → build → validate pipeline; separate
 * packaging implementations are structurally impossible. Every dependency is
 * injected so the service runs under Vitest without Tauri.
 */

import {
  type ArchiveContent,
  type LibrarySnapshotContent,
} from "$lib/portable/types";
import { assembleArchiveContent } from "$lib/portable/snapshot";
import { buildArchive } from "$lib/portable/archive";
import { validateArchive } from "$lib/portable/validate";
import { ARCHIVE_LIMITS, type ArchiveLimits } from "$lib/portable/limits";
import {
  type ExternalFs,
  type ReplacementJournal,
  writeArchiveExclusive,
  writeArchiveReplacing,
  type WriteDeps,
} from "./portableFiles.ts";

export interface PackagedArchive {
  bytes: Uint8Array;
  /** Digest of the exact captured snapshot the archive was built from. */
  contentDigest: string;
  content: ArchiveContent;
}

export interface LibraryArchiveServiceDeps {
  /** Captures one immutable persisted revision (librarySnapshot.ts). */
  captureSnapshot: () => Promise<LibrarySnapshotContent>;
  /** Serializes maintenance operations (persistence.runMaintenance). */
  runMaintenance: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Digest of a captured snapshot's content (design §9 semantic digest). */
  computeContentDigest: (content: ArchiveContent) => Promise<string>;
  appVersion: string;
  now: () => string;
  uuid: () => string;
  sha256: (bytes: Uint8Array) => Promise<string>;
  /** Writes a relative app-data file atomically (rollback archives). */
  writeAppDataFile: (relPath: string, bytes: Uint8Array) => Promise<void>;
  externalFs: ExternalFs;
  replacementJournal: ReplacementJournal;
  limits?: ArchiveLimits;
}

export interface LibraryArchiveService {
  /** Captures and packages one validated archive. */
  package(options?: { backupSetId?: string }): Promise<PackagedArchive>;
  /** Manual export to a user-chosen (possibly existing) destination. */
  exportToFile(destinationPath: string): Promise<{
    path: string;
    contentDigest: string;
  }>;
  /** Pre-import rollback archive under `$APPDATA/backups/imports/`. */
  createRollback(transactionId: string): Promise<{
    relPath: string;
    sha256: string;
    contentDigest: string;
  }>;
  /** Backup write with exclusive-create candidates (never overwrites). */
  writeBackup(
    candidatePaths: string[],
    backupSetId: string,
  ): Promise<{ path: string; contentDigest: string; sha256: string }>;
}

export function createLibraryArchiveService(
  deps: LibraryArchiveServiceDeps,
): LibraryArchiveService {
  const limits = deps.limits ?? ARCHIVE_LIMITS;

  const writeDeps: WriteDeps = {
    fs: deps.externalFs,
    validate: async (bytes) => {
      await validateArchive(bytes, limits);
    },
    uuid: deps.uuid,
    sha256: deps.sha256,
  };

  async function packageOnce(
    options?: { backupSetId?: string },
  ): Promise<PackagedArchive> {
    const snapshot = await deps.captureSnapshot();
    const content = assembleArchiveContent(snapshot);
    const bytes = await buildArchive(content, {
      now: deps.now,
      appVersion: deps.appVersion,
      ...(options?.backupSetId ? { backupSetId: options.backupSetId } : {}),
    });
    // Full validation gate: no archive is handed out unvalidated. The digest
    // is computed from the exact content that was archived, so a later live
    // edit can never be recorded as already backed up.
    await validateArchive(bytes, limits);
    const contentDigest = await deps.computeContentDigest(content);
    return { bytes, contentDigest, content };
  }

  return {
    package: (options) => deps.runMaintenance(() => packageOnce(options)),

    exportToFile: (destinationPath) =>
      deps.runMaintenance(async () => {
        const packaged = await packageOnce();
        const { path } = await writeArchiveReplacing(
          writeDeps,
          deps.replacementJournal,
          destinationPath,
          packaged.bytes,
        );
        return { path, contentDigest: packaged.contentDigest };
      }),

    createRollback: (transactionId) =>
      deps.runMaintenance(async () => {
        const packaged = await packageOnce();
        const relPath = `backups/imports/${transactionId}.tesina`;
        await deps.writeAppDataFile(relPath, packaged.bytes);
        return {
          relPath,
          sha256: await deps.sha256(packaged.bytes),
          contentDigest: packaged.contentDigest,
        };
      }),

    writeBackup: (candidatePaths, backupSetId) =>
      deps.runMaintenance(async () => {
        const packaged = await packageOnce({ backupSetId });
        const { path } = await writeArchiveExclusive(
          writeDeps,
          packaged.bytes,
          candidatePaths,
        );
        return {
          path,
          contentDigest: packaged.contentDigest,
          sha256: await deps.sha256(packaged.bytes),
        };
      }),
  };
}

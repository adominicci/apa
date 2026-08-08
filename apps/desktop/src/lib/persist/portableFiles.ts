/**
 * Recoverable `.tesina` destination writes (design §7, tasks 4.3/4.4) over an
 * injected filesystem so every rename/cleanup boundary is fault-testable.
 *
 * Two write modes:
 * - `writeArchiveExclusive`: automatic backups — the final name is created
 *   exclusively; a collision picks a different unused name and never
 *   replaces a file this operation did not create (amended spec).
 * - `writeArchiveReplacing`: manual export over a user-chosen destination —
 *   direct same-filesystem replacement rename when the platform allows it,
 *   otherwise a journaled multi-rename that preserves the previous file
 *   until the new destination reopens and validates. Interrupted
 *   replacements are recovered by `recoverReplacements` on next access.
 */

export class PortableFileError extends Error {
  readonly code: string;
  readonly detail?: string;
  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = "PortableFileError";
    this.code = code;
    this.detail = detail;
  }
}

/** Minimal external-filesystem surface (absolute paths). */
export interface ExternalFs {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  /** Replaces an existing destination where the platform supports it. */
  rename(from: string, to: string): Promise<void>;
  /** Fails when the destination already exists. */
  renameNoReplace(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Byte size, or null when the file does not exist. */
  statSize(path: string): Promise<number | null>;
}

export interface ReplacementRecord {
  id: string;
  destinationPath: string;
  temporaryPath: string;
  previousPath: string;
  /** Hash of the new archive being installed. */
  expectedSha256: string;
  /** Hash of the destination file before the replacement began. */
  previousSha256: string;
}

/** Durable store for in-flight replacement records (app-data backed). */
export interface ReplacementJournal {
  save(record: ReplacementRecord): Promise<void>;
  list(): Promise<ReplacementRecord[]>;
  remove(id: string): Promise<void>;
}

export interface WriteDeps {
  fs: ExternalFs;
  /** Reopens and validates written bytes; throws when invalid. */
  validate: (bytes: Uint8Array) => Promise<void>;
  uuid: () => string;
  sha256: (bytes: Uint8Array) => Promise<string>;
}

function siblingTempPath(path: string, uuid: string): string {
  return `${path}.${uuid}.tmp`;
}

/**
 * Writes `bytes` to a brand-new exclusively-created file. `candidates`
 * yields destination paths to try in order (the caller derives them from the
 * backup filename grammar); an occupied name moves to the next candidate.
 */
export async function writeArchiveExclusive(
  deps: WriteDeps,
  bytes: Uint8Array,
  candidates: string[],
): Promise<{ path: string }> {
  let tmp: string | null = null;
  try {
    for (const candidate of candidates) {
      if (await deps.fs.exists(candidate)) continue;
      if (tmp === null) {
        tmp = siblingTempPath(candidate, deps.uuid());
        await deps.fs.writeFile(tmp, bytes);
        await deps.validate(await deps.fs.readFile(tmp));
      }
      try {
        await deps.fs.renameNoReplace(tmp, candidate);
      } catch {
        continue; // raced by another writer; try the next unused name
      }
      tmp = null;
      await deps.validate(await deps.fs.readFile(candidate));
      return { path: candidate };
    }
    throw new PortableFileError(
      "portable/no-free-name",
      "every candidate backup filename is already occupied",
    );
  } finally {
    if (tmp !== null) {
      try {
        await deps.fs.remove(tmp);
      } catch {
        // best-effort cleanup of this operation's own temp file
      }
    }
  }
}

/**
 * Replaces a user-chosen destination, preserving the previous file until the
 * replacement is validated. Preference order: direct replacement rename;
 * journaled two-step fallback with a durable record persisted before the
 * first rename.
 */
export async function writeArchiveReplacing(
  deps: WriteDeps,
  journal: ReplacementJournal,
  destinationPath: string,
  bytes: Uint8Array,
): Promise<{ path: string }> {
  const tmp = siblingTempPath(destinationPath, deps.uuid());
  await deps.fs.writeFile(tmp, bytes);
  await deps.validate(await deps.fs.readFile(tmp));

  const hadPrevious = await deps.fs.exists(destinationPath);
  try {
    await deps.fs.rename(tmp, destinationPath);
  } catch {
    if (!hadPrevious) {
      // Nothing to preserve and the direct rename still failed: surface it.
      try {
        await deps.fs.remove(tmp);
      } catch { /* keep the temp as evidence if even cleanup fails */ }
      throw new PortableFileError(
        "portable/destination-write",
        "the destination rejected the archive write",
        destinationPath,
      );
    }
    // Journaled fallback: move the previous file aside, then install.
    const record: ReplacementRecord = {
      id: deps.uuid(),
      destinationPath,
      temporaryPath: tmp,
      previousPath: `${destinationPath}.${deps.uuid()}.prev`,
      expectedSha256: await deps.sha256(bytes),
      previousSha256: await deps.sha256(
        await deps.fs.readFile(destinationPath),
      ),
    };
    await journal.save(record);
    await deps.fs.rename(destinationPath, record.previousPath);
    await deps.fs.rename(tmp, destinationPath);
    await deps.validate(await deps.fs.readFile(destinationPath));
    await deps.fs.remove(record.previousPath);
    await journal.remove(record.id);
  }
  await deps.validate(await deps.fs.readFile(destinationPath));
  return { path: destinationPath };
}

/**
 * Recovers interrupted journaled replacements: installs the validated new
 * file when possible, otherwise restores the previous file. Never deletes
 * both candidates; on unresolvable state the record is kept as evidence.
 */
export async function recoverReplacements(
  deps: WriteDeps,
  journal: ReplacementJournal,
): Promise<void> {
  for (const record of await journal.list()) {
    const { destinationPath, temporaryPath, previousPath } = record;
    const destOk = await fileMatches(deps, destinationPath, record);
    if (destOk) {
      // New file fully installed: clear leftovers and close the record.
      await removeIfExists(deps, previousPath);
      await removeIfExists(deps, temporaryPath);
      await journal.remove(record.id);
      continue;
    }
    if (await fileMatches(deps, temporaryPath, record)) {
      // Interrupted before install: finish it.
      if (await deps.fs.exists(destinationPath)) {
        const destBytes = await deps.fs.readFile(destinationPath);
        if ((await deps.sha256(destBytes)) !== record.previousSha256) {
          // The destination is neither the old nor the new file — the user
          // (or another writer) changed it. Never guess; keep the evidence.
          continue;
        }
        // Crash landed before the previous file was moved aside: complete
        // the replacement exactly as the original operation would have.
        await deps.fs.rename(destinationPath, previousPath);
      }
      await deps.fs.rename(temporaryPath, destinationPath);
      await removeIfExists(deps, previousPath);
      await journal.remove(record.id);
      continue;
    }
    if (await deps.fs.exists(previousPath)) {
      // The new bytes are gone: restore the previous destination.
      if (!(await deps.fs.exists(destinationPath))) {
        await deps.fs.rename(previousPath, destinationPath);
      }
      await journal.remove(record.id);
      continue;
    }
    // Neither candidate exists any more; keep the record as evidence.
  }
}

async function fileMatches(
  deps: WriteDeps,
  path: string,
  record: ReplacementRecord,
): Promise<boolean> {
  if (!(await deps.fs.exists(path))) return false;
  try {
    const bytes = await deps.fs.readFile(path);
    return (await deps.sha256(bytes)) === record.expectedSha256;
  } catch {
    return false;
  }
}

async function removeIfExists(deps: WriteDeps, path: string): Promise<void> {
  try {
    if (await deps.fs.exists(path)) await deps.fs.remove(path);
  } catch {
    // best effort; leftovers are harmless and reported by the next recovery
  }
}

/** Size-preflighted read of an untrusted `.tesina` file (task 3.2 native). */
export async function readTesinaBounded(
  fs: ExternalFs,
  path: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const size = await fs.statSize(path);
  if (size === null) {
    throw new PortableFileError(
      "portable/file-missing",
      "the selected file no longer exists",
      path,
    );
  }
  if (size > maxBytes) {
    throw new PortableFileError(
      "portable/file-too-large",
      "the selected file exceeds the supported archive size",
      path,
    );
  }
  return await fs.readFile(path);
}

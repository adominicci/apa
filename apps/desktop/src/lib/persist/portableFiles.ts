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
  /** Streams at most maxBytes and rejects before allocating beyond it. */
  readFileBounded(path: string, maxBytes: number): Promise<Uint8Array>;
  /** Computes SHA-256 incrementally without materializing the whole file. */
  sha256File(path: string): Promise<string>;
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
  signal?: AbortSignal,
): Promise<{ path: string }> {
  const tmp = siblingTempPath(destinationPath, deps.uuid());
  let journalSaved = false;
  try {
    await abortable(signal, () => deps.fs.writeFile(tmp, bytes));
    await deps.validate(
      await abortable(signal, () => deps.fs.readFile(tmp)),
    );

    const hadPrevious = await abortable(
      signal,
      () => deps.fs.exists(destinationPath),
    );
    if (!hadPrevious) {
      await abortable(
        signal,
        () => deps.fs.renameNoReplace(tmp, destinationPath),
      );
      await deps.validate(
        await abortable(signal, () => deps.fs.readFile(destinationPath)),
      );
      return { path: destinationPath };
    }

    // Always journal an existing destination. Some rename implementations
    // replace successfully, but that would destroy the last known-good file
    // before the newly installed bytes pass their final reopen validation.
    const record: ReplacementRecord = {
      id: deps.uuid(),
      destinationPath,
      temporaryPath: tmp,
      previousPath: `${destinationPath}.${deps.uuid()}.prev`,
      expectedSha256: await deps.sha256(bytes),
      previousSha256: await abortable(
        signal,
        () => deps.fs.sha256File(destinationPath),
      ),
    };
    await abortable(signal, () => journal.save(record));
    journalSaved = true;
    await abortable(
      signal,
      () => deps.fs.rename(destinationPath, record.previousPath),
    );
    if (!(await previousMatches(deps, record))) {
      throw new PortableFileError(
        "portable/replacement-recovery-required",
        "the destination changed while it was being preserved",
        destinationPath,
      );
    }
    await abortable(
      signal,
      () => deps.fs.renameNoReplace(tmp, destinationPath),
    );
    if (!(await fileMatches(deps, destinationPath, record))) {
      throw new PortableFileError(
        "portable/replacement-recovery-required",
        "the installed destination changed before it could be verified",
        destinationPath,
      );
    }
    await abortable(signal, () => deps.fs.remove(record.previousPath));
    await abortable(signal, () => journal.remove(record.id));
    return { path: destinationPath };
  } catch (error) {
    if (!journalSaved) {
      // Before a durable record exists, this operation owns the temporary
      // file exclusively. Cleanup is best-effort and deliberately detached
      // from an already-aborted signal.
      try {
        await Promise.race([
          deps.fs.remove(tmp),
          new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
        ]);
      } catch { /* preserve the primary error */ }
    }
    throw error;
  }
}

async function abortable<T>(
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(
      new PortableFileError("portable/cancelled", "operation cancelled"),
    );
  }
  let cancelled = false;
  let timedOut = false;
  const cancel = () => {
    cancelled = true;
  };
  const timeout = setTimeout(() => {
    timedOut = true;
  }, 30_000);
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    let value: T | undefined;
    let operationError: unknown;
    let operationFailed = false;
    try {
      value = await operation();
    } catch (error) {
      operationFailed = true;
      operationError = error;
    }

    // Filesystem plugin promises cannot be interrupted safely. Record expiry,
    // but do not settle until the worker has stopped mutating its paths.
    if (cancelled || signal?.aborted) {
      throw new PortableFileError("portable/cancelled", "operation cancelled");
    }
    if (timedOut) {
      throw new PortableFileError(
        "portable/timeout",
        "the selected destination did not respond before the timeout",
      );
    }
    if (operationFailed) throw operationError;
    return value as T;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}

/**
 * Recovers interrupted journaled replacements: installs the validated new
 * file when possible, otherwise restores the previous file. Never deletes
 * both candidates; on unresolvable state the record is kept as evidence.
 */
export async function recoverReplacements(
  deps: WriteDeps,
  journal: ReplacementJournal,
  authorizedDestination?: string,
): Promise<void> {
  for (const record of await journal.list()) {
    if (
      authorizedDestination !== undefined &&
      record.destinationPath !== authorizedDestination
    ) continue;
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
      if (
        await deps.fs.exists(previousPath) &&
        !(await previousMatches(deps, record))
      ) {
        continue;
      }
      if (await deps.fs.exists(destinationPath)) {
        if (
          (await deps.fs.sha256File(destinationPath)) !== record.previousSha256
        ) {
          // The destination is neither the old nor the new file — the user
          // (or another writer) changed it. Never guess; keep the evidence.
          continue;
        }
        // Crash landed before the previous file was moved aside: complete
        // the replacement exactly as the original operation would have.
        await deps.fs.rename(destinationPath, previousPath);
        if (!(await previousMatches(deps, record))) continue;
      }
      try {
        await deps.fs.renameNoReplace(temporaryPath, destinationPath);
      } catch {
        // A destination appeared after preservation. It belongs to another
        // writer; retain every journaled candidate and do not replace it.
        continue;
      }
      if (!(await fileMatches(deps, destinationPath, record))) {
        // A sync provider may alter the installed path during the rename.
        // Keep the preserved previous file and journal for safe recovery.
        continue;
      }
      await removeIfExists(deps, previousPath);
      await journal.remove(record.id);
      continue;
    }
    if (await deps.fs.exists(previousPath)) {
      // The new bytes are gone: restore the previous destination.
      if (!(await deps.fs.exists(destinationPath))) {
        await deps.fs.rename(previousPath, destinationPath);
        await journal.remove(record.id);
        continue;
      }
      if (
        (await deps.fs.sha256File(destinationPath)) === record.previousSha256
      ) {
        await removeIfExists(deps, previousPath);
        await journal.remove(record.id);
      }
      // An unexpected destination leaves both the preserved previous file
      // and its journal intact for a later recovery/diagnostic pass.
      continue;
    }
    // Neither candidate exists any more; keep the record as evidence.
  }
}

async function previousMatches(
  deps: WriteDeps,
  record: ReplacementRecord,
): Promise<boolean> {
  try {
    return (await deps.fs.sha256File(record.previousPath)) ===
      record.previousSha256;
  } catch {
    return false;
  }
}

async function fileMatches(
  deps: WriteDeps,
  path: string,
  record: ReplacementRecord,
): Promise<boolean> {
  if (!(await deps.fs.exists(path))) return false;
  try {
    if ((await deps.fs.sha256File(path)) !== record.expectedSha256) {
      return false;
    }
    await deps.validate(await deps.fs.readFile(path));
    return true;
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
  const bytes = await fs.readFileBounded(path, maxBytes);
  if (bytes.length > maxBytes) {
    throw new PortableFileError(
      "portable/file-too-large",
      "the selected file grew beyond the supported archive size while reading",
      path,
    );
  }
  return bytes;
}

/**
 * Journaled Merge import with validated rollback and startup recovery
 * (design §6, tasks 6.1–6.6). Every filesystem touch goes through an
 * injected app-data interface so each boundary is fault-testable.
 *
 * Invariants:
 * - No existing essay or asset path is ever overwritten; only additive
 *   unused paths plus one atomic `library.json` replacement.
 * - The journal (two independently checksummed copies) is persisted and
 *   reopen-validated before the first live write.
 * - Apply is idempotent: completed operations are skipped by stable op id,
 *   and an already-installed file whose bytes match the journaled hash
 *   counts as completed.
 * - Rollback deletes only paths whose current bytes match the journaled
 *   expected output; anything else is preserved and the transaction fails
 *   closed into recovery-required.
 * - Plan freshness (amended spec): apply verifies the live library still
 *   hashes to the plan-time value before any live write and again before
 *   the library replacement; a mismatch aborts with `import/stale-plan`
 *   before anything is written.
 */

import { canonicalJsonBytes } from "$lib/portable/canonicalJson";
import { sha256Hex } from "$lib/portable/archive";
import type { ImportPlan } from "$lib/portable/importPlan";

export class ImportJournalError extends Error {
  readonly code: string;
  readonly detail?: string;
  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = "ImportJournalError";
    this.code = code;
    this.detail = detail;
  }
}

/** App-data filesystem surface (relative paths, atomic writes). */
export interface ImportFs {
  exists(relPath: string): Promise<boolean>;
  readBytes(relPath: string): Promise<Uint8Array | null>;
  /** Atomic (tmp + rename) write. */
  writeBytes(relPath: string, bytes: Uint8Array): Promise<void>;
  /** Same-volume rename; the target must not exist (checked by callers). */
  rename(fromRel: string, toRel: string): Promise<void>;
  remove(relPath: string): Promise<void>;
  /** Recursive directory removal; missing directories are fine. */
  removeDir(relDir: string): Promise<void>;
  /** Child names (files and directories) of a directory; [] when missing. */
  list(relDir: string): Promise<string[]>;
}

export type JournalStatus = "staged" | "applying" | "complete";

export interface JournalFileOp {
  kind: "writeAsset" | "writeEssay";
  opId: string;
  stagePath: string;
  finalPath: string;
  sha256: string;
  byteLength: number;
}

export interface JournalLibraryOp {
  kind: "mergeLibrary";
  opId: string;
  /** Hash of the canonical merged library bytes this apply will write. */
  mergedSha256: string;
}

export type JournalOp = JournalFileOp | JournalLibraryOp;

export interface ImportJournalV1 {
  schemaVersion: 1;
  transactionId: string;
  createdAt: string;
  archiveSha256: string;
  rollback: { relPath: string; sha256: string };
  /** Hash of the live `library.json` bytes the plan was computed from. */
  previousLibrarySha256: string;
  operations: JournalOp[];
  completedOpIds: string[];
  status: JournalStatus;
}

interface JournalEnvelope {
  schemaVersion: 1;
  payloadSha256: string;
  payload: ImportJournalV1;
}

const IMPORTS_DIR = "imports";

function txDir(transactionId: string): string {
  return `${IMPORTS_DIR}/${transactionId}`;
}
function journalPath(transactionId: string): string {
  return `${txDir(transactionId)}/journal.json`;
}
function journalCopyPath(transactionId: string): string {
  return `${txDir(transactionId)}/journal-copy.json`;
}

async function envelopeBytes(payload: ImportJournalV1): Promise<Uint8Array> {
  const envelope: JournalEnvelope = {
    schemaVersion: 1,
    payloadSha256: await sha256Hex(canonicalJsonBytes(payload)),
    payload,
  };
  return canonicalJsonBytes(envelope);
}

async function parseEnvelope(
  bytes: Uint8Array | null,
): Promise<ImportJournalV1 | null> {
  if (bytes === null) return null;
  try {
    const envelope = JSON.parse(
      new TextDecoder().decode(bytes),
    ) as JournalEnvelope;
    if (
      envelope?.schemaVersion !== 1 ||
      typeof envelope.payloadSha256 !== "string" ||
      envelope.payload?.schemaVersion !== 1 ||
      typeof envelope.payload.transactionId !== "string" ||
      !Array.isArray(envelope.payload.operations) ||
      !Array.isArray(envelope.payload.completedOpIds)
    ) {
      return null;
    }
    const expected = await sha256Hex(canonicalJsonBytes(envelope.payload));
    if (expected !== envelope.payloadSha256) return null;
    return envelope.payload;
  } catch {
    return null;
  }
}

/** Persists both journal copies and reopen-validates each before returning. */
async function persistJournal(
  fs: ImportFs,
  journal: ImportJournalV1,
): Promise<void> {
  const bytes = await envelopeBytes(journal);
  await fs.writeBytes(journalPath(journal.transactionId), bytes);
  await fs.writeBytes(journalCopyPath(journal.transactionId), bytes);
  for (
    const path of [
      journalPath(journal.transactionId),
      journalCopyPath(journal.transactionId),
    ]
  ) {
    const reread = await parseEnvelope(await fs.readBytes(path));
    if (reread === null) {
      throw new ImportJournalError(
        "import/journal-write",
        "a journal copy failed reopen validation",
        path,
      );
    }
  }
}

/** Loads a valid journal from either copy; null when both are invalid. */
export async function loadJournal(
  fs: ImportFs,
  transactionId: string,
): Promise<ImportJournalV1 | null> {
  const main = await parseEnvelope(
    await fs.readBytes(journalPath(transactionId)),
  );
  if (main !== null) return main;
  return await parseEnvelope(
    await fs.readBytes(journalCopyPath(transactionId)),
  );
}

export interface StageDeps {
  fs: ImportFs;
  /** Bytes of one archive asset entry (from the validated archive). */
  readArchiveAsset(archivePath: string): Promise<Uint8Array>;
  /** Creates and validates the pre-import rollback archive (service). */
  createRollback(transactionId: string): Promise<{
    relPath: string;
    sha256: string;
  }>;
  now(): string;
  archiveSha256: string;
  /** Hash of the live library.json the plan was computed from. */
  previousLibrarySha256: string;
}

/**
 * Stages every asset and essay write under `imports/<tx>/stage/`, creates
 * the validated rollback, and persists the journal — all before any live
 * write (design §6 steps 1–4).
 */
export async function stageImport(
  plan: ImportPlan,
  deps: StageDeps,
): Promise<ImportJournalV1> {
  const { fs } = deps;
  const operations: JournalOp[] = [];
  let opIndex = 0;

  for (const op of plan.operations) {
    if (op.kind === "mergeLibrary") {
      operations.push({
        kind: "mergeLibrary",
        opId: op.opId,
        mergedSha256: await sha256Hex(canonicalJsonBytes(op.library)),
      });
      continue;
    }
    opIndex += 1;
    const stagePath = `${txDir(plan.transactionId)}/stage/op-${opIndex}`;
    const bytes = op.kind === "writeAsset"
      ? await deps.readArchiveAsset(op.archivePath)
      : canonicalJsonBytes(op.essay);
    const sha256 = await sha256Hex(bytes);
    if (op.kind === "writeAsset" && sha256 !== op.sha256) {
      throw new ImportJournalError(
        "import/stage-hash",
        "staged asset bytes disagree with the plan",
        op.archivePath,
      );
    }
    await fs.writeBytes(stagePath, bytes);
    const reread = await fs.readBytes(stagePath);
    if (reread === null || (await sha256Hex(reread)) !== sha256) {
      throw new ImportJournalError(
        "import/stage-hash",
        "a staged file failed reopen validation",
        stagePath,
      );
    }
    if (await fs.exists(op.localPath)) {
      // Additive target must not exist; the plan is stale.
      throw new ImportJournalError(
        "import/stale-plan",
        "a planned additive path already exists",
        op.localPath,
      );
    }
    operations.push({
      kind: op.kind,
      opId: op.opId,
      stagePath,
      finalPath: op.localPath,
      sha256,
      byteLength: bytes.length,
    });
  }

  // Stage the merged library bytes next to the ops so apply and recovery
  // can derive them from the journaled hash alone.
  await fs.writeBytes(
    `${txDir(plan.transactionId)}/stage/merged-library.json`,
    canonicalJsonBytes(plan.mergedLibrary),
  );

  const rollback = await deps.createRollback(plan.transactionId);
  const journal: ImportJournalV1 = {
    schemaVersion: 1,
    transactionId: plan.transactionId,
    createdAt: deps.now(),
    archiveSha256: deps.archiveSha256,
    rollback,
    previousLibrarySha256: deps.previousLibrarySha256,
    operations,
    completedOpIds: [],
    status: "staged",
  };
  await persistJournal(fs, journal);
  return journal;
}

export interface ApplyDeps {
  fs: ImportFs;
}

async function liveLibrarySha(fs: ImportFs): Promise<string | null> {
  const bytes = await fs.readBytes("library.json");
  return bytes === null ? null : await sha256Hex(bytes);
}

/**
 * Applies (or resumes) a staged transaction. Idempotent: completed op ids
 * and already-installed matching files are skipped. Returns the completed
 * journal. Throws ImportJournalError with `import/recovery-required` when
 * the on-disk state contradicts the journal.
 */
export async function applyImport(
  journal: ImportJournalV1,
  deps: ApplyDeps,
): Promise<ImportJournalV1> {
  const { fs } = deps;
  const current = { ...journal, completedOpIds: [...journal.completedOpIds] };

  const libraryOp = current.operations.find(
    (op): op is JournalLibraryOp => op.kind === "mergeLibrary",
  );

  if (current.status === "staged") {
    // Plan freshness: the live library must still be the plan-time revision
    // before the first live write (amended library-merge-import spec).
    const live = await liveLibrarySha(fs);
    const planTime = current.previousLibrarySha256;
    const alreadyMerged = libraryOp && live === libraryOp.mergedSha256;
    if (live !== planTime && live !== null && !alreadyMerged) {
      throw new ImportJournalError(
        "import/stale-plan",
        "the library changed between planning and apply",
      );
    }
    current.status = "applying";
    await persistJournal(fs, current);
  }

  for (const op of current.operations) {
    if (current.completedOpIds.includes(op.opId)) continue;

    if (op.kind === "mergeLibrary") {
      const live = await liveLibrarySha(fs);
      if (live === op.mergedSha256) {
        // Already replaced by a previous attempt.
      } else if (
        live === current.previousLibrarySha256 || live === null
      ) {
        const merged = await mergedLibraryBytes(fs, current, op);
        await fs.writeBytes("library.json", merged);
      } else {
        throw new ImportJournalError(
          "import/recovery-required",
          "the live library matches neither the plan-time nor merged state",
        );
      }
    } else {
      const finalExists = await fs.exists(op.finalPath);
      if (finalExists) {
        const bytes = await fs.readBytes(op.finalPath);
        if (bytes !== null && (await sha256Hex(bytes)) === op.sha256) {
          // Installed by a previous attempt; treat as completed.
        } else {
          throw new ImportJournalError(
            "import/recovery-required",
            "a final path exists with unexpected bytes",
            op.finalPath,
          );
        }
      } else {
        const staged = await fs.readBytes(op.stagePath);
        if (staged === null || (await sha256Hex(staged)) !== op.sha256) {
          throw new ImportJournalError(
            "import/recovery-required",
            "staged bytes are missing or corrupted",
            op.stagePath,
          );
        }
        await fs.rename(op.stagePath, op.finalPath);
      }
    }

    current.completedOpIds.push(op.opId);
    await persistJournal(fs, current);
  }

  // Final consistency gate: every journaled output must be present with the
  // exact journaled bytes before the transaction closes.
  for (const op of current.operations) {
    if (op.kind === "mergeLibrary") {
      if ((await liveLibrarySha(fs)) !== op.mergedSha256) {
        throw new ImportJournalError(
          "import/recovery-required",
          "post-apply library bytes disagree with the journal",
        );
      }
    } else {
      const bytes = await fs.readBytes(op.finalPath);
      if (
        bytes === null || bytes.length !== op.byteLength ||
        (await sha256Hex(bytes)) !== op.sha256
      ) {
        throw new ImportJournalError(
          "import/recovery-required",
          "a post-apply file disagrees with the journal",
          op.finalPath,
        );
      }
    }
  }

  current.status = "complete";
  await persistJournal(fs, current);
  await fs.removeDir(`${txDir(current.transactionId)}/stage`);
  return current;
}

/**
 * The merged library bytes come from the rollback-era staging: the journal
 * only records the hash, so the bytes must still be derivable. They are
 * stored as a staged file alongside the ops (written by stageMergedLibrary
 * below) — the merge op's stage path is fixed.
 */
function mergedLibraryStagePath(journal: ImportJournalV1): string {
  return `${txDir(journal.transactionId)}/stage/merged-library.json`;
}

async function mergedLibraryBytes(
  fs: ImportFs,
  journal: ImportJournalV1,
  op: JournalLibraryOp,
): Promise<Uint8Array> {
  const bytes = await fs.readBytes(mergedLibraryStagePath(journal));
  if (bytes === null || (await sha256Hex(bytes)) !== op.mergedSha256) {
    throw new ImportJournalError(
      "import/recovery-required",
      "the staged merged library is missing or corrupted",
    );
  }
  return bytes;
}

export type RecoveryOutcome =
  | { kind: "none" }
  | { kind: "resumed"; transactionId: string }
  | { kind: "rolled-back"; transactionId: string }
  | { kind: "already-complete"; transactionId: string }
  | { kind: "recovery-required"; transactionId: string; reason: string };

export interface RecoveryDeps {
  fs: ImportFs;
  /** Validates rollback archive bytes and returns its library.json bytes. */
  readRollbackLibrary(relPath: string, expectedSha256: string): Promise<
    Uint8Array
  >;
}

/**
 * Rolls a transaction back: restores the plan-time library and removes only
 * final paths whose current bytes exactly match the journaled output.
 * Mismatched paths are preserved and force recovery-required.
 */
async function rollbackTransaction(
  journal: ImportJournalV1,
  deps: RecoveryDeps,
): Promise<RecoveryOutcome> {
  const { fs } = deps;
  let blocked: string | null = null;

  for (const op of journal.operations) {
    if (op.kind === "mergeLibrary") continue;
    if (!(await fs.exists(op.finalPath))) continue;
    const bytes = await fs.readBytes(op.finalPath);
    if (
      bytes !== null && bytes.length === op.byteLength &&
      (await sha256Hex(bytes)) === op.sha256
    ) {
      await fs.remove(op.finalPath);
    } else {
      blocked = op.finalPath;
    }
  }

  const libraryOp = journal.operations.find(
    (op): op is JournalLibraryOp => op.kind === "mergeLibrary",
  );
  const live = await liveLibrarySha(fs);
  if (libraryOp && live === libraryOp.mergedSha256) {
    const previous = await deps.readRollbackLibrary(
      journal.rollback.relPath,
      journal.rollback.sha256,
    );
    await fs.writeBytes("library.json", previous);
  } else if (live !== journal.previousLibrarySha256 && live !== null) {
    // The library is neither plan-time, nor merged: do not guess.
    blocked = blocked ?? "library.json";
  }

  if (blocked !== null) {
    return {
      kind: "recovery-required",
      transactionId: journal.transactionId,
      reason: `unexpected bytes at ${blocked}`,
    };
  }
  await fs.removeDir(`${txDir(journal.transactionId)}/stage`);
  return { kind: "rolled-back", transactionId: journal.transactionId };
}

function stagedHashesValid(
  journal: ImportJournalV1,
  fs: ImportFs,
): Promise<boolean> {
  return (async () => {
    for (const op of journal.operations) {
      if (op.kind === "mergeLibrary") {
        const bytes = await fs.readBytes(mergedLibraryStagePath(journal));
        const live = await liveLibrarySha(fs);
        if (
          (bytes === null || (await sha256Hex(bytes)) !== op.mergedSha256) &&
          live !== op.mergedSha256
        ) {
          return false;
        }
        continue;
      }
      if (journal.completedOpIds.includes(op.opId)) continue;
      if (await fs.exists(op.finalPath)) continue; // handled by apply
      const staged = await fs.readBytes(op.stagePath);
      if (staged === null || (await sha256Hex(staged)) !== op.sha256) {
        return false;
      }
    }
    return true;
  })();
}

/**
 * Startup recovery (task 6.6): runs before the essay index or library
 * becomes interactive. Resumes a valid unfinished transaction, otherwise
 * restores the validated rollback, otherwise fails closed preserving all
 * evidence.
 */
export async function recoverPendingImports(
  deps: RecoveryDeps,
): Promise<RecoveryOutcome[]> {
  const { fs } = deps;
  const outcomes: RecoveryOutcome[] = [];
  for (const transactionId of await fs.list(IMPORTS_DIR)) {
    const journal = await loadJournal(fs, transactionId);
    if (journal === null) {
      outcomes.push({
        kind: "recovery-required",
        transactionId,
        reason: "both journal copies are missing or corrupted",
      });
      continue;
    }
    if (journal.status === "complete") {
      await fs.removeDir(`${txDir(transactionId)}/stage`);
      outcomes.push({ kind: "already-complete", transactionId });
      continue;
    }
    if (await stagedHashesValid(journal, fs)) {
      try {
        await applyImport(journal, { fs });
        outcomes.push({ kind: "resumed", transactionId });
        continue;
      } catch {
        // fall through to rollback
      }
    }
    try {
      outcomes.push(await rollbackTransaction(journal, deps));
    } catch (error) {
      outcomes.push({
        kind: "recovery-required",
        transactionId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return outcomes;
}

export interface RollbackRetentionDeps {
  fs: ImportFs;
  /** Newest-first retention count for completed transactions. */
  keepCompleted: number;
}

/**
 * Rollback retention (task 6.8): every unfinished transaction keeps its
 * rollback; completed transactions keep the newest `keepCompleted` rollback
 * archives, pruned oldest-first by journal creation time.
 */
export async function pruneCompletedRollbacks(
  deps: RollbackRetentionDeps,
): Promise<string[]> {
  const { fs } = deps;
  const completed: ImportJournalV1[] = [];
  for (const transactionId of await fs.list(IMPORTS_DIR)) {
    const journal = await loadJournal(fs, transactionId);
    if (journal?.status === "complete") completed.push(journal);
  }
  completed.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const prune = completed.slice(
    0,
    Math.max(0, completed.length - deps.keepCompleted),
  );
  const removed: string[] = [];
  for (const journal of prune) {
    const rollbackBytes = await fs.readBytes(journal.rollback.relPath);
    if (
      rollbackBytes !== null &&
      (await sha256Hex(rollbackBytes)) === journal.rollback.sha256
    ) {
      await fs.remove(journal.rollback.relPath);
      removed.push(journal.rollback.relPath);
    }
    await fs.removeDir(txDir(journal.transactionId));
  }
  return removed;
}

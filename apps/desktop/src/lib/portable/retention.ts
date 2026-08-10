/**
 * Pure ledger-first retention planning (design §10, task 9.5). Only files
 * the durable ledger lists for THIS backup set are ever candidates; nothing
 * else is opened, parsed, or deleted. The native adapter performs the final
 * pre-delete hash recheck, so a plan entry carries the expected hash.
 */

export interface RetentionLedgerEntry {
  fileName: string;
  sha256: string;
  /** RFC3339 creation time recorded at the successful write. */
  createdAt: string;
  backupSetId: string;
}

export interface RetentionInput {
  /** Bare file names present in the `Tesina Backups` subfolder. */
  folderFileNames: string[];
  ledger: RetentionLedgerEntry[];
  backupSetId: string;
  /** Newest count to retain (seven per the spec). */
  keep: number;
  /** Owned-archive count beyond which a persistent warning is surfaced. */
  accumulationWarningAt?: number;
}

export interface RetentionPlan {
  /** Oldest-first deletions; executor rechecks each hash before deleting. */
  prune: { fileName: string; expectedSha256: string }[];
  /** Owned, retained archives (newest `keep`), newest first. */
  retained: RetentionLedgerEntry[];
  /** Files in the folder that retention must never touch. */
  untouched: string[];
  /** True when owned archives keep accumulating well beyond `keep`. */
  accumulationWarning: boolean;
}

/**
 * Automatic backup filename grammar (amended spec): a backup-set component
 * prevents two installations sharing one synced folder from ever targeting
 * the same name.
 */
export function backupFileName(
  backupSetId: string,
  timestamp: string,
): string {
  const stamp = timestamp.replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
  return `Tesina Library - ${backupSetId.slice(0, 8)} - ${stamp}.tesina`;
}

export const BACKUP_NAME_PATTERN =
  /^Tesina Library - [0-9a-f]{8} - \d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.tesina$/;

/**
 * Classification order (amended spec): filename grammar → ledger lookup →
 * backup-set identity → (executor's) current-bytes recheck. Missing or
 * disagreeing evidence always means keep.
 */
export function planRetention(input: RetentionInput): RetentionPlan {
  const folder = new Set(input.folderFileNames);
  const byName = new Map(
    input.ledger
      .filter((entry) => entry.backupSetId === input.backupSetId)
      .map((entry) => [entry.fileName, entry]),
  );

  const owned: RetentionLedgerEntry[] = [];
  const untouched: string[] = [];
  for (const fileName of input.folderFileNames) {
    const entry = byName.get(fileName);
    if (
      entry !== undefined && BACKUP_NAME_PATTERN.test(fileName)
    ) {
      owned.push(entry);
    } else {
      untouched.push(fileName);
    }
  }

  owned.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first
  const retained = owned.slice(0, Math.max(0, input.keep));
  const prune = owned
    .slice(Math.max(0, input.keep))
    .reverse() // oldest first
    .filter((entry) => folder.has(entry.fileName))
    .map((entry) => ({
      fileName: entry.fileName,
      expectedSha256: entry.sha256,
    }));

  const warningAt = input.accumulationWarningAt ?? input.keep * 3;
  return {
    prune,
    retained,
    untouched,
    accumulationWarning: owned.length > warningAt,
  };
}

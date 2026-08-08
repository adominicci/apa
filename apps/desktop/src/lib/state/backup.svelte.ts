/**
 * App-lifetime backup coordinator (design §9, tasks 9.3/9.4/9.6): single
 * flight, changed-content daily eligibility, Back up now, ledger-driven
 * retention, and stable error codes. Every dependency is injected so the
 * scheduler runs under Vitest without Tauri.
 *
 * Daily gating applies to AUTOMATIC runs only (one per local calendar day);
 * Back up now bypasses the daily limit but never the persistence flush,
 * the packaging pipeline, or single-flight protection.
 */

import type { BackupUiSettings } from "$lib/state/uiLocale.svelte";
import {
  backupFileName,
  planRetention,
  type RetentionLedgerEntry,
} from "$lib/portable/retention";

export interface BackupAdapterStatus {
  configured: boolean;
  folderPath?: string;
  backupSetId?: string;
  folderAvailable: boolean;
}

/** Thin wrapper over the Rust backup-directory commands. */
export interface BackupAdapter {
  status(): Promise<BackupAdapterStatus>;
  writeArchive(
    fileName: string,
    bytes: Uint8Array,
  ): Promise<{ sha256: string }>;
  readArchive(fileName: string): Promise<Uint8Array>;
  listArchives(): Promise<{ fileName: string; byteLength: number }[]>;
  removeArchive(fileName: string, expectedSha256: string): Promise<void>;
  ledgerEntries(): Promise<RetentionLedgerEntry[]>;
}

export interface BackupStoreDeps {
  adapter: BackupAdapter;
  /** Packages one validated archive for this backup set (archive service). */
  packageArchive(backupSetId: string): Promise<{
    bytes: Uint8Array;
    contentDigest: string;
  }>;
  /** Flushes persistence and computes the current content digest. */
  currentContentDigest(): Promise<string>;
  /** Reopen-validates written backup bytes (full archive validator). */
  validateArchiveBytes(bytes: Uint8Array): Promise<void>;
  settings: {
    readonly backup: BackupUiSettings | undefined;
    updateBackup(patch: Partial<BackupUiSettings>): void;
  };
  runOperation<T>(
    kind: "backup",
    fn: () => Promise<T>,
  ): Promise<T>;
  subscribeActivity(listener: () => void): () => void;
  now(): Date;
  debounceMs?: number;
  keepCount?: number;
}

export type BackupRunOutcome =
  | { kind: "success"; fileName: string; retentionWarning: boolean }
  | { kind: "skipped"; reason: "unchanged" | "daily-limit" | "not-configured" }
  | { kind: "failed"; errorCode: string };

function localDay(date: Date): string {
  return `${date.getFullYear()}-${
    String(date.getMonth() + 1).padStart(2, "0")
  }-${String(date.getDate()).padStart(2, "0")}`;
}

function errorCodeOf(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const withCode = error as { code?: unknown };
    if (typeof withCode.code === "string") return withCode.code;
  }
  return "backup_failed";
}

export class BackupStore {
  running = $state(false);
  retentionWarning = $state(false);
  accumulationWarning = $state(false);
  /** Set when a follow-up eligibility check should run (content moved on). */
  followUpScheduled = $state(false);
  #deps: BackupStoreDeps;
  #debounceTimer: ReturnType<typeof setTimeout> | undefined;
  #unsubscribe: (() => void) | null = null;

  constructor(deps: BackupStoreDeps) {
    this.#deps = deps;
  }

  /** Starts listening for persistence activity (after startup recovery). */
  start(): void {
    this.#unsubscribe ??= this.#deps.subscribeActivity(() => {
      this.scheduleEligibilityCheck();
    });
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    clearTimeout(this.#debounceTimer);
  }

  /** Debounced automatic eligibility evaluation (design §9). */
  scheduleEligibilityCheck(): void {
    clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => {
      void this.runAutomatic();
    }, this.#deps.debounceMs ?? 2000);
  }

  runAutomatic(): Promise<BackupRunOutcome> {
    return this.#run(false);
  }

  /** Back up now: bypasses only the daily limit. */
  runManual(): Promise<BackupRunOutcome> {
    return this.#run(true);
  }

  async #run(manual: boolean): Promise<BackupRunOutcome> {
    if (this.running) return { kind: "skipped", reason: "daily-limit" };
    this.running = true;
    try {
      return await this.#deps.runOperation(
        "backup",
        () => this.#runInner(manual),
      );
    } finally {
      this.running = false;
    }
  }

  async #runInner(manual: boolean): Promise<BackupRunOutcome> {
    const deps = this.#deps;
    const status = await deps.adapter.status();
    if (!status.configured || !status.backupSetId) {
      return { kind: "skipped", reason: "not-configured" };
    }

    const today = localDay(deps.now());
    if (!manual && deps.settings.backup?.lastAutoSuccessDay === today) {
      return { kind: "skipped", reason: "daily-limit" };
    }

    try {
      deps.settings.updateBackup({
        lastAttemptAt: deps.now().toISOString(),
      });
      if (!status.folderAvailable) {
        throw Object.assign(new Error("backup folder unavailable"), {
          code: "folder_unavailable",
        });
      }

      const digest = await deps.currentContentDigest();
      if (
        !manual && digest === deps.settings.backup?.lastSuccessContentDigest
      ) {
        return { kind: "skipped", reason: "unchanged" };
      }

      const packaged = await deps.packageArchive(status.backupSetId);
      // Exclusive create: a taken name (another same-set write this second,
      // or a synced copy) selects the next candidate; nothing is replaced.
      let fileName: string | null = null;
      for (let attempt = 0; attempt < 3 && fileName === null; attempt += 1) {
        const stamp = new Date(deps.now().getTime() + attempt * 1000)
          .toISOString()
          .replace(/\.\d+Z$/, "Z");
        const candidate = backupFileName(status.backupSetId, stamp);
        try {
          await deps.adapter.writeArchive(candidate, packaged.bytes);
          fileName = candidate;
        } catch (error) {
          if (errorCodeOf(error) !== "name_taken") throw error;
        }
      }
      if (fileName === null) {
        throw Object.assign(new Error("no free backup name"), {
          code: "name_taken",
        });
      }
      // Spec: success means closed, locally visible, reopened, validated.
      await deps.validateArchiveBytes(await deps.adapter.readArchive(fileName));

      deps.settings.updateBackup({
        lastSuccessAt: deps.now().toISOString(),
        lastSuccessContentDigest: packaged.contentDigest,
        lastErrorCode: undefined,
        ...(manual ? {} : { lastAutoSuccessDay: today }),
      });

      const retentionWarning = await this.#applyRetention(status.backupSetId);

      // If content moved on while the archive was being written, schedule a
      // later eligibility check; the recorded digest stays the archived one.
      const liveDigest = await deps.currentContentDigest();
      if (liveDigest !== packaged.contentDigest) {
        this.followUpScheduled = true;
        this.scheduleEligibilityCheck();
      }
      return { kind: "success", fileName, retentionWarning };
    } catch (error) {
      const errorCode = errorCodeOf(error);
      deps.settings.updateBackup({ lastErrorCode: errorCode });
      return { kind: "failed", errorCode };
    }
  }

  async #applyRetention(backupSetId: string): Promise<boolean> {
    const deps = this.#deps;
    try {
      const [listing, ledger] = await Promise.all([
        deps.adapter.listArchives(),
        deps.adapter.ledgerEntries(),
      ]);
      const plan = planRetention({
        folderFileNames: listing.map((f) => f.fileName),
        ledger,
        backupSetId,
        keep: deps.keepCount ?? 7,
      });
      this.accumulationWarning = plan.accumulationWarning;
      let warning = false;
      for (const target of plan.prune) {
        try {
          await deps.adapter.removeArchive(
            target.fileName,
            target.expectedSha256,
          );
        } catch {
          warning = true; // prune failure never invalidates the new backup
        }
      }
      this.retentionWarning = warning || plan.accumulationWarning;
      return this.retentionWarning;
    } catch {
      this.retentionWarning = true;
      return true;
    }
  }
}

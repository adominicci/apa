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
  /** Prior folder metadata exists but lacks the v0.1.17 native trust anchor. */
  requiresReauthorization: boolean;
}

/** Thin wrapper over the Rust backup-directory commands. */
export interface BackupAdapter {
  status(): Promise<BackupAdapterStatus>;
  writeArchive(
    fileName: string,
    bytes: Uint8Array,
  ): Promise<{ sha256: string }>;
  /** Deletes only a still-native-owned, unconfirmed write. */
  discardPendingArchive(
    fileName: string,
    expectedSha256: string,
  ): Promise<void>;
  confirmArchive(fileName: string, expectedSha256: string): Promise<void>;
  readArchive(fileName: string): Promise<Uint8Array>;
  listArchives(): Promise<{ fileName: string; byteLength: number }[]>;
  /** Name-only enumeration for ledger-first retention. Never opens files. */
  listArchiveNames(): Promise<string[]>;
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
    flushPending(): Promise<void>;
  };
  runOperation<T>(
    kind: "backup",
    fn: (signal: AbortSignal) => Promise<T>,
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

function throwIfCancelled(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw Object.assign(new Error("backup cancelled"), { code: "cancelled" });
}

export class BackupStore {
  running = $state(false);
  retentionWarning = $state(false);
  accumulationWarning = $state(false);
  /** Set when a follow-up eligibility check should run (content moved on). */
  followUpScheduled = $state(false);
  #deps: BackupStoreDeps;
  #debounceTimer: ReturnType<typeof setTimeout> | undefined;
  #nextDayTimer: ReturnType<typeof setTimeout> | undefined;
  #unsubscribe: (() => void) | null = null;
  nextDayScheduled = $state(false);

  constructor(deps: BackupStoreDeps) {
    this.#deps = deps;
    this.retentionWarning = deps.settings.backup?.retentionWarning ?? false;
    this.accumulationWarning = deps.settings.backup?.accumulationWarning ??
      false;
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
    clearTimeout(this.#nextDayTimer);
    this.#nextDayTimer = undefined;
    this.nextDayScheduled = false;
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

  #scheduleNextLocalDay(): void {
    if (this.#nextDayTimer !== undefined) return;
    const now = this.#deps.now();
    const nextDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );
    this.nextDayScheduled = true;
    this.#nextDayTimer = setTimeout(() => {
      this.#nextDayTimer = undefined;
      this.nextDayScheduled = false;
      void this.runAutomatic();
    }, Math.max(1_000, nextDay.getTime() - now.getTime()));
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
        (signal) => this.#runInner(manual, signal),
      );
    } finally {
      this.running = false;
    }
  }

  async #runInner(
    manual: boolean,
    signal: AbortSignal,
  ): Promise<BackupRunOutcome> {
    const deps = this.#deps;
    let pendingArchive: { fileName: string; sha256: string } | null = null;
    let confirmed = false;
    try {
      const status = await deps.adapter.status();
      throwIfCancelled(signal);
      if (!status.configured || !status.backupSetId) {
        return { kind: "skipped", reason: "not-configured" };
      }
      deps.settings.updateBackup({
        lastAttemptAt: deps.now().toISOString(),
      });
      if (!status.folderAvailable) {
        throw Object.assign(new Error("backup folder unavailable"), {
          code: "folder_unavailable",
        });
      }

      const today = localDay(deps.now());
      if (!manual && deps.settings.backup?.lastAutoSuccessDay === today) {
        this.#scheduleNextLocalDay();
        return { kind: "skipped", reason: "daily-limit" };
      }

      const digest = await deps.currentContentDigest();
      throwIfCancelled(signal);
      if (
        !manual && digest === deps.settings.backup?.lastSuccessContentDigest
      ) {
        return { kind: "skipped", reason: "unchanged" };
      }

      const packaged = await deps.packageArchive(status.backupSetId);
      throwIfCancelled(signal);
      // Exclusive create: a taken name (another same-set write this second,
      // or a synced copy) selects the next candidate; nothing is replaced.
      let fileName: string | null = null;
      let writtenSha256: string | null = null;
      let resourceRecoveryAttempted = false;
      for (let attempt = 0; attempt < 3 && fileName === null; attempt += 1) {
        throwIfCancelled(signal);
        const stamp = new Date(deps.now().getTime() + attempt * 1000)
          .toISOString()
          .replace(/\.\d+Z$/, "Z");
        const candidate = backupFileName(status.backupSetId, stamp);
        try {
          const written = await deps.adapter.writeArchive(
            candidate,
            packaged.bytes,
          );
          fileName = candidate;
          writtenSha256 = written.sha256;
          pendingArchive = { fileName: candidate, sha256: written.sha256 };
          throwIfCancelled(signal);
        } catch (error) {
          const code = errorCodeOf(error);
          if (code === "name_taken") continue;
          if (code !== "resource_limit" || resourceRecoveryAttempted) {
            throw error;
          }

          // Native ownership is intentionally capped. One ledger-first,
          // cancellable retention pass can free owned slots without touching
          // unknown files; retry the exact write once and never loop on a
          // provider that keeps returning the cap.
          resourceRecoveryAttempted = true;
          await this.#applyRetention(status.backupSetId, signal);
          throwIfCancelled(signal);
          try {
            const written = await deps.adapter.writeArchive(
              candidate,
              packaged.bytes,
            );
            fileName = candidate;
            writtenSha256 = written.sha256;
            pendingArchive = { fileName: candidate, sha256: written.sha256 };
            throwIfCancelled(signal);
          } catch (retryError) {
            if (errorCodeOf(retryError) === "name_taken") continue;
            throw retryError;
          }
        }
      }
      if (fileName === null || writtenSha256 === null) {
        throw Object.assign(new Error("no free backup name"), {
          code: "name_taken",
        });
      }
      // Spec: success means closed, locally visible, reopened, validated.
      const reopened = await deps.adapter.readArchive(fileName);
      throwIfCancelled(signal);
      await deps.validateArchiveBytes(reopened);
      throwIfCancelled(signal);
      await deps.adapter.confirmArchive(fileName, writtenSha256);
      confirmed = true;
      throwIfCancelled(signal);

      const completedAt = deps.now();
      const retentionWarning = await this.#applyRetention(
        status.backupSetId,
        signal,
      );
      throwIfCancelled(signal);

      // If content moved on while the archive was being written, schedule a
      // later eligibility check; the recorded digest stays the archived one.
      const liveDigest = await deps.currentContentDigest();
      throwIfCancelled(signal);
      if (liveDigest !== packaged.contentDigest) {
        this.followUpScheduled = true;
        this.scheduleEligibilityCheck();
      }
      throwIfCancelled(signal);

      const previousSuccess = {
        lastSuccessAt: deps.settings.backup?.lastSuccessAt,
        lastSuccessContentDigest: deps.settings.backup
          ?.lastSuccessContentDigest,
        lastAutoSuccessDay: deps.settings.backup?.lastAutoSuccessDay,
      };
      deps.settings.updateBackup({
        lastSuccessAt: completedAt.toISOString(),
        lastSuccessContentDigest: packaged.contentDigest,
        lastErrorCode: undefined,
        ...(manual ? {} : { lastAutoSuccessDay: localDay(completedAt) }),
      });
      // This flush is the success commit boundary. All cancellable native and
      // digest work is complete; an abort that arrives while the atomic local
      // settings write is in flight observes the committed success.
      try {
        await deps.settings.flushPending();
      } catch (error) {
        deps.settings.updateBackup(previousSuccess);
        try {
          await deps.settings.flushPending();
        } catch {
          // Preserve the original persistence failure. The in-memory rollback
          // remains authoritative and the settings store will retry it.
        }
        throw error;
      }
      return { kind: "success", fileName, retentionWarning };
    } catch (error) {
      if (pendingArchive !== null && !confirmed) {
        try {
          await deps.adapter.discardPendingArchive(
            pendingArchive.fileName,
            pendingArchive.sha256,
          );
        } catch {
          // Preserve the original run error. Without a successful hash-bound
          // discard, retention must treat the archive as unowned evidence.
        }
      }
      const errorCode = errorCodeOf(error);
      deps.settings.updateBackup({ lastErrorCode: errorCode });
      return { kind: "failed", errorCode };
    }
  }

  async #applyRetention(
    backupSetId: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const deps = this.#deps;
    try {
      throwIfCancelled(signal);
      const listing = await deps.adapter.listArchiveNames();
      throwIfCancelled(signal);
      const ledger = await deps.adapter.ledgerEntries();
      throwIfCancelled(signal);
      const plan = planRetention({
        folderFileNames: listing,
        ledger,
        backupSetId,
        keep: deps.keepCount ?? 7,
      });
      this.accumulationWarning = plan.accumulationWarning;
      let warning = false;
      for (const target of plan.prune) {
        throwIfCancelled(signal);
        try {
          await deps.adapter.removeArchive(
            target.fileName,
            target.expectedSha256,
          );
          throwIfCancelled(signal);
        } catch (error) {
          if (signal.aborted || errorCodeOf(error) === "cancelled") {
            throw Object.assign(new Error("backup cancelled"), {
              code: "cancelled",
            });
          }
          warning = true; // prune failure never invalidates the new backup
        }
      }
      throwIfCancelled(signal);
      this.retentionWarning = warning || plan.accumulationWarning;
      deps.settings.updateBackup({
        retentionWarning: this.retentionWarning,
        accumulationWarning: this.accumulationWarning,
      });
      return this.retentionWarning;
    } catch (error) {
      if (signal.aborted || errorCodeOf(error) === "cancelled") throw error;
      this.retentionWarning = true;
      deps.settings.updateBackup({ retentionWarning: true });
      return true;
    }
  }
}

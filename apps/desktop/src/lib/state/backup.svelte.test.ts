import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RetentionLedgerEntry } from "$lib/portable/retention";
import { backupFileName } from "$lib/portable/retention";
import type { BackupUiSettings } from "$lib/state/uiLocale.svelte";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "$state", {
    configurable: true,
    value: Object.assign(<T>(initial: T): T => initial, {
      snapshot: <T>(value: T): T => value,
    }),
  });
});

import { type BackupAdapter, BackupStore } from "./backup.svelte.ts";

/** Task 9.4: scheduler matrix — eligibility, single flight, races. */

const SET_ID = "aaaaaaaa-1111-4111-8111-111111111111";

class Harness {
  archives = new Map<string, Uint8Array>();
  ledger: RetentionLedgerEntry[] = [];
  settingsValue: BackupUiSettings | undefined = {
    configuredAt: "2026-03-01T00:00:00Z",
  };
  digest = "digest-1";
  digestAtPackage: string | null = null;
  /** When set, live content moves to this digest right after packaging. */
  mutateAfterPackage: string | null = null;
  configured = true;
  folderAvailable = true;
  statusError: { code: string } | null = null;
  // Local-time constructor: daily gating uses the LOCAL calendar day.
  clock = new Date(2026, 2, 5, 10, 0, 0);
  writeError: { code: string } | null = null;
  nativeOwnedCap: number | null = null;
  validationError: { code: string } | null = null;
  settingsFlushError: { code: string } | null = null;
  settingsFlushCalls = 0;
  settingsFlushGate: Promise<void> | null = null;
  releaseSettingsFlush: (() => void) | null = null;
  removeError = false;
  discardCalls = 0;
  metadataListCalls = 0;
  nameListCalls = 0;
  ledgerEntryCalls = 0;
  removeCalls = 0;
  writeCalls = 0;
  writeGate: Promise<void> | null = null;
  releaseWrite: (() => void) | null = null;
  confirmGate: Promise<void> | null = null;
  releaseConfirm: (() => void) | null = null;
  nameListGate: Promise<void> | null = null;
  releaseNameList: (() => void) | null = null;
  operationController = new AbortController();
  clockAfterConfirm: Date | null = null;
  packages = 0;
  activityListeners = new Set<() => void>();
  store: BackupStore;

  constructor(settingsValue?: BackupUiSettings) {
    if (settingsValue !== undefined) this.settingsValue = settingsValue;
    const adapter: BackupAdapter = {
      status: () =>
        this.statusError ? Promise.reject(this.statusError) : Promise.resolve({
          configured: this.configured,
          folderAvailable: this.folderAvailable,
          requiresReauthorization: false,
          backupSetId: this.configured ? SET_ID : undefined,
          folderPath: "/synced/Tesina",
        }),
      writeArchive: async (fileName, bytes) => {
        this.writeCalls += 1;
        if (this.writeGate !== null) await this.writeGate;
        if (this.writeError) return Promise.reject(this.writeError);
        if (
          this.nativeOwnedCap !== null &&
          this.ledger.filter((entry) => entry.backupSetId === SET_ID).length >=
            this.nativeOwnedCap
        ) {
          return Promise.reject({ code: "resource_limit" });
        }
        if (this.archives.has(fileName)) {
          return Promise.reject({ code: "name_taken" });
        }
        this.archives.set(fileName, bytes);
        return Promise.resolve({ sha256: `sha-${fileName}` });
      },
      confirmArchive: async (fileName, sha256) => {
        if (this.confirmGate !== null) await this.confirmGate;
        this.ledger.push({
          fileName,
          sha256,
          createdAt: this.clock.toISOString(),
          backupSetId: SET_ID,
        });
        if (this.clockAfterConfirm !== null) {
          this.clock = this.clockAfterConfirm;
        }
      },
      discardPendingArchive: (fileName) => {
        this.discardCalls += 1;
        this.archives.delete(fileName);
        return Promise.resolve();
      },
      readArchive: (fileName) => {
        const bytes = this.archives.get(fileName);
        return bytes ? Promise.resolve(bytes) : Promise.reject({ code: "io" });
      },
      listArchives: () => {
        this.metadataListCalls += 1;
        return Promise.resolve(
          [...this.archives.keys()].map((fileName) => ({
            fileName,
            byteLength: this.archives.get(fileName)!.length,
          })),
        );
      },
      listArchiveNames: async () => {
        this.nameListCalls += 1;
        if (this.nameListGate !== null) await this.nameListGate;
        return [...this.archives.keys()];
      },
      removeArchive: (fileName) => {
        this.removeCalls += 1;
        if (this.removeError) return Promise.reject({ code: "io" });
        this.archives.delete(fileName);
        this.ledger = this.ledger.filter((e) => e.fileName !== fileName);
        return Promise.resolve();
      },
      ledgerEntries: () => {
        this.ledgerEntryCalls += 1;
        return Promise.resolve([...this.ledger]);
      },
    };
    const getSettingsValue = () => this.settingsValue;
    this.store = new BackupStore({
      adapter,
      packageArchive: () => {
        this.packages += 1;
        this.digestAtPackage = this.digest;
        if (this.mutateAfterPackage !== null) {
          this.digest = this.mutateAfterPackage;
        }
        return Promise.resolve({
          bytes: new TextEncoder().encode(`archive-${this.packages}`),
          contentDigest: this.digestAtPackage,
        });
      },
      currentContentDigest: () => Promise.resolve(this.digest),
      validateArchiveBytes: () =>
        this.validationError
          ? Promise.reject(this.validationError)
          : Promise.resolve(),
      settings: {
        get backup() {
          return getSettingsValue();
        },
        updateBackup: (patch) => {
          this.settingsValue = { ...this.settingsValue, ...patch };
        },
        flushPending: async () => {
          this.settingsFlushCalls += 1;
          if (this.settingsFlushGate !== null) {
            await this.settingsFlushGate;
          }
          if (this.settingsFlushError) throw this.settingsFlushError;
        },
      },
      runOperation: (_kind, fn) => fn(this.operationController.signal),
      subscribeActivity: (listener) => {
        this.activityListeners.add(listener);
        return () => this.activityListeners.delete(listener);
      },
      now: () => this.clock,
      debounceMs: 1,
    });
  }
}

let harnessRef: Harness;

beforeEach(() => {
  harnessRef = new Harness();
});

describe("BackupStore scheduling", () => {
  it("backs up the first changed session of the day", async () => {
    const outcome = await harnessRef.store.runAutomatic();
    expect(outcome.kind).toBe("success");
    expect(harnessRef.archives.size).toBe(1);
    expect(harnessRef.settingsValue?.lastSuccessContentDigest).toBe("digest-1");
    expect(harnessRef.settingsValue?.lastAutoSuccessDay).toBe("2026-03-05");
  });

  it("skips when content is unchanged", async () => {
    await harnessRef.store.runAutomatic();
    harnessRef.clock = new Date(2026, 2, 6, 10, 0, 0);
    const outcome = await harnessRef.store.runAutomatic();
    expect(outcome).toEqual({ kind: "skipped", reason: "unchanged" });
    expect(harnessRef.archives.size).toBe(1);
  });

  it("waits until the next local day after today's automatic success", async () => {
    await harnessRef.store.runAutomatic();
    harnessRef.digest = "digest-2";
    harnessRef.clock = new Date(2026, 2, 5, 23, 59, 0);
    const sameDay = await harnessRef.store.runAutomatic();
    expect(sameDay).toEqual({ kind: "skipped", reason: "daily-limit" });
    expect(harnessRef.store.nextDayScheduled).toBe(true);
    // Timezone day boundary: two minutes later it is the next LOCAL day.
    harnessRef.clock = new Date(2026, 2, 6, 0, 1, 0);
    const nextDay = await harnessRef.store.runAutomatic();
    expect(nextDay.kind).toBe("success");
  });

  it("records the completion day when a slow backup crosses midnight", async () => {
    harnessRef.clock = new Date(2026, 2, 5, 23, 59, 59);
    harnessRef.clockAfterConfirm = new Date(2026, 2, 6, 0, 0, 1);
    expect((await harnessRef.store.runAutomatic()).kind).toBe("success");
    expect(harnessRef.settingsValue?.lastAutoSuccessDay).toBe("2026-03-06");

    harnessRef.digest = "digest-2";
    expect(await harnessRef.store.runAutomatic()).toEqual({
      kind: "skipped",
      reason: "daily-limit",
    });
  });

  it("Back up now bypasses only the daily limit", async () => {
    await harnessRef.store.runAutomatic();
    harnessRef.digest = "digest-2";
    const manual = await harnessRef.store.runManual();
    expect(manual.kind).toBe("success");
    expect(harnessRef.archives.size).toBe(2);
    // A manual success does not consume the automatic day slot... but the
    // digest now matches, so the next automatic run skips as unchanged on a
    // later day rather than daily-limited today.
    harnessRef.clock = new Date(2026, 2, 6, 10, 0, 0);
    expect(await harnessRef.store.runAutomatic()).toEqual({
      kind: "skipped",
      reason: "unchanged",
    });
  });

  it("records the error code and stays eligible after a failure", async () => {
    harnessRef.writeError = { code: "folder_unavailable" };
    const outcome = await harnessRef.store.runAutomatic();
    expect(outcome).toEqual({
      kind: "failed",
      errorCode: "folder_unavailable",
    });
    expect(harnessRef.settingsValue?.lastErrorCode).toBe("folder_unavailable");
    expect(harnessRef.settingsValue?.lastAutoSuccessDay).toBeUndefined();
    // Next launch: the folder is back; the same content backs up.
    harnessRef.writeError = null;
    const retry = await harnessRef.store.runAutomatic();
    expect(retry.kind).toBe("success");
    expect(harnessRef.settingsValue?.lastErrorCode).toBeUndefined();
  });

  it("fails and rolls back success gating when metadata cannot persist", async () => {
    harnessRef.settingsValue = {
      ...harnessRef.settingsValue,
      lastSuccessAt: "2026-03-01T10:00:00.000Z",
      lastSuccessContentDigest: "prior-digest",
      lastAutoSuccessDay: "2026-03-01",
    };
    harnessRef.settingsFlushError = { code: "settings_persist_failed" };

    expect(await harnessRef.store.runAutomatic()).toEqual({
      kind: "failed",
      errorCode: "settings_persist_failed",
    });
    expect(harnessRef.settingsValue?.lastSuccessAt).toBe(
      "2026-03-01T10:00:00.000Z",
    );
    expect(harnessRef.settingsValue?.lastSuccessContentDigest).toBe(
      "prior-digest",
    );
    expect(harnessRef.settingsValue?.lastAutoSuccessDay).toBe("2026-03-01");
    expect(harnessRef.settingsFlushCalls).toBe(2);
  });

  it("does not ledger a backup until reopen validation succeeds", async () => {
    harnessRef.validationError = { code: "archive_invalid" };
    expect(await harnessRef.store.runAutomatic()).toEqual({
      kind: "failed",
      errorCode: "archive_invalid",
    });
    expect(harnessRef.archives.size).toBe(0);
    expect(harnessRef.discardCalls).toBe(1);
    expect(harnessRef.ledger).toEqual([]);
  });

  it("stops before confirmation when shutdown cancels an in-flight write", async () => {
    harnessRef.writeGate = new Promise<void>((resolve) => {
      harnessRef.releaseWrite = resolve;
    });

    const pending = harnessRef.store.runManual();
    for (
      let attempt = 0;
      attempt < 20 && harnessRef.writeCalls === 0;
      attempt++
    ) {
      await Promise.resolve();
    }
    expect(harnessRef.writeCalls).toBe(1);

    harnessRef.operationController.abort();
    harnessRef.releaseWrite?.();

    expect(await pending).toEqual({ kind: "failed", errorCode: "cancelled" });
    expect(harnessRef.archives.size).toBe(0);
    expect(harnessRef.discardCalls).toBe(1);
    expect(harnessRef.ledger).toEqual([]);
    expect(harnessRef.settingsValue?.lastSuccessAt).toBeUndefined();
  });

  it("does not report success when shutdown aborts during confirmation", async () => {
    harnessRef.confirmGate = new Promise<void>((resolve) => {
      harnessRef.releaseConfirm = resolve;
    });

    const pending = harnessRef.store.runManual();
    await vi.waitFor(() => expect(harnessRef.archives.size).toBe(1));
    harnessRef.operationController.abort();
    harnessRef.releaseConfirm?.();

    expect(await pending).toEqual({ kind: "failed", errorCode: "cancelled" });
    expect(harnessRef.ledger).toHaveLength(1);
    expect(harnessRef.discardCalls).toBe(0);
    expect(harnessRef.nameListCalls).toBe(0);
    expect(harnessRef.settingsValue?.lastSuccessAt).toBeUndefined();
  });

  it("stops retention without fresh native calls when shutdown aborts", async () => {
    harnessRef.settingsValue = {
      ...harnessRef.settingsValue,
      lastSuccessAt: "2026-03-01T10:00:00.000Z",
      lastSuccessContentDigest: "prior-digest",
      lastAutoSuccessDay: "2026-03-01",
    };
    harnessRef.nameListGate = new Promise<void>((resolve) => {
      harnessRef.releaseNameList = resolve;
    });

    const pending = harnessRef.store.runManual();
    await vi.waitFor(() => expect(harnessRef.nameListCalls).toBe(1));
    harnessRef.operationController.abort();
    harnessRef.releaseNameList?.();

    expect(await pending).toEqual({ kind: "failed", errorCode: "cancelled" });
    expect(harnessRef.ledgerEntryCalls).toBe(0);
    expect(harnessRef.removeCalls).toBe(0);
    expect(harnessRef.settingsFlushCalls).toBe(0);
    expect(harnessRef.settingsValue?.lastSuccessAt).toBe(
      "2026-03-01T10:00:00.000Z",
    );
    expect(harnessRef.settingsValue?.lastSuccessContentDigest).toBe(
      "prior-digest",
    );
    expect(harnessRef.settingsValue?.lastAutoSuccessDay).toBe("2026-03-01");
  });

  it("treats the final success flush as the cancellation commit boundary", async () => {
    harnessRef.settingsFlushGate = new Promise<void>((resolve) => {
      harnessRef.releaseSettingsFlush = resolve;
    });

    const pending = harnessRef.store.runAutomatic();
    await vi.waitFor(() => expect(harnessRef.settingsFlushCalls).toBe(1));
    const nativeCallsAtCommit = {
      names: harnessRef.nameListCalls,
      ledger: harnessRef.ledgerEntryCalls,
      removals: harnessRef.removeCalls,
    };

    harnessRef.operationController.abort();
    harnessRef.releaseSettingsFlush?.();

    expect(await pending).toEqual({
      kind: "success",
      fileName: expect.any(String),
      retentionWarning: false,
    });
    expect(harnessRef.settingsValue?.lastSuccessContentDigest).toBe("digest-1");
    expect(harnessRef.settingsValue?.lastAutoSuccessDay).toBe("2026-03-05");
    expect(harnessRef.settingsFlushCalls).toBe(1);
    expect({
      names: harnessRef.nameListCalls,
      ledger: harnessRef.ledgerEntryCalls,
      removals: harnessRef.removeCalls,
    }).toEqual(nativeCallsAtCommit);
  });

  it("serializes concurrent manual and automatic requests", async () => {
    const [a, m] = await Promise.all([
      harnessRef.store.runAutomatic(),
      harnessRef.store.runManual(),
    ]);
    // Exactly one run proceeded; the other was refused by single flight.
    const kinds = [a.kind, m.kind].sort();
    expect(kinds).toEqual(["skipped", "success"]);
    expect(harnessRef.archives.size).toBe(1);
  });

  it("keeps the archived digest when content mutates during the write", async () => {
    // Package captures digest-1; live content moves to digest-2 while the
    // archive is being written. The recorded digest must remain the
    // archived one and a follow-up eligibility check must be scheduled.
    const harness = harnessRef;
    harness.mutateAfterPackage = "digest-2";
    const outcome = await harness.store.runAutomatic();
    expect(outcome.kind).toBe("success");
    expect(harness.settingsValue?.lastSuccessContentDigest).toBe("digest-1");
    expect(harness.store.followUpScheduled).toBe(true);
  });

  it("not configured: skips without error", async () => {
    harnessRef.configured = false;
    expect(await harnessRef.store.runAutomatic()).toEqual({
      kind: "skipped",
      reason: "not-configured",
    });
  });

  it("unavailable folder fails with a stable code and no archive", async () => {
    harnessRef.folderAvailable = false;
    const outcome = await harnessRef.store.runAutomatic();
    expect(outcome).toEqual({
      kind: "failed",
      errorCode: "folder_unavailable",
    });
    expect(harnessRef.archives.size).toBe(0);
  });

  it("normalizes a failed backup status request", async () => {
    harnessRef.statusError = { code: "io" };

    expect(await harnessRef.store.runManual()).toEqual({
      kind: "failed",
      errorCode: "io",
    });
    expect(harnessRef.settingsValue?.lastErrorCode).toBe("io");
    expect(harnessRef.archives.size).toBe(0);
  });

  it("checks folder availability before returning for the daily limit", async () => {
    await harnessRef.store.runAutomatic();
    harnessRef.folderAvailable = false;

    expect(await harnessRef.store.runAutomatic()).toEqual({
      kind: "failed",
      errorCode: "folder_unavailable",
    });
    expect(harnessRef.settingsValue?.lastErrorCode).toBe("folder_unavailable");
  });
});

describe("retention execution (task 9.5 wiring)", () => {
  function seedOwnedArchives(count: number): void {
    for (let day = 1; day <= count; day += 1) {
      const stamp = `2026-02-${String(day).padStart(2, "0")}T10:00:00Z`;
      const fileName = backupFileName(SET_ID, stamp);
      harnessRef.archives.set(fileName, new Uint8Array([day]));
      harnessRef.ledger.push({
        fileName,
        sha256: `sha-${fileName}`,
        createdAt: stamp,
        backupSetId: SET_ID,
      });
    }
  }

  it("enumerates names without opening archive metadata", async () => {
    expect((await harnessRef.store.runAutomatic()).kind).toBe("success");
    expect(harnessRef.nameListCalls).toBe(1);
    expect(harnessRef.metadataListCalls).toBe(0);
  });

  it("prunes beyond seven after a success and treats failures as warnings", async () => {
    // Seed 7 owned archives on earlier days.
    for (let day = 1; day <= 7; day += 1) {
      const stamp = `2026-03-0${day}T10:00:00Z`;
      const fileName = backupFileName(SET_ID, stamp);
      harnessRef.archives.set(fileName, new Uint8Array([day]));
      harnessRef.ledger.push({
        fileName,
        sha256: `sha-${fileName}`,
        createdAt: stamp,
        backupSetId: SET_ID,
      });
    }
    const outcome = await harnessRef.store.runAutomatic();
    expect(outcome.kind).toBe("success");
    expect(harnessRef.archives.size).toBe(7); // 8 minus 1 pruned
    const oldest = backupFileName(SET_ID, "2026-03-01T10:00:00Z");
    expect(harnessRef.archives.has(oldest)).toBe(false);

    // A failing prune surfaces a warning but the backup stays successful.
    harnessRef.digest = "digest-3";
    harnessRef.clock = new Date(2026, 2, 6, 10, 0, 0);
    harnessRef.removeError = true;
    const second = await harnessRef.store.runAutomatic();
    expect(second.kind).toBe("success");
    expect(
      second.kind === "success" ? second.retentionWarning : false,
    ).toBe(true);
  });

  it("restores retention warnings after a restart", () => {
    const restarted = new Harness({
      ...harnessRef.settingsValue,
      retentionWarning: true,
      accumulationWarning: true,
    });
    harnessRef = restarted;

    expect(restarted.store.retentionWarning).toBe(true);
    expect(restarted.store.accumulationWarning).toBe(true);
  });

  it("recovers once from the sixteen-archive native cap by pruning first", async () => {
    seedOwnedArchives(16);
    harnessRef.nativeOwnedCap = 16;

    const outcome = await harnessRef.store.runManual();

    expect(outcome.kind).toBe("success");
    expect(harnessRef.writeCalls).toBe(2);
    expect(harnessRef.nameListCalls).toBe(2);
    expect(harnessRef.archives.size).toBe(7);
    expect(harnessRef.settingsValue?.lastSuccessContentDigest).toBe("digest-1");
  });

  it("retries the native cap only once and preserves success fields when pruning cannot recover", async () => {
    seedOwnedArchives(16);
    harnessRef.nativeOwnedCap = 16;
    harnessRef.removeError = true;
    harnessRef.settingsValue = {
      ...harnessRef.settingsValue,
      lastSuccessAt: "2026-02-01T10:00:00.000Z",
      lastSuccessContentDigest: "prior-digest",
      lastAutoSuccessDay: "2026-02-01",
    };

    expect(await harnessRef.store.runManual()).toEqual({
      kind: "failed",
      errorCode: "resource_limit",
    });
    expect(harnessRef.writeCalls).toBe(2);
    expect(harnessRef.nameListCalls).toBe(1);
    expect(harnessRef.settingsValue?.lastSuccessAt).toBe(
      "2026-02-01T10:00:00.000Z",
    );
    expect(harnessRef.settingsValue?.lastSuccessContentDigest).toBe(
      "prior-digest",
    );
    expect(harnessRef.settingsValue?.lastAutoSuccessDay).toBe("2026-02-01");
    expect(harnessRef.settingsFlushCalls).toBe(0);
  });
});

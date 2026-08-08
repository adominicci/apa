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
  // Local-time constructor: daily gating uses the LOCAL calendar day.
  clock = new Date(2026, 2, 5, 10, 0, 0);
  writeError: { code: string } | null = null;
  removeError = false;
  packages = 0;
  activityListeners = new Set<() => void>();
  store: BackupStore;

  constructor() {
    const adapter: BackupAdapter = {
      status: () =>
        Promise.resolve({
          configured: this.configured,
          folderAvailable: this.folderAvailable,
          backupSetId: this.configured ? SET_ID : undefined,
          folderPath: "/synced/Tesina",
        }),
      writeArchive: (fileName, bytes) => {
        if (this.writeError) return Promise.reject(this.writeError);
        if (this.archives.has(fileName)) {
          return Promise.reject({ code: "name_taken" });
        }
        this.archives.set(fileName, bytes);
        this.ledger.push({
          fileName,
          sha256: `sha-${fileName}`,
          createdAt: this.clock.toISOString(),
          backupSetId: SET_ID,
        });
        return Promise.resolve({ sha256: `sha-${fileName}` });
      },
      readArchive: (fileName) => {
        const bytes = this.archives.get(fileName);
        return bytes ? Promise.resolve(bytes) : Promise.reject({ code: "io" });
      },
      listArchives: () =>
        Promise.resolve(
          [...this.archives.keys()].map((fileName) => ({
            fileName,
            byteLength: this.archives.get(fileName)!.length,
          })),
        ),
      removeArchive: (fileName) => {
        if (this.removeError) return Promise.reject({ code: "io" });
        this.archives.delete(fileName);
        this.ledger = this.ledger.filter((e) => e.fileName !== fileName);
        return Promise.resolve();
      },
      ledgerEntries: () => Promise.resolve([...this.ledger]),
    };
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
      validateArchiveBytes: () => Promise.resolve(),
      settings: {
        get backup() {
          return harnessRef.settingsValue;
        },
        updateBackup: (patch) => {
          this.settingsValue = { ...this.settingsValue, ...patch };
        },
      },
      runOperation: (_kind, fn) => fn(),
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
    // Timezone day boundary: two minutes later it is the next LOCAL day.
    harnessRef.clock = new Date(2026, 2, 6, 0, 1, 0);
    const nextDay = await harnessRef.store.runAutomatic();
    expect(nextDay.kind).toBe("success");
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
});

describe("retention execution (task 9.5 wiring)", () => {
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
});

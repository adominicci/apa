import { beforeEach, describe, expect, it, vi } from "vitest";

/** Tasks 8.3/8.4: durable, serialized settings writes + backup status cache. */

const runtime = vi.hoisted(() => {
  Object.defineProperty(globalThis, "$state", {
    configurable: true,
    value: Object.assign(<T>(initial: T): T => initial, {
      snapshot: <T>(value: T): T => value,
    }),
  });
  return {
    writeJsonAtomic: vi.fn(),
    readJson: vi.fn(),
  };
});

vi.mock("$lib/persist/atomic", () => ({
  readJson: runtime.readJson,
  writeJsonAtomic: runtime.writeJsonAtomic,
}));

vi.mock("$lib/paraglide/runtime", () => ({
  overwriteGetLocale: vi.fn(),
}));

import { UiSettingsStore } from "./uiLocale.svelte.ts";

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

let store: UiSettingsStore;

beforeEach(() => {
  runtime.writeJsonAtomic.mockReset().mockResolvedValue(undefined);
  runtime.readJson.mockReset().mockResolvedValue(null);
  store = new UiSettingsStore();
});

describe("UiSettingsStore durability (task 8.4)", () => {
  it("serializes rapid updates onto one write chain, latest revision last", async () => {
    const first = deferred();
    runtime.writeJsonAtomic.mockImplementationOnce(() => first.promise);
    store.setTheme("dark");
    store.set("en");
    store.setDock("left");
    first.resolve();
    await store.flushPending();
    const payloads = runtime.writeJsonAtomic.mock.calls.map((c) => c[1]);
    const last = payloads.at(-1) as {
      uiTheme: string;
      uiLanguage: string;
      toolbarDock: string;
    };
    expect(last.uiTheme).toBe("dark");
    expect(last.uiLanguage).toBe("en");
    expect(last.toolbarDock).toBe("left");
  });

  it("flushPending retries a previously failed write", async () => {
    const failing = deferred();
    runtime.writeJsonAtomic.mockImplementationOnce(() => failing.promise);
    store.updateBackup({ lastSuccessAt: "2026-02-01T00:00:00Z" });
    failing.reject(new Error("disk full"));
    await drainMicrotasks();
    // The revision was never persisted; the flush must retry and succeed.
    await store.flushPending();
    const payloads = runtime.writeJsonAtomic.mock.calls.map((c) => c[1]);
    expect(payloads.length).toBeGreaterThanOrEqual(2);
    expect(
      (payloads.at(-1) as { backup?: { lastSuccessAt?: string } }).backup
        ?.lastSuccessAt,
    ).toBe("2026-02-01T00:00:00Z");
  });

  it("notifies the persistence coordinator on every change", () => {
    const markDirty = vi.fn();
    store.setPersistenceDirtyNotifier(markDirty);
    store.setTheme("light");
    store.updateBackup({ lastErrorCode: "folder_unavailable" });
    expect(markDirty).toHaveBeenCalledTimes(2);
  });
});

describe("backup status cache (task 8.3)", () => {
  it("loads an older settings.json with backup absent", async () => {
    runtime.readJson.mockResolvedValue({
      schemaVersion: 1,
      uiLanguage: "en",
      uiTheme: "dark",
    });
    await store.load();
    expect(store.backup).toBeUndefined();
    expect(store.current).toBe("en");
  });

  it("round-trips backup fields and drops malformed ones", async () => {
    runtime.readJson.mockResolvedValue({
      schemaVersion: 1,
      backup: {
        configuredAt: "2026-02-01T00:00:00Z",
        lastSuccessAt: 42, // malformed: must be dropped
        setupCardDismissed: true,
        lastErrorCode: "folder_unavailable",
      },
    });
    await store.load();
    expect(store.backup).toEqual({
      configuredAt: "2026-02-01T00:00:00Z",
      setupCardDismissed: true,
      lastErrorCode: "folder_unavailable",
    });
  });

  it("persists backup updates without touching other fields", async () => {
    store.updateBackup({ configuredAt: "2026-02-01T00:00:00Z" });
    store.updateBackup({ lastSuccessAt: "2026-02-02T00:00:00Z" });
    await store.flushPending();
    const last = runtime.writeJsonAtomic.mock.calls.at(-1)![1] as {
      backup?: Record<string, string>;
      uiLanguage?: string;
    };
    expect(last.backup).toEqual({
      configuredAt: "2026-02-01T00:00:00Z",
      lastSuccessAt: "2026-02-02T00:00:00Z",
    });
    expect(last.uiLanguage).toBe("es");
  });

  it("clearBackup keeps only the card preference when asked", async () => {
    store.updateBackup({
      configuredAt: "2026-02-01T00:00:00Z",
      setupCardDismissed: true,
    });
    store.clearBackup({ keepCardPreference: true });
    await store.flushPending();
    expect(store.backup).toEqual({ setupCardDismissed: true });
    store.clearBackup();
    await store.flushPending();
    expect(store.backup).toBeUndefined();
    const last = runtime.writeJsonAtomic.mock.calls.at(-1)![1] as {
      backup?: unknown;
    };
    expect(last.backup).toBeUndefined();
  });
});

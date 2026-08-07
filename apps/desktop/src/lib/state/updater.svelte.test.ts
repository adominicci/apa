import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readPendingReleaseNotes,
  type ReleaseNotesStorage,
} from "$lib/update/releaseNotes";

const svelteRuntime = vi.hoisted(() => {
  Object.defineProperty(globalThis, "$state", {
    configurable: true,
    value: <T>(initial: T): T => initial,
  });
  return {};
});

import { type UpdaterDependencies, UpdaterStore } from "./updater.svelte.ts";

class MemoryStorage implements ReleaseNotesStorage {
  #values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

describe("UpdaterStore install lifecycle", () => {
  beforeEach(() => {
    void svelteRuntime;
  });

  it("persists manifest notes after installation and before relaunch", async () => {
    const storage = new MemoryStorage();
    let installed = false;
    let relaunched = false;
    const dependencies: UpdaterDependencies = {
      check: () =>
        Promise.resolve({
          version: "0.2.0",
          body: "Citation fixes\nExport improvements",
          downloadAndInstall: () => {
            expect(readPendingReleaseNotes(storage)).toBeNull();
            installed = true;
            return Promise.resolve();
          },
        }),
      storage: () => storage,
      relaunch: () => {
        expect(installed).toBe(true);
        expect(readPendingReleaseNotes(storage)).toEqual({
          version: "0.2.0",
          body: "Citation fixes\nExport improvements",
        });
        relaunched = true;
        return Promise.resolve();
      },
    };
    const store = new UpdaterStore(dependencies);

    await store.check();

    expect(store.version).toBe("0.2.0");
    expect(store.body).toBe("Citation fixes\nExport improvements");
    expect(store.status).toBe("available");

    await store.install();

    expect(relaunched).toBe(true);
    expect(store.progress).toBe(100);
  });

  it("does not persist or relaunch when installation fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(
      () => {},
    );
    const storage = new MemoryStorage();
    let relaunched = false;
    const dependencies: UpdaterDependencies = {
      check: () =>
        Promise.resolve({
          version: "0.2.0",
          body: "Should not appear",
          downloadAndInstall: () =>
            Promise.reject(new Error("signature rejected")),
        }),
      storage: () => storage,
      relaunch: () => {
        relaunched = true;
        return Promise.resolve();
      },
    };
    const store = new UpdaterStore(dependencies);

    try {
      await store.check();
      await store.install();

      expect(store.status).toBe("error");
      expect(readPendingReleaseNotes(storage)).toBeNull();
      expect(relaunched).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });
});

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

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

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
    let flushed = false;
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
      flushPending: () => {
        expect(installed).toBe(true);
        expect(readPendingReleaseNotes(storage)).toBeNull();
        flushed = true;
        return Promise.resolve();
      },
      relaunch: () => {
        expect(installed).toBe(true);
        expect(flushed).toBe(true);
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

  it("does not persist or relaunch on failure and can retry the offered update", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(
      () => {},
    );
    const storage = new MemoryStorage();
    let relaunched = false;
    let installAttempts = 0;
    const dependencies: UpdaterDependencies = {
      check: () =>
        Promise.resolve({
          version: "0.2.0",
          body: "Should not appear",
          downloadAndInstall: () => {
            installAttempts += 1;
            return installAttempts === 1
              ? Promise.reject(new Error("signature rejected"))
              : Promise.resolve();
          },
        }),
      storage: () => storage,
      flushPending: () => Promise.resolve(),
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

      await store.install();

      expect(installAttempts).toBe(2);
      expect(readPendingReleaseNotes(storage)).toEqual({
        version: "0.2.0",
        body: "Should not appear",
      });
      expect(relaunched).toBe(true);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("installs and persists the offered update when a stale check resolves during installation", async () => {
    const storage = new MemoryStorage();
    const installA = deferred<void>();
    const checkB = deferred<
      {
        version: string;
        body: string;
        downloadAndInstall: () => Promise<void>;
      } | null
    >();
    let checkCount = 0;
    const dependencies: UpdaterDependencies = {
      check: () => {
        checkCount += 1;
        return checkCount === 1
          ? Promise.resolve({
            version: "0.2.0",
            body: "Installed A",
            downloadAndInstall: () => installA.promise,
          })
          : checkB.promise;
      },
      storage: () => storage,
      flushPending: () => Promise.resolve(),
      relaunch: () => Promise.resolve(),
    };
    const store = new UpdaterStore(dependencies);
    await store.check();

    const staleCheck = store.check();
    const installing = store.install();
    checkB.resolve({
      version: "0.3.0",
      body: "Offered B",
      downloadAndInstall: () => Promise.resolve(),
    });
    await staleCheck;

    expect(store.status).toBe("downloading");
    expect(store.version).toBe("0.2.0");
    expect(store.body).toBe("Installed A");

    installA.resolve();
    await installing;

    expect(readPendingReleaseNotes(storage)).toEqual({
      version: "0.2.0",
      body: "Installed A",
    });
  });

  it("does not install a consumed update twice while its first install is pending", async () => {
    const storage = new MemoryStorage();
    const installation = deferred<void>();
    let installCount = 0;
    const dependencies: UpdaterDependencies = {
      check: () =>
        Promise.resolve({
          version: "0.2.0",
          body: "One install",
          downloadAndInstall: () => {
            installCount += 1;
            return installation.promise;
          },
        }),
      storage: () => storage,
      flushPending: () => Promise.resolve(),
      relaunch: () => Promise.resolve(),
    };
    const store = new UpdaterStore(dependencies);
    await store.check();

    const first = store.install();
    const duplicate = store.install();

    expect(installCount).toBe(1);

    installation.resolve();
    await Promise.all([first, duplicate]);
  });

  it("retains installed notes if relaunch is rejected", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(
      () => {},
    );
    const storage = new MemoryStorage();
    const store = new UpdaterStore({
      check: () =>
        Promise.resolve({
          version: "0.2.0",
          body: "Installed before relaunch",
          downloadAndInstall: () => Promise.resolve(),
        }),
      storage: () => storage,
      flushPending: () => Promise.resolve(),
      relaunch: () => Promise.reject(new Error("relaunch unavailable")),
    });

    try {
      await store.check();
      await store.install();

      expect(store.status).toBe("error");
      expect(readPendingReleaseNotes(storage)).toEqual({
        version: "0.2.0",
        body: "Installed before relaunch",
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it("still relaunches after best-effort storage rejects the marker write", async () => {
    let relaunched = false;
    const store = new UpdaterStore({
      check: () =>
        Promise.resolve({
          version: "0.2.0",
          body: "Storage unavailable",
          downloadAndInstall: () => Promise.resolve(),
        }),
      storage: () => ({
        getItem: () => null,
        removeItem: () => {},
        setItem: () => {
          throw new Error("quota unavailable");
        },
      }),
      flushPending: () => Promise.resolve(),
      relaunch: () => {
        relaunched = true;
        return Promise.resolve();
      },
    });

    await store.check();
    await store.install();

    expect(relaunched).toBe(true);
    expect(store.progress).toBe(100);
  });

  it("waits for editor and library persistence before marking and relaunching", async () => {
    const storage = new MemoryStorage();
    const flushing = deferred<void>();
    let relaunched = false;
    const store = new UpdaterStore({
      check: () =>
        Promise.resolve({
          version: "0.2.0",
          body: "Persistence barrier",
          downloadAndInstall: () => Promise.resolve(),
        }),
      storage: () => storage,
      flushPending: () => flushing.promise,
      relaunch: () => {
        relaunched = true;
        return Promise.resolve();
      },
    });
    await store.check();

    const installing = store.install();
    await Promise.resolve();
    await Promise.resolve();

    expect(readPendingReleaseNotes(storage)).toBeNull();
    expect(relaunched).toBe(false);
    flushing.resolve();
    await installing;
    expect(readPendingReleaseNotes(storage)).toEqual({
      version: "0.2.0",
      body: "Persistence barrier",
    });
    expect(relaunched).toBe(true);
  });

  it("does not mark or relaunch when persistence flushing rejects", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(
      () => {},
    );
    const storage = new MemoryStorage();
    let relaunched = false;
    const store = new UpdaterStore({
      check: () =>
        Promise.resolve({
          version: "0.2.0",
          body: "Must not be marked",
          downloadAndInstall: () => Promise.resolve(),
        }),
      storage: () => storage,
      flushPending: () => Promise.reject(new Error("disk full")),
      relaunch: () => {
        relaunched = true;
        return Promise.resolve();
      },
    });

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

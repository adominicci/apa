import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Reference } from "@tesina/engine";
import { PersistenceCoordinator } from "$lib/persist/coordinator";

const runtime = vi.hoisted(() => {
  Object.defineProperty(globalThis, "$state", {
    configurable: true,
    value: Object.assign(<T>(initial: T): T => initial, {
      snapshot: <T>(value: T): T => value,
    }),
  });
  return {
    writeJsonAtomic: vi.fn(),
  };
});

vi.mock("$lib/persist/atomic", () => ({
  readJson: vi.fn().mockResolvedValue(null),
  writeJsonAtomic: runtime.writeJsonAtomic,
}));

import { LibraryStore } from "./library.svelte.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function reference(id: string): Reference {
  return {
    id,
    type: "website",
    authors: [{ kind: "person", family: "Rivera", given: "Alex" }],
    date: { year: 2026 },
    title: `Reference ${id}`,
    siteName: "Teaching Lab",
    url: `https://example.test/${id}`,
  };
}

let library: LibraryStore;

beforeEach(() => {
  vi.useFakeTimers();
  runtime.writeJsonAtomic.mockReset();
  library = new LibraryStore();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LibraryStore close flushing", () => {
  it("reflushes a library dirtied after its first result while a peer remains pending", async () => {
    runtime.writeJsonAtomic.mockResolvedValue(undefined);
    const coordinator = new PersistenceCoordinator();
    const registration = coordinator.register(() => library.flushPending());
    library.setPersistenceDirtyNotifier(registration.markDirty);
    const peer = deferred<void>();
    coordinator.register(() => peer.promise);

    library.add(reference("first"));
    const barrier = coordinator.flushPending();
    await drainMicrotasks();
    expect(runtime.writeJsonAtomic).toHaveBeenCalledOnce();

    library.add(reference("second"));
    peer.resolve();
    try {
      await barrier;
      expect(runtime.writeJsonAtomic).toHaveBeenCalledTimes(2);
      const latest = runtime.writeJsonAtomic.mock.calls[1]![1] as {
        references: Reference[];
      };
      expect(latest.references.map((ref) => ref.id)).toEqual([
        "first",
        "second",
      ]);
    } finally {
      library.setPersistenceDirtyNotifier(null);
      registration.unregister();
    }
  });

  it("continues flushing when a newer mutation arrives during an async write", async () => {
    const firstWrite = deferred<void>();
    runtime.writeJsonAtomic
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValueOnce(undefined);

    library.add(reference("first"));
    const flushing = library.flushPending();
    await drainMicrotasks();
    expect(runtime.writeJsonAtomic).toHaveBeenCalledOnce();

    library.add(reference("second"));
    firstWrite.resolve();
    await flushing;

    expect(runtime.writeJsonAtomic).toHaveBeenCalledTimes(2);
    const latest = runtime.writeJsonAtomic.mock.calls[1]![1] as {
      references: Reference[];
    };
    expect(latest.references.map((ref) => ref.id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("does not queue a redundant snapshot when autosave is already writing the current revision", async () => {
    const writing = deferred<void>();
    runtime.writeJsonAtomic.mockReturnValueOnce(writing.promise);

    library.add(reference("only"));
    await vi.advanceTimersByTimeAsync(300);
    const flushing = library.flushPending();
    expect(runtime.writeJsonAtomic).toHaveBeenCalledOnce();

    writing.resolve();
    await flushing;
    expect(runtime.writeJsonAtomic).toHaveBeenCalledOnce();
  });

  it("retries a transient flush failure without requiring another mutation", async () => {
    runtime.writeJsonAtomic
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);
    library.add(reference("retry"));

    await expect(library.flushPending()).rejects.toThrow("temporary failure");
    await expect(library.flushPending()).resolves.toBeUndefined();

    expect(runtime.writeJsonAtomic).toHaveBeenCalledTimes(2);
  });

  it("awaits an in-flight write and persists a newer debounced mutation before close", async () => {
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    runtime.writeJsonAtomic
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(secondWrite.promise);
    const coordinator = new PersistenceCoordinator();
    const registration = coordinator.register(() => library.flushPending());

    library.add(reference("first"));
    await vi.advanceTimersByTimeAsync(300);
    expect(runtime.writeJsonAtomic).toHaveBeenCalledOnce();

    library.add(reference("second"));
    const closing = coordinator.flushPending();
    await Promise.resolve();
    expect(runtime.writeJsonAtomic).toHaveBeenCalledOnce();

    firstWrite.resolve();
    await vi.waitFor(() => {
      expect(runtime.writeJsonAtomic).toHaveBeenCalledTimes(2);
    });
    const latest = runtime.writeJsonAtomic.mock.calls[1]![1] as {
      references: Reference[];
    };
    expect(latest.references.map((ref) => ref.id)).toEqual([
      "first",
      "second",
    ]);

    let closed = false;
    void closing.then(() => (closed = true));
    await Promise.resolve();
    expect(closed).toBe(false);
    secondWrite.resolve();
    await closing;
    expect(closed).toBe(true);
    registration.unregister();
  });
});

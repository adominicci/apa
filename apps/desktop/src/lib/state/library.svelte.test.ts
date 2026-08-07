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

import { library } from "./library.svelte.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
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

beforeEach(() => {
  vi.useFakeTimers();
  runtime.writeJsonAtomic.mockReset();
  library.references = [];
  library.collections = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LibraryStore close flushing", () => {
  it("awaits an in-flight write and persists a newer debounced mutation before close", async () => {
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    runtime.writeJsonAtomic
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(secondWrite.promise);
    const coordinator = new PersistenceCoordinator();
    const unregister = coordinator.register(() => library.flushPending());

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
    unregister();
  });
});

import { describe, expect, it, vi } from "vitest";
import { PersistenceCoordinator } from "./coordinator.ts";

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

describe("PersistenceCoordinator", () => {
  it("resolves after a failed flush is superseded by a successful dirty generation", async () => {
    const coordinator = new PersistenceCoordinator();
    const transientFailure = new Error("transient-first-attempt");
    let attempts = 0;
    const registration: ReturnType<PersistenceCoordinator["register"]> =
      coordinator.register(() => {
        attempts += 1;
        if (attempts === 1) {
          registration.markDirty();
          return Promise.reject(transientFailure);
        }
        return Promise.resolve();
      });

    await expect(coordinator.flushPending()).resolves.toBeUndefined();

    expect(attempts).toBe(2);
  });

  it("waits for every flusher to settle before propagating an early rejection", async () => {
    const coordinator = new PersistenceCoordinator();
    const slow = deferred<void>();
    const error = new Error("disk full");
    coordinator.register(() => Promise.reject(error));
    const slowFlusher = vi.fn(() => slow.promise);
    coordinator.register(slowFlusher);

    const barrier = coordinator.flushPending();
    let settled = false;
    void barrier.then(
      () => (settled = true),
      () => (settled = true),
    );
    await drainMicrotasks();

    expect(settled).toBe(false);
    const concurrentRetry = coordinator.flushPending();
    expect(concurrentRetry).toBe(barrier);
    expect(slowFlusher).toHaveBeenCalledOnce();
    slow.resolve();
    const [firstResult, retryResult] = await Promise.allSettled([
      barrier,
      concurrentRetry,
    ]);
    expect(firstResult).toEqual({ status: "rejected", reason: error });
    expect(retryResult).toEqual({ status: "rejected", reason: error });
    expect(slowFlusher).toHaveBeenCalledOnce();
  });

  it("flushes registrations added during a batch without repeating stable successes", async () => {
    const coordinator = new PersistenceCoordinator();
    const first = deferred<void>();
    const firstFlusher = vi.fn(() => first.promise);
    const lateFlusher = vi.fn(() => Promise.resolve());
    coordinator.register(firstFlusher);

    const barrier = coordinator.flushPending();
    await Promise.resolve();
    coordinator.register(lateFlusher);
    first.resolve();
    await barrier;

    expect(firstFlusher).toHaveBeenCalledOnce();
    expect(lateFlusher).toHaveBeenCalledOnce();
  });

  it("does not flush a late registration removed before the next batch captures it", async () => {
    const coordinator = new PersistenceCoordinator();
    const peer = deferred<void>();
    coordinator.register(() => peer.promise);
    const staleFlusher = vi.fn(() => Promise.resolve());

    const barrier = coordinator.flushPending();
    await drainMicrotasks();
    const staleRegistration = coordinator.register(staleFlusher);
    staleRegistration.unregister();
    peer.resolve();
    await barrier;

    expect(staleFlusher).not.toHaveBeenCalled();
  });

  it("shares a concurrent barrier while a captured unregistering flusher finishes", async () => {
    const coordinator = new PersistenceCoordinator();
    const slow = deferred<void>();
    const flusher = vi.fn(() => slow.promise);
    const registration = coordinator.register(flusher);

    const first = coordinator.flushPending();
    registration.unregister();
    const concurrent = coordinator.flushPending();

    expect(concurrent).toBe(first);
    await drainMicrotasks();
    expect(flusher).toHaveBeenCalledOnce();
    slow.resolve();
    await Promise.all([first, concurrent]);
    expect(flusher).toHaveBeenCalledOnce();
  });
});

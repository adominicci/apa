import { describe, expect, it, vi } from "vitest";
import { createCloseRequestHandler } from "./windowClose.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe("native close persistence barrier", () => {
  it("prevents duplicate close requests from destroying the window twice", async () => {
    const flushing = deferred<void>();
    const destroy = vi.fn<() => Promise<void>>().mockResolvedValue();
    const close = createCloseRequestHandler({
      flushPending: () => flushing.promise,
      destroy,
      onError: vi.fn(),
    });
    const firstPrevent = vi.fn();
    const secondPrevent = vi.fn();

    const first = close({ preventDefault: firstPrevent });
    const second = close({ preventDefault: secondPrevent });
    flushing.resolve();
    await Promise.all([first, second]);

    expect(firstPrevent).toHaveBeenCalledOnce();
    expect(secondPrevent).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("keeps the window open when persistence fails", async () => {
    const error = new Error("disk full");
    const destroy = vi.fn<() => Promise<void>>().mockResolvedValue();
    const onError = vi.fn();
    const close = createCloseRequestHandler({
      flushPending: () => Promise.reject(error),
      destroy,
      onError,
    });

    await close({ preventDefault: vi.fn() });

    expect(destroy).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(error);
  });
});

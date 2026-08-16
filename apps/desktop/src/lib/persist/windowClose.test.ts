import { describe, expect, it, vi } from "vitest";
import {
  createCloseRequestHandler,
  createQuitRequest,
  type ShutdownDependencies,
  ShutdownTimeout,
} from "./windowClose.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function shutdown(
  overrides: Partial<ShutdownDependencies> = {},
): ShutdownDependencies {
  return {
    flushPending: () => Promise.resolve(),
    exitApp: vi.fn<() => Promise<void>>().mockResolvedValue(),
    confirmQuit: () => Promise.resolve(true),
    confirmQuitWithoutSaving: () => Promise.resolve(false),
    onError: vi.fn(),
    // Never elapses unless a test asks for it.
    delay: () => new Promise<void>(() => {}),
    ...overrides,
  };
}

describe("quit request", () => {
  it("saves before exiting once the user confirms", async () => {
    const exitApp = vi.fn<() => Promise<void>>().mockResolvedValue();
    const flushPending = vi.fn<() => Promise<void>>().mockResolvedValue();
    const quit = createQuitRequest(shutdown({ exitApp, flushPending }));

    await quit();

    expect(flushPending).toHaveBeenCalledOnce();
    expect(exitApp).toHaveBeenCalledOnce();
  });

  it("does nothing when the user cancels the confirmation", async () => {
    const exitApp = vi.fn<() => Promise<void>>().mockResolvedValue();
    const flushPending = vi.fn<() => Promise<void>>().mockResolvedValue();
    const quit = createQuitRequest(
      shutdown({
        exitApp,
        flushPending,
        confirmQuit: () => Promise.resolve(false),
      }),
    );

    await quit();

    expect(flushPending).not.toHaveBeenCalled();
    expect(exitApp).not.toHaveBeenCalled();
  });

  it("ignores a second request while the first is still saving", async () => {
    const flushing = deferred<void>();
    const exitApp = vi.fn<() => Promise<void>>().mockResolvedValue();
    const confirmQuit = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const quit = createQuitRequest(
      shutdown({ exitApp, confirmQuit, flushPending: () => flushing.promise }),
    );

    const first = quit();
    const second = quit();
    flushing.resolve();
    await Promise.all([first, second]);

    expect(confirmQuit).toHaveBeenCalledOnce();
    expect(exitApp).toHaveBeenCalledOnce();
  });

  it("offers a way out when the save barrier outlives its deadline", async () => {
    const exitApp = vi.fn<() => Promise<void>>().mockResolvedValue();
    const onError = vi.fn();
    const confirmQuitWithoutSaving = vi.fn<
      (error: unknown) => Promise<boolean>
    >()
      .mockResolvedValue(true);
    const quit = createQuitRequest(
      shutdown({
        exitApp,
        onError,
        confirmQuitWithoutSaving,
        // Never settles: exactly the hang this deadline exists for.
        flushPending: () => new Promise<void>(() => {}),
        delay: () => Promise.resolve(),
      }),
    );

    await quit();

    expect(onError.mock.calls[0][0]).toBeInstanceOf(ShutdownTimeout);
    expect(confirmQuitWithoutSaving).toHaveBeenCalledOnce();
    expect(exitApp).toHaveBeenCalledOnce();
  });

  it("stays open and resumes when the user declines to quit unsaved", async () => {
    const error = new Error("disk full");
    const exitApp = vi.fn<() => Promise<void>>().mockResolvedValue();
    const onError = vi.fn();
    const resumeAfterFailedShutdown = vi.fn<() => Promise<void>>()
      .mockResolvedValue();
    const quit = createQuitRequest(
      shutdown({
        exitApp,
        onError,
        resumeAfterFailedShutdown,
        flushPending: () => Promise.reject(error),
      }),
    );

    await quit();

    expect(exitApp).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(error);
    expect(resumeAfterFailedShutdown).toHaveBeenCalledOnce();
  });

  it("stays usable when the exit call itself is refused", async () => {
    // A missing `process:allow-exit` capability rejects every exit. The first
    // press must not become the only press.
    const exitApp = vi.fn<() => Promise<void>>()
      .mockRejectedValue(new Error("process.exit not allowed"));
    const confirmQuit = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const quit = createQuitRequest(
      shutdown({
        exitApp,
        confirmQuit,
        confirmQuitWithoutSaving: () => Promise.resolve(true),
      }),
    );

    await quit();
    await quit();

    expect(confirmQuit).toHaveBeenCalledTimes(2);
    expect(exitApp).toHaveBeenCalledTimes(4);
  });

  it("can be retried after the user declined the unsaved quit", async () => {
    const exitApp = vi.fn<() => Promise<void>>().mockResolvedValue();
    let failing = true;
    const quit = createQuitRequest(
      shutdown({
        exitApp,
        flushPending: () =>
          failing ? Promise.reject(new Error("busy")) : Promise.resolve(),
      }),
    );

    await quit();
    expect(exitApp).not.toHaveBeenCalled();

    failing = false;
    await quit();
    expect(exitApp).toHaveBeenCalledOnce();
  });
});

describe("native close button", () => {
  it("hides the window on macOS and leaves the app running", async () => {
    const hideWindow = vi.fn<() => Promise<void>>().mockResolvedValue();
    const quit = vi.fn<() => Promise<void>>().mockResolvedValue();
    const close = createCloseRequestHandler({
      hostOs: "macos",
      hideWindow,
      quit,
      onError: vi.fn(),
    });
    const preventDefault = vi.fn();

    await close({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(hideWindow).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();
  });

  it("routes to the shared quit request everywhere else", async () => {
    const hideWindow = vi.fn<() => Promise<void>>().mockResolvedValue();
    const quit = vi.fn<() => Promise<void>>().mockResolvedValue();
    const close = createCloseRequestHandler({
      hostOs: "windows",
      hideWindow,
      quit,
      onError: vi.fn(),
    });
    const preventDefault = vi.fn();

    await close({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(hideWindow).not.toHaveBeenCalled();
    expect(quit).toHaveBeenCalledOnce();
  });

  it("reports a failed hide instead of leaving the button dead", async () => {
    const error = new Error("no window");
    const onError = vi.fn();
    const close = createCloseRequestHandler({
      hostOs: "macos",
      hideWindow: () => Promise.reject(error),
      quit: vi.fn<() => Promise<void>>().mockResolvedValue(),
      onError,
    });

    await close({ preventDefault: vi.fn() });

    expect(onError).toHaveBeenCalledWith(error);
  });
});

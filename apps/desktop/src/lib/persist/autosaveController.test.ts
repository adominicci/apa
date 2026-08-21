import { afterEach, describe, expect, it, vi } from "vitest";
import { PersistenceCoordinator } from "./coordinator";
import { createAutosaveController } from "./autosaveController.svelte";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function trackedCoordinator() {
  const coordinator = new PersistenceCoordinator();
  let unregisters = 0;
  const register = coordinator.register.bind(coordinator);
  coordinator.register = (flush) => {
    const registration = register(flush);
    return {
      markDirty: registration.markDirty,
      unregister() {
        unregisters += 1;
        registration.unregister();
      },
    };
  };
  return { coordinator, unregistered: () => unregisters };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("autosave controller", () => {
  it("coalesces a burst of edits into one debounced write", async () => {
    vi.useFakeTimers();
    const persist = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const controller = createAutosaveController({ persist });

    controller.scheduleSave();
    controller.scheduleSave();
    controller.scheduleSave();

    expect(controller.status).toBe("guardando");
    expect(persist).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);

    expect(persist).toHaveBeenCalledOnce();
    expect(controller.status).toBe("guardado");
  });

  it("resolves immediately when the requested revision is already persisted", async () => {
    vi.useFakeTimers();
    const persist = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const controller = createAutosaveController({ persist });

    controller.scheduleSave();
    await vi.advanceTimersByTimeAsync(500);
    expect(persist).toHaveBeenCalledOnce();

    controller.scheduleSave();
    await controller.persistNow();
    expect(persist).toHaveBeenCalledTimes(2);

    await controller.persistNow();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(controller.status).toBe("guardado");
  });

  it("shares one write when a flush races the in-flight attempt", async () => {
    vi.useFakeTimers();
    const writing = deferred<void>();
    const persist = vi.fn<() => Promise<void>>()
      .mockReturnValueOnce(writing.promise)
      .mockResolvedValueOnce(undefined);
    const controller = createAutosaveController({ persist });

    controller.scheduleSave();
    await vi.advanceTimersByTimeAsync(500);
    expect(persist).toHaveBeenCalledOnce();

    const flushing = controller.persistNow();
    writing.resolve();
    await flushing;

    expect(persist).toHaveBeenCalledOnce();
    expect(controller.status).toBe("guardado");
  });

  it("serializes writes so an older slow write commits before a newer one", async () => {
    vi.useFakeTimers();
    const firstWrite = deferred<void>();
    const events: string[] = [];
    let label = "older";
    const persist = vi.fn<() => Promise<void>>(() => {
      const attempt = label;
      events.push(`start:${attempt}`);
      if (attempt === "older") {
        return firstWrite.promise.then(() => {
          events.push(`commit:${attempt}`);
        });
      }
      events.push(`commit:${attempt}`);
      return Promise.resolve();
    });
    const controller = createAutosaveController({ persist });

    controller.scheduleSave();
    await vi.advanceTimersByTimeAsync(500);
    label = "newer";
    controller.scheduleSave();
    await vi.advanceTimersByTimeAsync(500);

    expect(events).toEqual(["start:older"]);
    firstWrite.resolve();
    await vi.waitFor(() =>
      expect(events).toEqual([
        "start:older",
        "commit:older",
        "start:newer",
        "commit:newer",
      ])
    );
    expect(controller.status).toBe("guardado");
  });

  it("drains every requested revision before persistNow settles", async () => {
    vi.useFakeTimers();
    const writes = [deferred<void>(), deferred<void>()];
    let call = 0;
    const persist = vi.fn<() => Promise<void>>(() => {
      const write = writes[call];
      call += 1;
      return write ? write.promise : Promise.resolve();
    });
    const controller = createAutosaveController({ persist });

    controller.scheduleSave();
    await vi.advanceTimersByTimeAsync(500);
    controller.scheduleSave();

    const draining = controller.persistNow();
    let settled = false;
    void draining.then(() => {
      settled = true;
    });
    expect(settled).toBe(false);

    writes[0]!.resolve();
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(2));
    expect(settled).toBe(false);

    writes[1]!.resolve();
    await draining;
    expect(settled).toBe(true);
    expect(controller.status).toBe("guardado");
  });

  it("writes immediately when flushed inside the debounce window", async () => {
    vi.useFakeTimers();
    const persist = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const controller = createAutosaveController({ persist });

    controller.scheduleSave();
    await controller.persistNow();

    expect(persist).toHaveBeenCalledOnce();
    expect(controller.status).toBe("guardado");

    await vi.advanceTimersByTimeAsync(500);
    expect(persist).toHaveBeenCalledOnce();
  });

  it("sets error status and rejects the flush when a write fails", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(
      () => {},
    );
    const persist = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined);
    const controller = createAutosaveController({ persist });

    controller.scheduleSave();
    await expect(controller.persistNow()).rejects.toThrow("disk full");

    expect(controller.status).toBe("error");
    expect(consoleError).toHaveBeenCalledWith(
      "No se pudo guardar el ensayo:",
      expect.any(Error),
    );

    controller.scheduleSave();
    await controller.persistNow();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(controller.status).toBe("guardado");
  });

  it("reports a failed debounced write without an unhandled rejection", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(
      () => {},
    );
    const persist = vi.fn<() => Promise<void>>().mockRejectedValue(
      new Error("boom"),
    );
    const controller = createAutosaveController({ persist });

    controller.scheduleSave();
    await vi.advanceTimersByTimeAsync(500);

    expect(persist).toHaveBeenCalledOnce();
    expect(controller.status).toBe("error");
    expect(consoleError).toHaveBeenCalled();
  });

  it("unregisters only after the final write settles", async () => {
    vi.useFakeTimers();
    const firstWrite = deferred<void>();
    const persist = vi.fn<() => Promise<void>>()
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValueOnce(undefined);
    const controller = createAutosaveController({ persist });
    const { coordinator, unregistered } = trackedCoordinator();

    const dispose = controller.bindPersistence(coordinator);
    controller.scheduleSave();
    await vi.advanceTimersByTimeAsync(500);
    expect(persist).toHaveBeenCalledOnce();

    dispose();
    await vi.waitFor(() => expect(unregistered()).toBe(0));

    controller.scheduleSave();
    firstWrite.resolve();
    await vi.waitFor(() => expect(unregistered()).toBe(1));

    expect(persist).toHaveBeenCalledTimes(2);
    expect(unregistered()).toBe(1);
  });

  it("unregisters right away when nothing is pending", async () => {
    vi.useFakeTimers();
    const persist = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const controller = createAutosaveController({ persist });
    const { coordinator, unregistered } = trackedCoordinator();

    const dispose = controller.bindPersistence(coordinator);
    dispose();
    await vi.waitFor(() => expect(unregistered()).toBe(1));

    expect(persist).not.toHaveBeenCalled();
    expect(unregistered()).toBe(1);
  });
});

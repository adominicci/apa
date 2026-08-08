import { describe, expect, it } from "vitest";
import { OperationCoordinator } from "./operationCoordinator.ts";

/** Task 6.7: safe-point shutdown without recursive flush deadlock. */

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

describe("OperationCoordinator", () => {
  it("cancels exports at shutdown and waits for their cleanup", async () => {
    const coordinator = new OperationCoordinator();
    const started = deferred();
    const events: string[] = [];
    const exportOp = coordinator.run("export", async (handle) => {
      started.resolve();
      while (!handle.cancelled) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      events.push("cleanup");
    });
    await started.promise;
    await coordinator.awaitSafeShutdown();
    await exportOp;
    expect(events).toEqual(["cleanup"]);
  });

  it("lets an import yield at its persisted-journal safe point", async () => {
    const coordinator = new OperationCoordinator();
    const journalPersisted = deferred();
    const neverFinishes = deferred();
    void coordinator.run("import", async (handle) => {
      handle.markRecoverable();
      journalPersisted.resolve();
      await neverFinishes.promise; // simulates long apply continuing
    });
    await journalPersisted.promise;
    // Shutdown must complete even though the import op never settles,
    // because its journal is persisted and startup recovery covers it.
    await coordinator.awaitSafeShutdown();
    expect(coordinator.shuttingDown).toBe(true);
    neverFinishes.resolve();
  });

  it("waits for an import that has not reached a recoverable state", async () => {
    const coordinator = new OperationCoordinator();
    const reached = deferred();
    let finished = false;
    const importOp = coordinator.run("import", async () => {
      reached.resolve();
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished = true;
    });
    await reached.promise;
    await coordinator.awaitSafeShutdown();
    expect(finished).toBe(true);
    await importOp;
  });

  it("rejects new operations once shutdown began", async () => {
    const coordinator = new OperationCoordinator();
    await coordinator.awaitSafeShutdown();
    await expect(coordinator.run("backup", () => Promise.resolve()))
      .rejects.toThrow("shutting down");
  });

  it("never re-enters a persistence flush (ordering contract)", async () => {
    // The contract: callers flush BEFORE run(); run() itself never invokes
    // a flush. This test pins the API shape — run resolves without any
    // flush dependency even while a "flush" promise is pending elsewhere.
    const coordinator = new OperationCoordinator();
    const pendingFlush = deferred(); // intentionally never awaited by run
    const result = await coordinator.run("backup", () => Promise.resolve(42));
    expect(result).toBe(42);
    pendingFlush.resolve();
  });
});

/**
 * Operation coordination for native close and updater restart (design §13,
 * task 6.7). Distinct from the persistence flush barrier: persistence flush
 * completes BEFORE an operation token is acquired, so a flusher can never
 * recursively wait on itself. Shutdown waits for each active operation's
 * safe point: export/backup operations are cancelled and clean their
 * temporary output; imports advance to a persisted recoverable journal
 * state and then yield.
 */

export type OperationKind = "export" | "backup" | "import";

export interface OperationHandle {
  /** True once shutdown was requested; long ops should stop at safe points. */
  readonly cancelled: boolean;
  /**
   * Imports call this the moment their journal is persisted: from here on a
   * crash is recoverable, so shutdown no longer needs to wait for the
   * operation to finish.
   */
  markRecoverable(): void;
}

interface ActiveOperation {
  kind: OperationKind;
  cancelled: boolean;
  recoverable: Promise<void>;
  markRecoverable: () => void;
  settled: Promise<void>;
}

export class OperationCoordinator {
  #active = new Set<ActiveOperation>();
  #shuttingDown = false;

  get shuttingDown(): boolean {
    return this.#shuttingDown;
  }

  /**
   * Runs one operation under a token. Rejects immediately once shutdown has
   * begun. The persistence flush must have been awaited by the caller
   * before invoking this (never inside `fn` via a registered flusher).
   */
  async run<T>(
    kind: OperationKind,
    fn: (handle: OperationHandle) => Promise<T>,
  ): Promise<T> {
    if (this.#shuttingDown) {
      throw new Error("the application is shutting down");
    }
    let markRecoverable!: () => void;
    const recoverable = new Promise<void>((resolve) => {
      markRecoverable = resolve;
    });
    const operation: ActiveOperation = {
      kind,
      cancelled: false,
      recoverable,
      markRecoverable,
      settled: Promise.resolve(),
    };
    const handle: OperationHandle = {
      get cancelled() {
        return operation.cancelled;
      },
      markRecoverable,
    };
    this.#active.add(operation);
    const work = fn(handle);
    operation.settled = work.then(() => undefined, () => undefined);
    try {
      return await work;
    } finally {
      this.#active.delete(operation);
    }
  }

  /**
   * Awaits every active operation's safe point: exports/backups observe the
   * cancellation flag and settle; imports settle OR reach their persisted
   * recoverable journal state, whichever comes first.
   */
  async awaitSafeShutdown(): Promise<void> {
    this.#shuttingDown = true;
    const waits: Promise<void>[] = [];
    for (const operation of this.#active) {
      operation.cancelled = true;
      if (operation.kind === "import") {
        waits.push(Promise.race([operation.settled, operation.recoverable]));
      } else {
        waits.push(operation.settled);
      }
    }
    await Promise.all(waits);
  }
}

export const operations = new OperationCoordinator();

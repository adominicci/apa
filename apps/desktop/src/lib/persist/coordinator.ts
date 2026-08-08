export type FlushPending = () => Promise<void>;

interface Registration {
  flush: FlushPending;
  dirtyGeneration: number;
}

export interface PersistenceRegistration {
  markDirty(): void;
  unregister(): void;
}

/**
 * App-level persistence barrier used by native close and updater relaunch.
 * Stores register only while they own live state. Concurrent barrier requests
 * share one flush so a duplicate close event cannot start competing writes.
 */
export class PersistenceCoordinator {
  #registrations = new Set<Registration>();
  #registeredDuringBarrier = new Set<Registration>();
  #activityGeneration = 0;
  #activeFlush: Promise<void> | null = null;
  #maintenanceChain: Promise<unknown> = Promise.resolve();

  /**
   * Monotonic counter that moves on every observable persistence activity:
   * registrations, markDirty, and — via noteDirectWrite() — the write paths
   * that call the atomic writers without a coordinator registration (essay
   * create/persist/delete, figure imports). Snapshot capture records it
   * before reading and retries when it moved (design §2).
   */
  get activityGeneration(): number {
    return this.#activityGeneration;
  }

  /** Called by the atomic write helpers on every direct app-data write. */
  noteDirectWrite(): void {
    this.#activityGeneration += 1;
    this.#notifyActivity();
  }

  #activityListeners = new Set<() => void>();

  /**
   * Lightweight persistence-activity signal (design §9): fires on every
   * registration, markDirty, and direct write. Carries no essay data — the
   * backup coordinator uses it only to schedule a debounced digest check,
   * so persistence ownership never moves into the backup feature.
   */
  subscribeActivity(listener: () => void): () => void {
    this.#activityListeners.add(listener);
    return () => {
      this.#activityListeners.delete(listener);
    };
  }

  #notifyActivity(): void {
    for (const listener of this.#activityListeners) {
      try {
        listener();
      } catch {
        // a listener must never break persistence
      }
    }
  }

  /**
   * Exclusive snapshot/maintenance lease: export, backup, rollback capture,
   * import apply, and retention run through here one at a time, FIFO. The
   * lease does not block ordinary persistence writes — capture detects and
   * retries on mutation instead (design §2 amended).
   */
  runMaintenance<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#maintenanceChain.catch(() => undefined).then(fn);
    this.#maintenanceChain = run.catch(() => undefined);
    return run;
  }

  register(flush: FlushPending): PersistenceRegistration {
    const registration = { flush, dirtyGeneration: 0 };
    this.#registrations.add(registration);
    if (this.#activeFlush) {
      this.#registeredDuringBarrier.add(registration);
    }
    this.#activityGeneration += 1;
    let registered = true;
    return {
      markDirty: () => {
        if (!registered) return;
        registration.dirtyGeneration += 1;
        this.#activityGeneration += 1;
      },
      unregister: () => {
        if (!registered) return;
        registered = false;
        this.#registrations.delete(registration);
        this.#registeredDuringBarrier.delete(registration);
        this.#activityGeneration += 1;
      },
    };
  }

  flushPending(): Promise<void> {
    if (this.#activeFlush) return this.#activeFlush;
    const active = this.#flushUntilMembershipStabilizes();
    this.#activeFlush = active;
    const clear = () => {
      if (this.#activeFlush === active) this.#activeFlush = null;
    };
    void active.then(clear, clear);
    return active;
  }

  async #flushUntilMembershipStabilizes(): Promise<void> {
    const attemptedGeneration = new Map<Registration, number>();
    const failures = new Map<Registration, unknown>();

    while (true) {
      const generation = this.#activityGeneration;
      const batch = new Set([
        ...this.#registrations,
        ...this.#registeredDuringBarrier,
      ]);
      const pending = [...batch].filter((entry) =>
        attemptedGeneration.get(entry) !== entry.dirtyGeneration
      );
      for (const entry of pending) {
        attemptedGeneration.set(entry, entry.dirtyGeneration);
        this.#registeredDuringBarrier.delete(entry);
      }

      const results = await Promise.allSettled(
        pending.map((entry) => Promise.resolve().then(entry.flush)),
      );
      for (const [index, result] of results.entries()) {
        const entry = pending[index];
        if (result.status === "rejected") {
          failures.set(entry, result.reason);
        } else {
          failures.delete(entry);
        }
      }

      if (
        generation === this.#activityGeneration &&
        this.#registeredDuringBarrier.size === 0
      ) {
        const reasons = [...failures.values()];
        if (reasons.length === 1) throw reasons[0];
        if (reasons.length > 1) {
          throw new AggregateError(reasons, "Persistence flush failed");
        }
        return;
      }
    }
  }
}

export const persistence = new PersistenceCoordinator();

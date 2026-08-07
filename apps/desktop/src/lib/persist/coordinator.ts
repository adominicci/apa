export type FlushPending = () => Promise<void>;

/**
 * App-level persistence barrier used by native close and updater relaunch.
 * Stores register only while they own live state. Concurrent barrier requests
 * share one flush so a duplicate close event cannot start competing writes.
 */
export class PersistenceCoordinator {
  #flushers = new Set<FlushPending>();
  #activeFlush: Promise<void> | null = null;

  register(flush: FlushPending): () => void {
    this.#flushers.add(flush);
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      this.#flushers.delete(flush);
    };
  }

  flushPending(): Promise<void> {
    if (this.#activeFlush) return this.#activeFlush;
    const flushers = [...this.#flushers];
    const active = Promise.all(flushers.map((flush) => flush())).then(
      () => undefined,
    );
    this.#activeFlush = active;
    void active.finally(() => {
      if (this.#activeFlush === active) this.#activeFlush = null;
    }).catch(() => {
      // The original promise remains rejected for every barrier caller. This
      // branch only handles the promise returned by `finally`.
    });
    return active;
  }
}

export const persistence = new PersistenceCoordinator();

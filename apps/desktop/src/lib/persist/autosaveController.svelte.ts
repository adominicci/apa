import type {
  PersistenceCoordinator,
  PersistenceRegistration,
} from "./coordinator";

export type AutosaveStatus = "guardando" | "guardado" | "error";

interface EssayWriteAttempt {
  revision: number;
  promise: Promise<void>;
}

class AutosaveController {
  #status = $state<AutosaveStatus>("guardado");

  get status(): AutosaveStatus {
    return this.#status;
  }

  #persist: () => Promise<void>;
  #delay: number;
  #saveTimer: ReturnType<typeof setTimeout> | undefined;
  #requestedSaveRevision = 0;
  #persistedSaveRevision = 0;
  #saveChain: Promise<void> = Promise.resolve();
  #activeSaveAttempt: EssayWriteAttempt | null = null;
  #activePersistFlush: Promise<void> | null = null;
  #persistenceRegistration: PersistenceRegistration | null = null;

  constructor(options: { persist: () => Promise<void>; delay?: number }) {
    this.#persist = options.persist;
    this.#delay = options.delay ?? 500;
  }

  scheduleSave(): void {
    this.#requestedSaveRevision += 1;
    this.#persistenceRegistration?.markDirty();
    const revision = this.#requestedSaveRevision;
    this.#status = "guardando";
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = undefined;
      void this.#enqueuePersist(revision).catch((error) => {
        this.#reportPersistError(error, revision);
      });
    }, this.#delay);
  }

  persistNow(): Promise<void> {
    if (this.#activePersistFlush) return this.#activePersistFlush;
    const active = this.#flushUntilCaughtUp();
    this.#activePersistFlush = active;
    const clear = () => {
      if (this.#activePersistFlush === active) this.#activePersistFlush = null;
    };
    void active.then(clear, clear);
    return active;
  }

  bindPersistence(persistence: PersistenceCoordinator): () => void {
    const registration = persistence.register(() => this.persistNow());
    this.#persistenceRegistration = registration;
    return () => {
      // Svelte destruction cannot await cleanup. Keep the callback registered
      // until its serialized final write settles so a concurrent app-close
      // barrier can still observe it.
      void this.persistNow().catch((error) => {
        this.#reportPersistError(error, this.#requestedSaveRevision);
      }).finally(() => {
        if (this.#persistenceRegistration === registration) {
          this.#persistenceRegistration = null;
        }
        registration.unregister();
      });
    };
  }

  #enqueuePersist(revision: number): Promise<void> {
    if (this.#persistedSaveRevision >= revision) return Promise.resolve();
    if (this.#activeSaveAttempt?.revision === revision) {
      return this.#activeSaveAttempt.promise;
    }

    const write = this.#saveChain.catch(() => undefined).then(async () => {
      await this.#persist();
      this.#persistedSaveRevision = Math.max(
        this.#persistedSaveRevision,
        revision,
      );
      if (revision === this.#requestedSaveRevision) this.#status = "guardado";
    });
    const attempt = { revision, promise: write };
    this.#activeSaveAttempt = attempt;
    this.#saveChain = write;
    const clear = () => {
      if (this.#activeSaveAttempt === attempt) this.#activeSaveAttempt = null;
    };
    void write.then(clear, clear);
    return write;
  }

  #reportPersistError(error: unknown, revision: number): void {
    console.error("No se pudo guardar el ensayo:", error);
    if (revision === this.#requestedSaveRevision) this.#status = "error";
  }

  async #flushUntilCaughtUp(): Promise<void> {
    while (this.#persistedSaveRevision < this.#requestedSaveRevision) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = undefined;
      const revision = this.#requestedSaveRevision;
      this.#status = "guardando";
      try {
        await this.#enqueuePersist(revision);
      } catch (error) {
        this.#reportPersistError(error, revision);
        throw error;
      }
    }
  }
}

export function createAutosaveController(options: {
  persist: () => Promise<void>;
  delay?: number;
}): {
  readonly status: AutosaveStatus;
  scheduleSave(): void;
  persistNow(): Promise<void>;
  bindPersistence(persistence: PersistenceCoordinator): () => void;
} {
  return new AutosaveController(options);
}

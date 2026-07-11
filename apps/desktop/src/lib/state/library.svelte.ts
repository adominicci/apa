import type { Reference } from "@tesina/engine";
import { readJson, writeJsonAtomic } from "$lib/persist/atomic";

const LIBRARY_FILE = "library.json";

interface LibraryFile {
  schemaVersion: 1;
  references: Reference[];
}

/**
 * The universal reference library (plan §data model): source of truth in
 * $APPDATA/library.json, shared by every essay. Collections and the
 * essay-snapshot reconciliation arrive with the reference manager screen.
 */
class LibraryStore {
  references = $state<Reference[]>([]);
  loaded = $state(false);
  #saveTimer: ReturnType<typeof setTimeout> | undefined;

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = await readJson<LibraryFile>(LIBRARY_FILE);
      if (data?.references) this.references = data.references;
    } catch (err) {
      console.error("No se pudo cargar la biblioteca:", err);
    } finally {
      this.loaded = true;
    }
  }

  #persist(): void {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      const file: LibraryFile = {
        schemaVersion: 1,
        references: $state.snapshot(this.references) as Reference[],
      };
      writeJsonAtomic(LIBRARY_FILE, file).catch((err) => {
        console.error("No se pudo guardar la biblioteca:", err);
      });
    }, 300);
  }

  add(ref: Reference): void {
    this.references = [...this.references, ref];
    this.#persist();
  }

  update(ref: Reference): void {
    this.references = this.references.map((r) => (r.id === ref.id ? ref : r));
    this.#persist();
  }

  remove(id: string): void {
    this.references = this.references.filter((r) => r.id !== id);
    this.#persist();
  }

  byId(): Map<string, Reference> {
    return new Map(
      ($state.snapshot(this.references) as Reference[]).map(
        (r) => [r.id, r],
      ),
    );
  }
}

export const library = new LibraryStore();

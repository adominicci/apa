import type { Reference } from "@tesina/engine";
import { readJson, writeJsonAtomic } from "$lib/persist/atomic";
import {
  addAllToCollection,
  createCollection,
  deleteCollection,
  pruneRefId,
  type RefCollection,
  renameCollection,
  toggleMembership,
} from "$lib/model/collections";

const LIBRARY_FILE = "library.json";

interface LibraryFile {
  schemaVersion: 1;
  references: Reference[];
  /**
   * Tag-like groupings; absent in files written before the reference manager.
   * Additive — `schemaVersion` stays 1 and `load()` tolerates its absence.
   */
  collections?: RefCollection[];
}

/**
 * The universal reference library (plan §data model): source of truth in
 * $APPDATA/library.json, shared by every essay. Collections (tag-like) live
 * alongside the references; the essay-snapshot reconciliation that restores a
 * deleted reference from an essay's denormalized copy is handled by
 * `restore()` (see model/reconcile.ts).
 */
export class LibraryStore {
  references = $state<Reference[]>([]);
  collections = $state<RefCollection[]>([]);
  loaded = $state(false);
  #saveTimer: ReturnType<typeof setTimeout> | undefined;
  #writeChain: Promise<void> = Promise.resolve();

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = await readJson<LibraryFile>(LIBRARY_FILE);
      if (data?.references) this.references = data.references;
      if (data?.collections) this.collections = data.collections;
    } catch (err) {
      console.error("No se pudo cargar la biblioteca:", err);
    } finally {
      this.loaded = true;
    }
  }

  #snapshot(): LibraryFile {
    return {
      schemaVersion: 1,
      references: $state.snapshot(this.references) as Reference[],
      collections: $state.snapshot(this.collections) as RefCollection[],
    };
  }

  #enqueue(file: LibraryFile): Promise<void> {
    const write = this.#writeChain.catch(() => undefined).then(() =>
      writeJsonAtomic(LIBRARY_FILE, file)
    );
    this.#writeChain = write;
    return write;
  }

  #persist(): void {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = undefined;
      this.#enqueue(this.#snapshot()).catch((err) => {
        console.error("No se pudo guardar la biblioteca:", err);
      });
    }, 300);
  }

  /** Persist the latest state after every already-started atomic write. */
  async flushPending(): Promise<void> {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = undefined;
    await this.#enqueue(this.#snapshot());
  }

  add(ref: Reference): void {
    this.references = [...this.references, ref];
    this.#persist();
  }

  /**
   * Append a batch of references (BibTeX import) and, if a collection is given,
   * file them all into it — persisting once for the whole batch. Callers are
   * responsible for de-duplication; the import plan handles that upstream.
   */
  addMany(refs: Reference[], collectionId?: string): void {
    if (refs.length === 0) return;
    this.references = [...this.references, ...refs];
    if (collectionId) {
      this.collections = addAllToCollection(
        this.collections,
        collectionId,
        refs.map((r) => r.id),
      );
    }
    this.#persist();
  }

  update(ref: Reference): void {
    this.references = this.references.map((r) => (r.id === ref.id ? ref : r));
    this.#persist();
  }

  remove(id: string): void {
    this.references = this.references.filter((r) => r.id !== id);
    this.collections = pruneRefId(this.collections, id);
    this.#persist();
  }

  /**
   * Append references cited by an essay but missing from the library —
   * restored from the essay's denormalized snapshot. Skips ids already
   * present and persists once. See model/reconcile.ts for the selection.
   */
  restore(refs: Reference[]): void {
    const known = new Set(this.references.map((r) => r.id));
    const fresh = refs.filter((r) => !known.has(r.id));
    if (fresh.length === 0) return;
    this.references = [...this.references, ...fresh];
    this.#persist();
  }

  createCollection(name: string): void {
    this.collections = createCollection(this.collections, name);
    this.#persist();
  }

  renameCollection(id: string, name: string): void {
    this.collections = renameCollection(this.collections, id, name);
    this.#persist();
  }

  deleteCollection(id: string): void {
    this.collections = deleteCollection(this.collections, id);
    this.#persist();
  }

  toggleMembership(collectionId: string, refId: string): void {
    this.collections = toggleMembership(this.collections, collectionId, refId);
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

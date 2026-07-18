/**
 * Reference collections: tag-like groupings layered over the universal
 * library. A reference can belong to many collections; membership lives here,
 * never on the pure engine `Reference` model. Every op is pure and returns a
 * fresh array so the library store can assign it straight into `$state`.
 */
export interface RefCollection {
  id: string;
  name: string;
  refIds: string[];
}

/** Append a new, empty collection. `id` is injectable for deterministic tests. */
export function createCollection(
  collections: RefCollection[],
  name: string,
  id: string = crypto.randomUUID(),
): RefCollection[] {
  return [...collections, { id, name: name.trim(), refIds: [] }];
}

/** Rename one collection, leaving its membership intact. */
export function renameCollection(
  collections: RefCollection[],
  id: string,
  name: string,
): RefCollection[] {
  return collections.map((c) => c.id === id ? { ...c, name: name.trim() } : c);
}

/** Drop a collection entirely; the references it grouped are untouched. */
export function deleteCollection(
  collections: RefCollection[],
  id: string,
): RefCollection[] {
  return collections.filter((c) => c.id !== id);
}

/** Add `refId` to the collection if absent, remove it if present. */
export function toggleMembership(
  collections: RefCollection[],
  collectionId: string,
  refId: string,
): RefCollection[] {
  return collections.map((c) => {
    if (c.id !== collectionId) return c;
    const refIds = c.refIds.includes(refId)
      ? c.refIds.filter((r) => r !== refId)
      : [...c.refIds, refId];
    return { ...c, refIds };
  });
}

/**
 * Add every id in `refIds` to one collection, skipping ids already present.
 * Used by BibTeX import to file a whole batch into the chosen collection at
 * once; returns the same array reference when nothing changes.
 */
export function addAllToCollection(
  collections: RefCollection[],
  collectionId: string,
  refIds: string[],
): RefCollection[] {
  return collections.map((c) => {
    if (c.id !== collectionId) return c;
    const present = new Set(c.refIds);
    const additions = refIds.filter((id) => !present.has(id));
    return additions.length ? { ...c, refIds: [...c.refIds, ...additions] } : c;
  });
}

/** Remove `refId` from every collection (called when a reference is deleted). */
export function pruneRefId(
  collections: RefCollection[],
  refId: string,
): RefCollection[] {
  return collections.map((c) =>
    c.refIds.includes(refId)
      ? { ...c, refIds: c.refIds.filter((r) => r !== refId) }
      : c
  );
}

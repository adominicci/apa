import type { Reference } from "@tesina/engine";
import { collectCitedRefIds } from "$lib/editor/citedRefs";

/**
 * When an essay is opened, a reference it cites may have been deleted from the
 * shared library. Each essay keeps a denormalized `referencesSnapshot`, so we
 * can restore those entries. Returns the snapshot references that are cited in
 * the document but no longer present in the library — nothing else.
 *
 * Pure: `content` is the ProseMirror doc JSON, `snapshot` the essay's copies,
 * `existingIds` the ids already in the library. Malformed input yields `[]`.
 */
export function missingCitedRefs(
  content: unknown,
  snapshot: unknown,
  existingIds: Set<string>,
): Reference[] {
  if (!Array.isArray(snapshot)) return [];
  const cited = collectCitedRefIds(content);
  const seen = new Set<string>();
  const missing: Reference[] = [];
  for (const candidate of snapshot) {
    // The snapshot comes off disk; skip any corrupt (null / non-object /
    // id-less) entry rather than dereferencing it.
    if (
      candidate === null || typeof candidate !== "object" ||
      typeof (candidate as { id?: unknown }).id !== "string"
    ) continue;
    const ref = candidate as Reference;
    if (cited.has(ref.id) && !existingIds.has(ref.id) && !seen.has(ref.id)) {
      seen.add(ref.id);
      missing.push(ref);
    }
  }
  return missing;
}

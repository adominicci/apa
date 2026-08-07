import type { Reference } from "@tesina/engine";

export interface ExportReferenceResolution {
  references: Reference[];
  unresolvedCitedRefIds: string[];
}

/**
 * Resolves every cited id against current library data first, then the
 * essay's durable snapshot. Uncited export remains limited to the live
 * library; snapshots only preserve works this essay actually cites.
 */
export function resolveReferencesForExport(
  citedRefIds: Iterable<string>,
  liveReferences: readonly Reference[],
  snapshotReferences: readonly Reference[],
  includeUncitedReferences: boolean,
): ExportReferenceResolution {
  const liveById = new Map(liveReferences.map((ref) => [ref.id, ref]));
  const snapshotById = new Map(
    snapshotReferences.map((ref) => [ref.id, ref]),
  );
  const references: Reference[] = [];
  const included = new Set<string>();
  const unresolvedCitedRefIds: string[] = [];

  for (const refId of citedRefIds) {
    if (included.has(refId)) continue;
    const reference = liveById.get(refId) ?? snapshotById.get(refId);
    if (reference) {
      references.push(reference);
      included.add(refId);
    } else {
      unresolvedCitedRefIds.push(refId);
    }
  }

  if (includeUncitedReferences) {
    for (const reference of liveReferences) {
      if (included.has(reference.id)) continue;
      references.push(reference);
      included.add(reference.id);
    }
  }

  return { references, unresolvedCitedRefIds };
}

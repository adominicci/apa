interface DocNode {
  type?: string;
  attrs?: { items?: { refId?: string }[] };
  content?: unknown[];
}

/**
 * Walks a ProseMirror doc JSON and counts how many citation items point at
 * each reference. Drives the references panel (which works are cited, how
 * often) and the delete guard.
 */
export function collectCitedRefIds(docJson: unknown): Map<string, number> {
  const counts = new Map<string, number>();

  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const n = node as DocNode;
    if (n.type === "citation" && Array.isArray(n.attrs?.items)) {
      for (const item of n.attrs.items) {
        if (item && typeof item.refId === "string") {
          counts.set(item.refId, (counts.get(item.refId) ?? 0) + 1);
        }
      }
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
    }
  }

  walk(docJson);
  return counts;
}

interface DocNode {
  type?: string;
  content?: DocNode[];
}

const SECTION_TYPES = new Set([
  "sectionAbstract",
  "sectionBody",
  "sectionAppendix",
]);

export function defaultDoc(): DocNode {
  return {
    type: "doc",
    content: [
      { type: "sectionBody", content: [{ type: "paragraph" }] },
    ],
  };
}

/**
 * Drafts saved before M2.2 hold a flat `block+` doc; wrap their blocks in a
 * `sectionBody` so they satisfy the sectioned schema. Anything unrecognizable
 * falls back to an empty sectioned doc rather than crashing the editor.
 */
export function ensureSectionedDoc(docJson: unknown): unknown {
  if (!docJson || typeof docJson !== "object") return defaultDoc();
  const doc = docJson as DocNode;
  if (doc.type !== "doc" || !Array.isArray(doc.content)) return defaultDoc();
  if (doc.content.length === 0) return defaultDoc();
  const firstType = doc.content[0]?.type;
  if (firstType && SECTION_TYPES.has(firstType)) return docJson;
  return {
    type: "doc",
    content: [{ type: "sectionBody", content: doc.content }],
  };
}

// Owns the ProseMirror node names minted by Tesina's custom APA schema only
// (apaTable, tableTitle, figureTitle, sectionBody, keywordsLine). StarterKit
// node names declared by the schema (table, bulletList, orderedList, …) are
// deliberately excluded from this vocabulary.
export const NODE_NAMES = {
  apaTable: "apaTable",
  tableTitle: "tableTitle",
  figureTitle: "figureTitle",
  sectionBody: "sectionBody",
  keywordsLine: "keywordsLine",
} as const;
export type ApaNodeName = (typeof NODE_NAMES)[keyof typeof NODE_NAMES];

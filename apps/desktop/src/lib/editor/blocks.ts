import { type Editor, Node } from "@tiptap/core";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";

/**
 * APA tables (APA 7.8–7.21). The caption ("Table N", bold) and the "Note."
 * prefix are drawn by CSS from a counter + the document-language attribute
 * (mirroring the appendix pattern), so the *number* never lives in the doc
 * and renumbers automatically. The title and note are ordinary editable
 * inline content — no NodeView, no attribute syncing.
 *
 * Structure: apaTable → tableTitle table tableNote.
 */
export const TableTitle = Node.create({
  name: "tableTitle",
  content: "inline*",
  defining: true,
  parseHTML() {
    return [{ tag: "p[data-table-title]" }];
  },
  renderHTML() {
    return ["p", { "data-table-title": "true", class: "tbl-title" }, 0];
  },
});

export const TableNote = Node.create({
  name: "tableNote",
  content: "inline*",
  defining: true,
  parseHTML() {
    return [{ tag: "p[data-table-note]" }];
  },
  renderHTML() {
    return ["p", { "data-table-note": "true", class: "tbl-note" }, 0];
  },
});

export const ApaTable = Node.create({
  name: "apaTable",
  group: "block",
  content: "tableTitle table tableNote",
  isolating: true,
  parseHTML() {
    return [{ tag: "figure[data-apa-table]" }];
  },
  renderHTML() {
    return ["figure", { "data-apa-table": "true", class: "apa-table" }, 0];
  },
});

/** Table nodes from the official extension; column resizing is off (APA
 * tables use plain full-width columns). */
export const blockExtensions = [
  ApaTable,
  TableTitle,
  TableNote,
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
];

function emptyParagraph() {
  return { type: "paragraph" };
}

function cell(header: boolean) {
  return {
    type: header ? "tableHeader" : "tableCell",
    content: [emptyParagraph()],
  };
}

function row(header: boolean, cols: number) {
  return {
    type: "tableRow",
    content: Array.from({ length: cols }, () => cell(header)),
  };
}

/** Inserts a blank APA table: a header row plus `rows`-1 body rows. */
export function insertApaTable(editor: Editor, rows = 3, cols = 3): void {
  const tableRows = [
    row(true, cols),
    ...Array.from({ length: Math.max(1, rows - 1) }, () => row(false, cols)),
  ];
  editor
    .chain()
    .focus()
    .insertContent({
      type: "apaTable",
      content: [
        { type: "tableTitle" },
        { type: "table", content: tableRows },
        { type: "tableNote" },
      ],
    })
    .run();
}

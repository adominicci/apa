import { type Editor, Node } from "@tiptap/core";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import { imageObjectUrl } from "../persist/assets.ts";

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

/**
 * APA figures (APA 7.22–7.36). Same pattern as tables: "Figure N" + italic
 * title above the image and "Note." below come from CSS; the image itself is
 * an atom whose `src` is a relative asset path, loaded as a blob URL by a
 * NodeView. Structure: figure → figureTitle figureImage figureNote.
 */
export const FigureTitle = Node.create({
  name: "figureTitle",
  content: "inline*",
  defining: true,
  parseHTML() {
    return [{ tag: "p[data-figure-title]" }];
  },
  renderHTML() {
    return ["p", { "data-figure-title": "true", class: "fig-title" }, 0];
  },
});

export const FigureNote = Node.create({
  name: "figureNote",
  content: "inline*",
  defining: true,
  parseHTML() {
    return [{ tag: "p[data-figure-note]" }];
  },
  renderHTML() {
    return ["p", { "data-figure-note": "true", class: "fig-note" }, 0];
  },
});

export const FigureImage = Node.create({
  name: "figureImage",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      src: { default: "" },
      alt: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "img[data-figure-image]" }];
  },
  renderHTML({ node }) {
    return [
      "img",
      {
        "data-figure-image": "true",
        src: node.attrs["src"],
        alt: node.attrs["alt"],
      },
    ];
  },
  addNodeView() {
    return ({ node }) => {
      const img = document.createElement("img");
      img.className = "fig-img";
      img.alt = (node.attrs["alt"] as string) ?? "";
      let objectUrl: string | null = null;
      const src = node.attrs["src"] as string;
      if (src) {
        imageObjectUrl(src)
          .then((url) => {
            objectUrl = url;
            img.src = url;
          })
          .catch(() => {
            img.classList.add("fig-img--missing");
          });
      }
      return {
        dom: img,
        // The <img> is an atom leaf; ignore all internal mutations.
        ignoreMutation: () => true,
        destroy: () => {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        },
      };
    };
  },
});

export const ApaFigure = Node.create({
  name: "figure",
  group: "block",
  content: "figureTitle figureImage figureNote",
  isolating: true,
  parseHTML() {
    return [{ tag: "figure[data-apa-figure]" }];
  },
  renderHTML() {
    return ["figure", { "data-apa-figure": "true", class: "apa-figure" }, 0];
  },
});

/** Table + figure nodes; table column resizing is off (APA uses plain
 * full-width columns). */
export const blockExtensions = [
  ApaTable,
  TableTitle,
  TableNote,
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  ApaFigure,
  FigureTitle,
  FigureImage,
  FigureNote,
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

/** Inserts an APA figure referencing an already-imported asset path. */
export function insertFigure(editor: Editor, src: string): void {
  editor
    .chain()
    .focus()
    .insertContent({
      type: "figure",
      content: [
        { type: "figureTitle" },
        { type: "figureImage", attrs: { src } },
        { type: "figureNote" },
      ],
    })
    .run();
}

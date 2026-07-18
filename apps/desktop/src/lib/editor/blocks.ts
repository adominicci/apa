import { type Editor, Node } from "@tiptap/core";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import { imageObjectUrl } from "../persist/assets.ts";
import { m } from "../paraglide/messages.js";
import { deleteApaTableAt } from "./tableCommands.ts";

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
  addNodeView() {
    return ({ editor, getPos }) => {
      const dom = document.createElement("figure");
      dom.className = "apa-table";
      dom.setAttribute("data-apa-table", "true");

      const contentDOM = document.createElement("div");
      contentDOM.className = "apa-table-content";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "apa-table-edit";
      editBtn.contentEditable = "false";
      editBtn.title = m.table_edit_structure();
      editBtn.setAttribute("aria-label", m.table_edit_structure());
      editBtn.innerHTML =
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`;

      const menu = document.createElement("div");
      menu.className = "apa-table-menu";
      menu.contentEditable = "false";
      menu.style.display = "none";

      /** Closes when the user interacts anywhere outside the pencil/menu —
       * deselectNode alone misses plain clicks into text. */
      const onOutsideDown = (e: MouseEvent) => {
        const target = e.target as globalThis.Node | null;
        if (target && (menu.contains(target) || editBtn.contains(target))) {
          return;
        }
        closeMenu();
      };

      const closeMenu = () => {
        menu.style.display = "none";
        document.removeEventListener("mousedown", onOutsideDown, true);
      };

      const openMenu = () => {
        menu.style.display = "flex";
        document.addEventListener("mousedown", onOutsideDown, true);
      };

      /** Puts the cursor in a cell of THIS table so the command targets it. */
      const focusThisTable = (): boolean => {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (typeof pos !== "number") return false;
        const node = editor.state.doc.nodeAt(pos);
        if (!node) return false;
        const from = editor.state.selection.from;
        if (
          from > pos && from < pos + node.nodeSize && editor.isActive("table")
        ) {
          return true;
        }
        let cellInner: number | null = null;
        node.descendants((child, offset) => {
          if (cellInner !== null) return false;
          if (
            child.type.name === "tableCell" || child.type.name === "tableHeader"
          ) {
            cellInner = pos + 1 + offset + 1;
            return false;
          }
          return true;
        });
        if (cellInner === null) return false;
        editor.chain().focus().setTextSelection(cellInner).run();
        return true;
      };

      const runCmd = (cmd: string) => {
        const chain = editor.chain().focus();
        switch (cmd) {
          case "addRowAfter":
            chain.addRowAfter().run();
            break;
          case "addColumnAfter":
            chain.addColumnAfter().run();
            break;
          case "deleteRow":
            chain.deleteRow().run();
            break;
          case "deleteColumn":
            chain.deleteColumn().run();
            break;
        }
      };

      const deleteWholeTable = () => {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (typeof pos !== "number") return;
        deleteApaTableAt(editor, pos);
      };

      const ops: { cmd: string; label: string; danger?: boolean }[] = [
        { cmd: "addRowAfter", label: m.table_add_row() },
        { cmd: "addColumnAfter", label: m.table_add_col() },
        { cmd: "deleteRow", label: m.table_del_row() },
        { cmd: "deleteColumn", label: m.table_del_col() },
        { cmd: "deleteTable", label: m.table_delete(), danger: true },
      ];

      for (const op of ops) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "apa-table-menu-item";
        if (op.danger) item.classList.add("danger");
        item.textContent = op.label;
        // preventDefault on mousedown keeps the editor selection; the action
        // runs on click so keyboard activation (Enter/Space) works too.
        item.addEventListener("mousedown", (e) => e.preventDefault());
        item.addEventListener("click", () => {
          closeMenu();
          if (op.cmd === "deleteTable") deleteWholeTable();
          else if (focusThisTable()) runCmd(op.cmd);
        });
        menu.append(item);
      }

      editBtn.addEventListener("mousedown", (e) => e.preventDefault());
      editBtn.addEventListener("click", () => {
        if (menu.style.display === "none") openMenu();
        else closeMenu();
      });

      dom.append(editBtn, menu, contentDOM);

      return {
        dom,
        contentDOM,
        ignoreMutation: (mutation) =>
          mutation.type !== "selection" &&
          !contentDOM.contains(mutation.target),
        deselectNode: closeMenu,
        destroy: closeMenu,
      };
    };
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

/**
 * Inserts a blank APA table. `rows` counts every row (header included when
 * `header` is set); `cols` is the column count. With a header the first row
 * uses header cells and the rest are body rows.
 */
export function insertApaTable(
  editor: Editor,
  rows = 3,
  cols = 3,
  header = true,
): void {
  const cols_ = Math.max(1, cols);
  const rows_ = Math.max(header ? 2 : 1, rows);
  const bodyRows = header ? rows_ - 1 : rows_;
  const tableRows = [
    ...(header ? [row(true, cols_)] : []),
    ...Array.from({ length: bodyRows }, () => row(false, cols_)),
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

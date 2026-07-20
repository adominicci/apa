import { type Editor, Node } from "@tiptap/core";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import { imageObjectUrl } from "../persist/assets.ts";
import { m } from "../paraglide/messages.js";
import { watchDismiss } from "../dom/dismiss.ts";
import { latexToMathml } from "./mathml.ts";
import { deleteApaTableAt } from "./tableCommands.ts";
import { deleteApaFigureAt } from "./figureCommands.ts";

/**
 * Wires a pencil button and its menu into an open/close pair that dismisses on
 * Escape and on a press outside either element. The table and figure node
 * views are the two callers; before this they each carried their own copy of
 * the same open/close/outside-press triple, and neither handled Escape.
 *
 * `inside` lists the button *and* the menu rather than their common ancestor:
 * that ancestor is the whole table or figure, and pressing into a table cell
 * has to dismiss the menu, not preserve it.
 */
function createMenuToggle(menu: HTMLElement, trigger: HTMLElement) {
  let stopWatching: (() => void) | null = null;

  const close = () => {
    menu.style.display = "none";
    stopWatching?.();
    stopWatching = null;
  };

  const open = () => {
    menu.style.display = "flex";
    stopWatching = watchDismiss({
      inside: [menu, trigger],
      onDismiss: close,
      focusOnEscape: trigger,
    });
  };

  return { open, close };
}

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

      /** Escape and outside-press dismissal; deselectNode alone misses plain
       * clicks into text. */
      const { open: openMenu, close: closeMenu } = createMenuToggle(
        menu,
        editBtn,
      );

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
  // Not directly selectable: deleting the required image node would leave the
  // figure with an empty <img> placeholder (the schema forces one to exist).
  // The image is removed only by deleting the whole figure via the pencil menu.
  selectable: false,
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
  // Per-figure pencil, mirroring the table pencil: the only edit for a figure
  // is removing it whole (title + image + note), since the image can't be
  // deleted on its own without leaving an empty placeholder.
  addNodeView() {
    return ({ editor, getPos }) => {
      const dom = document.createElement("figure");
      dom.className = "apa-figure";
      dom.setAttribute("data-apa-figure", "true");

      const contentDOM = document.createElement("div");
      contentDOM.className = "apa-figure-content";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "apa-figure-edit";
      editBtn.contentEditable = "false";
      editBtn.title = m.figure_edit();
      editBtn.setAttribute("aria-label", m.figure_edit());
      editBtn.innerHTML =
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`;

      const menu = document.createElement("div");
      menu.className = "apa-figure-menu";
      menu.contentEditable = "false";
      menu.style.display = "none";

      /** Escape and outside-press dismissal. */
      const { open: openMenu, close: closeMenu } = createMenuToggle(
        menu,
        editBtn,
      );

      /** Deletes this whole figure by its node range (isolating wrapper). */
      const deleteWholeFigure = () => {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (typeof pos !== "number") return;
        deleteApaFigureAt(editor, pos);
      };

      const delItem = document.createElement("button");
      delItem.type = "button";
      delItem.className = "apa-figure-menu-item danger";
      delItem.textContent = m.figure_delete();
      // preventDefault on mousedown keeps the editor selection; the action
      // runs on click so keyboard activation (Enter/Space) works too.
      delItem.addEventListener("mousedown", (e) => e.preventDefault());
      delItem.addEventListener("click", () => {
        closeMenu();
        deleteWholeFigure();
      });
      menu.append(delItem);

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
 * APA block equations. Simpler than `figure`: a single `latex` attribute,
 * no editable inline content — the LaTeX is edited through the pencil menu
 * and what's shown is the MathML Temml renders from it. Its number ("(1)",
 * same in both document languages, unlike "Table N"/"Tabla N") is drawn by
 * CSS from a counter and never stored, per AGENTS.md.
 */
export const ApaEquation = Node.create({
  name: "apaEquation",
  group: "block",
  atom: true,
  draggable: false,
  addAttributes() {
    return { latex: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-apa-equation]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      { ...HTMLAttributes, "data-apa-equation": "true", class: "apa-equation" },
    ];
  },
  // NodeView: renders the MathML via latexToMathml and adds the pencil,
  // reusing createMenuToggle (Escape + outside-press already handled). No
  // contentDOM — the node is an atom leaf, so ProseMirror never edits its
  // DOM directly; ignoreMutation stays true throughout, mirroring FigureImage.
  addNodeView() {
    return ({ editor, node, getPos }) => {
      const dom = document.createElement("div");
      dom.className = "apa-equation";
      dom.setAttribute("data-apa-equation", "true");

      const mathHost = document.createElement("div");
      mathHost.className = "apa-equation-math";
      mathHost.contentEditable = "false";
      /*
       * `latexToMathml` (renderToString) e innerHTML, y NO `temml.render()`:
       * es exactamente el camino que el spike validó dentro de WKWebView.
       * `render()` escribe en el DOM vivo y quedó sin probar ahí — de hecho
       * revienta bajo jsdom, que no implementa el DOM de MathML. Usar el
       * camino demostrado evita apostar a una diferencia entre motores, y de
       * paso deja a `mathml.ts` como único punto de contacto con Temml.
       */
      /*
       * Envuelto en try/catch porque `latexToMathml` usa `throwOnError: true`
       * y esto corre dentro de `addNodeView`, que ProseMirror NO protege: un
       * LaTeX malformado (un `\frac{` sin cerrar, por ejemplo) tumbaría el
       * montaje del editor entero en vez de romper solo su ecuación. Un
       * documento con una ecuación mal escrita tiene que seguir abriéndose.
       *
       * El fallback muestra el LaTeX crudo, igual que hace la exportación
       * cuando no puede mapear: mismo comportamiento en los dos lados.
       */
      const latex = (node.attrs["latex"] as string) ?? "";
      try {
        mathHost.innerHTML = latexToMathml(latex);
      } catch {
        mathHost.classList.add("apa-equation-invalid");
        mathHost.textContent = latex;
      }

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "apa-equation-edit";
      editBtn.contentEditable = "false";
      editBtn.title = m.equation_edit();
      editBtn.setAttribute("aria-label", m.equation_edit());
      editBtn.innerHTML =
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`;

      const menu = document.createElement("div");
      menu.className = "apa-equation-menu";
      menu.contentEditable = "false";
      menu.style.display = "none";

      /** Escape and outside-press dismissal. */
      const { open: openMenu, close: closeMenu } = createMenuToggle(
        menu,
        editBtn,
      );

      /** Deletes this whole equation by its node range (atom leaf). */
      const deleteWholeEquation = () => {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (typeof pos !== "number") return;
        const current = editor.state.doc.nodeAt(pos);
        if (!current || current.type.name !== "apaEquation") return;
        editor
          .chain()
          .focus()
          .deleteRange({ from: pos, to: pos + current.nodeSize })
          .run();
      };

      const delItem = document.createElement("button");
      delItem.type = "button";
      delItem.className = "apa-equation-menu-item danger";
      delItem.textContent = m.equation_delete();
      // preventDefault on mousedown keeps the editor selection; the action
      // runs on click so keyboard activation (Enter/Space) works too.
      delItem.addEventListener("mousedown", (e) => e.preventDefault());
      delItem.addEventListener("click", () => {
        closeMenu();
        deleteWholeEquation();
      });
      menu.append(delItem);

      editBtn.addEventListener("mousedown", (e) => e.preventDefault());
      editBtn.addEventListener("click", () => {
        if (menu.style.display === "none") openMenu();
        else closeMenu();
      });

      dom.append(mathHost, editBtn, menu);

      return {
        dom,
        ignoreMutation: () => true,
        deselectNode: closeMenu,
        destroy: closeMenu,
      };
    };
  },
});

/** Table + figure + equation nodes; table column resizing is off (APA uses
 * plain full-width columns). */
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
  ApaEquation,
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

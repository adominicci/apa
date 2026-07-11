import { type Editor, Node } from "@tiptap/core";

/**
 * Tesina's document shape (plan §editor): one ProseMirror doc per essay,
 * `sectionAbstract? sectionBody sectionAppendix*`. The title page and the
 * reference list are NOT document content — the former is form data, the
 * latter a pure function of citations. Section headers ("Resumen",
 * "Apéndice A") are editor chrome drawn by CSS from the document language,
 * so switching language retranslates them instantly without touching the doc.
 */
export const TesinaDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "sectionAbstract? sectionBody sectionAppendix*",
});

export const SectionBody = Node.create({
  name: "sectionBody",
  content: "block+",
  isolating: true,
  defining: true,
  parseHTML() {
    return [{ tag: "section[data-sec='body']" }];
  },
  renderHTML() {
    return ["section", { "data-sec": "body", class: "sec sec-body" }, 0];
  },
});

export const SectionAbstract = Node.create({
  name: "sectionAbstract",
  content: "paragraph+ keywordsLine?",
  isolating: true,
  defining: true,
  parseHTML() {
    return [{ tag: "section[data-sec='abstract']" }];
  },
  renderHTML() {
    return [
      "section",
      { "data-sec": "abstract", class: "sec sec-abstract" },
      0,
    ];
  },
});

export const SectionAppendix = Node.create({
  name: "sectionAppendix",
  content: "block+",
  isolating: true,
  defining: true,
  parseHTML() {
    return [{ tag: "section[data-sec='appendix']" }];
  },
  renderHTML() {
    return [
      "section",
      { "data-sec": "appendix", class: "sec sec-appendix" },
      0,
    ];
  },
});

/** "Keywords:" / "Palabras clave:" line at the end of the abstract. */
export const KeywordsLine = Node.create({
  name: "keywordsLine",
  content: "inline*",
  marks: "italic",
  parseHTML() {
    return [{ tag: "p[data-keywords]" }];
  },
  renderHTML() {
    return ["p", { "data-keywords": "true", class: "keywords-line" }, 0];
  },
});

export const sectionExtensions = [
  TesinaDocument,
  SectionAbstract,
  SectionBody,
  SectionAppendix,
  KeywordsLine,
];

export function hasAbstract(editor: Editor): boolean {
  return editor.state.doc.firstChild?.type.name === "sectionAbstract";
}

export function addAbstract(editor: Editor): void {
  if (hasAbstract(editor)) return;
  editor
    .chain()
    .insertContentAt(0, {
      type: "sectionAbstract",
      content: [{ type: "paragraph" }],
    })
    .focus("start")
    .run();
}

export function removeAbstract(editor: Editor): void {
  const first = editor.state.doc.firstChild;
  if (first?.type.name !== "sectionAbstract") return;
  editor.chain().deleteRange({ from: 0, to: first.nodeSize }).run();
}

export function addAppendix(editor: Editor): void {
  const end = editor.state.doc.content.size;
  editor
    .chain()
    .insertContentAt(end, {
      type: "sectionAppendix",
      content: [{ type: "paragraph" }],
    })
    .focus(end + 2)
    .run();
}

/** True when the selection sits inside an appendix section. */
export function selectionInAppendix(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === "sectionAppendix") return true;
  }
  return false;
}

/** Deletes the appendix section containing the selection, if any. */
export function removeAppendixAtSelection(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "sectionAppendix") {
      const start = $from.before(depth);
      editor
        .chain()
        .deleteRange({ from: start, to: start + node.nodeSize })
        .focus()
        .run();
      return true;
    }
  }
  return false;
}

/** Appends the keywords line to the abstract if one is not already there. */
export function addKeywordsLine(editor: Editor): void {
  const abstract = editor.state.doc.firstChild;
  if (!abstract || abstract.type.name !== "sectionAbstract") return;
  if (abstract.lastChild?.type.name === "keywordsLine") return;
  const insertAt = abstract.nodeSize - 1;
  editor
    .chain()
    .insertContentAt(insertAt, { type: "keywordsLine" })
    .focus(insertAt + 1)
    .run();
}

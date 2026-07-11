import { type Content, Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { Node as PMNode } from "@tiptap/pm/model";
import { sectionExtensions } from "./sections.ts";
import { type CitationEnv, createCitationExtension } from "./citation.ts";
import { defaultDoc, ensureSectionedDoc } from "./migrate.ts";

export interface CreateEditorArgs {
  element: HTMLElement;
  /** ProseMirror doc JSON from a saved essay; empty sectioned doc when absent. */
  content?: unknown;
  /** Live library + document language; mutated by the app, see citation.ts. */
  citationEnv: CitationEnv;
  onUpdate?: (docJson: unknown, words: number) => void;
}

export function countWords(doc: PMNode): number {
  const text = doc.textBetween(0, doc.content.size, " ", " ").trim();
  return text === "" ? 0 : text.split(/\s+/).length;
}

/**
 * The M2 editor: APA-relevant marks and blocks only, on top of Tesina's
 * sectioned document (`sectionAbstract? sectionBody sectionAppendix*`).
 * Elements APA papers never contain (code, horizontal rules, strikethrough)
 * are disabled at the schema level so they cannot arrive via paste either.
 * Citations, figures, and footnotes land in later M2 iterations.
 */
export function createTesinaEditor(
  { element, content, citationEnv, onUpdate }: CreateEditorArgs,
): Editor {
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({
        document: false,
        heading: { levels: [1, 2, 3, 4, 5] },
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
      }),
      ...sectionExtensions,
      createCitationExtension(citationEnv),
    ],
    content: (content !== undefined
      ? ensureSectionedDoc(content)
      : defaultDoc()) as Content,
    autofocus: "end",
    onUpdate({ editor }) {
      onUpdate?.(editor.getJSON(), countWords(editor.state.doc));
    },
  });
}

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { Node as PMNode } from "@tiptap/pm/model";

export interface CreateEditorArgs {
  element: HTMLElement;
  /** ProseMirror doc JSON from a saved essay; empty paragraph when absent. */
  content?: unknown;
  onUpdate?: (docJson: unknown, words: number) => void;
}

export function countWords(doc: PMNode): number {
  const text = doc.textBetween(0, doc.content.size, " ", " ").trim();
  return text === "" ? 0 : text.split(/\s+/).length;
}

/**
 * The M2 baseline editor: APA-relevant marks and blocks only. Elements APA
 * papers never contain (code, horizontal rules, strikethrough) are disabled
 * at the schema level so they cannot arrive via paste either. Custom section
 * nodes, citations, figures, and footnotes land in later M2 iterations.
 */
export function createTesinaEditor(
  { element, content, onUpdate }: CreateEditorArgs,
): Editor {
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5] },
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
      }),
    ],
    content: content ?? { type: "doc", content: [{ type: "paragraph" }] },
    autofocus: "end",
    onUpdate({ editor }) {
      onUpdate?.(editor.getJSON(), countWords(editor.state.doc));
    },
  });
}

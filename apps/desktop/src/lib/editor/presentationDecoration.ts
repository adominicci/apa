import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * True when the last meaningful authored inline text already ends in a
 * period. This mirrors the preview/DOCX run-in normalizer: trailing whitespace
 * and hard breaks do not cause a second period, while an inline atom such as a
 * citation remains the meaningful ending and therefore still needs one.
 */
function hasTerminalPeriod(node: PMNode): boolean {
  for (let index = node.childCount - 1; index >= 0; index -= 1) {
    const child = node.child(index);
    if (child.type.name === "hardBreak") continue;
    if (!child.isText || typeof child.text !== "string") return false;
    if (child.text.trim() === "") continue;
    return /\.\s*$/.test(child.text);
  }
  return false;
}

/**
 * Derived live-editor presentation only. Appendix letters and run-in heading
 * punctuation are recalculated from the current ProseMirror tree on every
 * render, so neither becomes persisted document data.
 */
export const ApaPresentationDecoration = Extension.create({
  name: "apaPresentationDecoration",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            const appendices: { position: number; node: PMNode }[] = [];

            state.doc.forEach((node, position) => {
              if (node.type.name === "sectionAppendix") {
                appendices.push({ position, node });
              }
            });
            if (appendices.length > 1) {
              appendices.forEach(({ position, node }, index) => {
                decorations.push(
                  Decoration.node(position, position + node.nodeSize, {
                    "data-appendix-letter": String.fromCharCode(65 + index),
                  }),
                );
              });
            }

            state.doc.descendants((node, position, parent, index) => {
              const level = Number(node.attrs["level"] ?? 0);
              if (
                node.type.name !== "heading" || level < 4 ||
                !parent || typeof index !== "number" ||
                index + 1 >= parent.childCount ||
                parent.child(index + 1)?.type.name !== "paragraph"
              ) {
                return;
              }
              decorations.push(
                Decoration.node(position, position + node.nodeSize, {
                  "data-apa-run-in": "true",
                  "data-run-in-punctuation": hasTerminalPeriod(node)
                    ? "preserve"
                    : "append",
                }),
              );
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

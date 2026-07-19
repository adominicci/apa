import type { Editor } from "@tiptap/core";

/**
 * Whole-figure deletion for APA figures. The `figure` wrapper is `isolating`
 * with a required `figureTitle figureImage figureNote` content model, so the
 * image can't be deleted on its own — ProseMirror would refill an empty
 * `figureImage` and leave a placeholder box. Removal is therefore always the
 * whole figure, deleted by its node range (mirrors `deleteApaTableAt`).
 */
export function deleteApaFigureAt(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "figure") return false;
  return editor
    .chain()
    .focus()
    .deleteRange({ from: pos, to: pos + node.nodeSize })
    .run();
}

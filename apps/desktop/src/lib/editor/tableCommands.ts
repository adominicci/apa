import type { Editor } from "@tiptap/core";
import type { ResolvedPos } from "@tiptap/pm/model";

/**
 * Whole-table deletion for APA tables. TipTap's own `deleteTable()` removes
 * only the inner `table` node, which is illegal inside the `apaTable` wrapper
 * (`tableTitle table tableNote`) — ProseMirror refills an empty grid instead
 * of deleting anything. Every "delete table" entry point (node-view menu,
 * bottom-bar table menu) must route through these helpers so the caption,
 * grid, and note disappear together.
 */

/** Full range of the `apaTable` ancestor containing `$pos`, or null. */
export function apaTableRange(
  $pos: ResolvedPos,
): { from: number; to: number } | null {
  // A NodeSelection of the apaTable itself resolves *before* the node, so
  // the ancestor walk below would miss it.
  if ($pos.nodeAfter?.type.name === "apaTable") {
    return { from: $pos.pos, to: $pos.pos + $pos.nodeAfter.nodeSize };
  }
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "apaTable") {
      const from = $pos.before(depth);
      return { from, to: from + node.nodeSize };
    }
  }
  return null;
}

/** Deletes the whole `apaTable` starting exactly at `pos` (node-view path). */
export function deleteApaTableAt(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "apaTable") return false;
  return editor
    .chain()
    .focus()
    .deleteRange({ from: pos, to: pos + node.nodeSize })
    .run();
}

/** Deletes the whole `apaTable` around the current selection (menu path). */
export function deleteWholeApaTable(editor: Editor): boolean {
  const range = apaTableRange(editor.state.selection.$from);
  if (!range) return false;
  return editor.chain().focus().deleteRange(range).run();
}

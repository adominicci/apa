/**
 * Editor side of the live APA check: runs the pure engine checker on every
 * doc change, tints flagged blocks via node decorations, and reports the
 * positioned issue list to the app layer (toolbar pill + export advice).
 * Advisory chrome only — it never edits or blocks the document by itself.
 */
import { type Editor, Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { type ApaCheckIssue, checkApaDocument } from "@tesina/engine";

export interface PositionedApaIssue extends ApaCheckIssue {
  from: number;
  to: number;
}

/** Maps an engine child-index path to absolute doc positions. */
function posAtPath(doc: PMNode, path: number[]): { from: number; to: number } {
  let node = doc;
  let contentStart = 0;
  let from = 0;
  for (const index of path) {
    let pos = contentStart;
    for (let i = 0; i < index; i++) pos += node.child(i).nodeSize;
    from = pos;
    node = node.child(index);
    contentStart = from + 1;
  }
  return { from, to: from + node.nodeSize };
}

function compute(
  doc: PMNode,
): { decos: DecorationSet; issues: PositionedApaIssue[] } {
  const issues = checkApaDocument(doc.toJSON()).map((issue) => ({
    ...issue,
    ...posAtPath(doc, issue.path),
  }));
  const decos = DecorationSet.create(
    doc,
    issues.map((i) =>
      Decoration.node(i.from, i.to, { class: "apa-check-flag" })
    ),
  );
  return { decos, issues };
}

const key = new PluginKey<DecorationSet>("apaCheck");

export function createApaCheckExtension(
  onIssues: (issues: PositionedApaIssue[]) => void,
): Extension {
  return Extension.create({
    name: "apaCheck",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key,
          state: {
            init: (_config, state) => {
              const { decos, issues } = compute(state.doc);
              // Deferred: the callback reaches into app state, and dispatch
              // is still in flight when init/apply run.
              queueMicrotask(() => onIssues(issues));
              return decos;
            },
            apply: (tr, value) => {
              if (!tr.docChanged) return value.map(tr.mapping, tr.doc);
              const { decos, issues } = compute(tr.doc);
              queueMicrotask(() => onIssues(issues));
              return decos;
            },
          },
          props: {
            decorations: (state) => key.getState(state),
          },
        }),
      ];
    },
  });
}

/**
 * Deletes the flagged ranges in one undoable step, back to front so earlier
 * positions stay valid. Used by the pill's per-issue and fix-all buttons.
 */
export function deleteIssueRanges(
  editor: Editor,
  issues: readonly PositionedApaIssue[],
): void {
  if (issues.length === 0) return;
  let chain = editor.chain().focus();
  for (const issue of [...issues].sort((a, b) => b.from - a.from)) {
    chain = chain.deleteRange({ from: issue.from, to: issue.to });
  }
  chain.run();
}

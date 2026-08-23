import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { ExperienceSpellingIssue } from "./controller.ts";
import { spellingIssueIdentity } from "./controller.ts";

const spellingEditorPluginKey = new PluginKey("tesinaSpellingExperience");

interface SpellingEditorEnvironment {
  getIssues: () => readonly ExperienceSpellingIssue[];
  onBodyMutation: () => void;
  onAltF7: () => void;
  onIssueContextMenu: (
    issue: ExperienceSpellingIssue,
    event: MouseEvent,
  ) => boolean;
}

export function issueAtBodyPosition(
  issues: readonly ExperienceSpellingIssue[],
  position: number,
): ExperienceSpellingIssue | undefined {
  return issues.find((issue) =>
    issue.source === "body" && position >= issue.from && position < issue.to
  );
}

function bodyDecorations(editor: Editor, env: SpellingEditorEnvironment) {
  const decorations = env.getIssues().filter((issue) => issue.source === "body")
    .map((issue) =>
      Decoration.inline(issue.from, issue.to, {
        class: "tesina-spelling-issue",
        "data-spelling-indicator": "misspelled",
        "data-spelling-issue": spellingIssueIdentity(issue),
      })
    );
  return DecorationSet.create(editor.state.doc, decorations);
}

export function attachSpellingEditorAdapter(
  editor: Editor,
  env: SpellingEditorEnvironment,
): () => void {
  const plugin = new Plugin({
    key: spellingEditorPluginKey,
    state: {
      init: () => bodyDecorations(editor, env),
      apply(transaction, previous) {
        if (
          transaction.docChanged || transaction.getMeta(spellingEditorPluginKey)
        ) {
          return bodyDecorations(editor, env);
        }
        return previous;
      },
    },
    props: {
      decorations(state) {
        return spellingEditorPluginKey.getState(state) as DecorationSet;
      },
      handleKeyDown(_view, event) {
        if (event.altKey && event.key === "F7") {
          event.preventDefault();
          env.onAltF7();
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        contextmenu(view, event) {
          const point = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          if (!point) return false;
          const issue = issueAtBodyPosition(env.getIssues(), point.pos);
          return issue ? env.onIssueContextMenu(issue, event) : false;
        },
      },
    },
  });
  const onUpdate = () => env.onBodyMutation();
  editor.registerPlugin(plugin);
  editor.on("update", onUpdate);
  return () => {
    editor.off("update", onUpdate);
    if (!editor.isDestroyed) editor.unregisterPlugin(spellingEditorPluginKey);
  };
}

export function refreshSpellingDecorations(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setMeta(spellingEditorPluginKey, true));
}

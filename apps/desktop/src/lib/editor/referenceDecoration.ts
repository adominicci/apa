import { type Editor, Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  buildReferenceList,
  type DocLocale,
  getTerms,
  type Reference,
  type RichRun,
} from "@tesina/engine";

export interface ReferenceDecorationEnv {
  references: Reference[];
  locale: DocLocale;
  emptyLabel: string;
}

const EXTERNAL_REFERENCE_META = "apa:references-external";
interface ReferenceDecorationState {
  version: number;
}

const referenceDecorationKey = new PluginKey<ReferenceDecorationState>(
  "tesinaReferencePage",
);

function insertionPosition(doc: PMNode): number {
  let position = 0;
  for (let index = 0; index < doc.childCount; index += 1) {
    const child = doc.child(index);
    if (child.type.name === "sectionAppendix") return position;
    position += child.nodeSize;
  }
  return doc.content.size;
}

function appendRuns(target: HTMLElement, runs: readonly RichRun[]): void {
  for (const run of runs) {
    if (run.italic) {
      const emphasis = document.createElement("em");
      emphasis.textContent = run.text;
      target.append(emphasis);
    } else {
      target.append(document.createTextNode(run.text));
    }
  }
}

function renderReferencePage(
  page: HTMLElement,
  env: ReferenceDecorationEnv,
): void {
  const { entries } = buildReferenceList(env.references, env.locale);
  const headingText = getTerms(env.locale).headings.references;
  const heading = document.createElement("h1");
  heading.className = "ref-head";
  heading.textContent = headingText;

  page.replaceChildren(heading);
  page.setAttribute("aria-label", headingText);
  for (const entry of entries) {
    const paragraph = document.createElement("p");
    paragraph.className = "ref-entry";
    appendRuns(paragraph, entry.runs);
    page.append(paragraph);
  }
}

function createReferencePage(env: ReferenceDecorationEnv): HTMLElement {
  const page = document.createElement("section");
  page.className = "sec sec-references";
  page.dataset["referenceSheet"] = "references";
  page.contentEditable = "false";
  page.setAttribute("role", "region");
  renderReferencePage(page, env);
  return page;
}

/**
 * A derived, non-document references page positioned before the first
 * appendix. A ProseMirror widget keeps the page inside the one EditorView
 * without adding a schema node or moving editor-owned DOM.
 */
export function createReferenceDecorationExtension(
  env: ReferenceDecorationEnv,
) {
  return Extension.create({
    name: "referencePageDecoration",

    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: referenceDecorationKey,
          state: {
            init: () => ({ version: 0 }),
            apply: (transaction, previous) =>
              transaction.getMeta(EXTERNAL_REFERENCE_META)
                ? { version: previous.version + 1 }
                : previous,
          },
          props: {
            decorations(state) {
              const { entries } = buildReferenceList(
                env.references,
                env.locale,
              );
              if (entries.length === 0) return DecorationSet.empty;
              return DecorationSet.create(state.doc, [
                Decoration.widget(
                  insertionPosition(state.doc),
                  () => createReferencePage(env),
                  {
                    side: -1,
                    key: "tesina-reference-page",
                    stopEvent: () => true,
                    ignoreSelection: true,
                  },
                ),
              ]);
            },
          },
          view: (initialView) => {
            let renderedVersion = referenceDecorationKey.getState(
              initialView.state,
            )?.version ?? 0;
            return {
              update(view) {
                const version = referenceDecorationKey.getState(view.state)
                  ?.version ?? 0;
                if (version === renderedVersion) return;
                renderedVersion = version;
                const page = view.dom.querySelector<HTMLElement>(
                  "[data-reference-sheet='references']",
                );
                if (page) renderReferencePage(page, env);
              },
            };
          },
        }),
      ];
    },
  });
}

/** Refresh the derived page after library, locale, or inclusion changes. */
export function refreshReferenceDecoration(editor: Editor): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(EXTERNAL_REFERENCE_META, true),
  );
}

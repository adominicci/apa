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
import {
  planReferencePages,
  type ReferencePagePlan,
} from "./pagination/referencePages.ts";
import {
  canonicalLayoutLength,
  canonicalLayoutScale,
} from "./pagination/measure.ts";
import { paginationPluginKey } from "./pagination/extension.ts";

export interface ReferenceDecorationEnv {
  references: Reference[];
  locale: DocLocale;
  emptyLabel: string;
  /** Selected document font identity; changing it starts a new measure epoch. */
  fontKey?: string;
  pageNumbers?: readonly number[];
  pagePlan?: ReferencePagePlan;
  measureElement?: (element: HTMLElement) => number;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  onPageCountChange?: (count: number) => void;
}

const EXTERNAL_REFERENCE_META = "apa:references-external";
interface ReferenceDecorationState {
  version: number;
  contentEpoch: number;
  measuredEpoch: number;
}

type ReferenceDecorationMeta =
  | { type: "refresh" }
  | { type: "measured"; epoch: number }
  | { type: "repaint" };

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

function hasAppendix(doc: PMNode): boolean {
  for (let index = 0; index < doc.childCount; index += 1) {
    if (doc.child(index).type.name === "sectionAppendix") return true;
  }
  return false;
}

function appendRuns(
  ownerDocument: Document,
  target: HTMLElement,
  runs: readonly RichRun[],
): void {
  for (const run of runs) {
    if (run.italic) {
      const emphasis = ownerDocument.createElement("em");
      emphasis.textContent = run.text;
      target.append(emphasis);
    } else {
      target.append(ownerDocument.createTextNode(run.text));
    }
  }
}

function defaultPagePlan(env: ReferenceDecorationEnv): ReferencePagePlan {
  const { entries } = buildReferenceList(env.references, env.locale);
  return {
    pages: [{
      index: 0,
      entryKeys: entries.map((entry) => entry.refId),
      overflowKeys: [],
    }],
    pageCount: 1,
  };
}

function verticalMargins(element: HTMLElement): number {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style) return 0;
  return [style.marginTop, style.marginBottom].reduce((total, value) => {
    const margin = Number.parseFloat(value);
    return total + (Number.isFinite(margin) ? margin : 0);
  }, 0);
}

export function createReferencePagesElement(
  env: ReferenceDecorationEnv,
  plan: ReferencePagePlan,
  pageNumbers: readonly number[],
  hasFollowingAppendix: boolean,
  ownerDocument: Document = document,
): HTMLElement {
  const { entries } = buildReferenceList(env.references, env.locale);
  const entriesById = new Map(entries.map((entry) => [entry.refId, entry]));
  const headingText = getTerms(env.locale).headings.references;
  const wrapper = ownerDocument.createElement("div");
  wrapper.className = "reference-page-stack";
  wrapper.dataset["referenceSheet"] = "references";
  wrapper.dataset["referencePages"] = String(plan.pageCount);
  wrapper.dataset["hasFollowingAppendix"] = String(hasFollowingAppendix);
  wrapper.contentEditable = "false";
  wrapper.setAttribute("role", "group");
  wrapper.setAttribute("aria-label", headingText);

  for (const pagePlan of plan.pages) {
    const page = ownerDocument.createElement("section");
    page.className = "sec sec-references";
    page.dataset["referenceSheet"] = "references";
    page.dataset["referencePageIndex"] = String(pagePlan.index);
    page.contentEditable = "false";
    page.setAttribute("role", "region");
    page.setAttribute("aria-label", headingText);

    const pageNumber = pageNumbers[pagePlan.index];
    if (pageNumber !== undefined) {
      const number = ownerDocument.createElement("span");
      number.className = "tesina-page-number";
      number.dataset["referencePageNumber"] = String(pageNumber);
      number.contentEditable = "false";
      number.setAttribute("aria-hidden", "true");
      number.tabIndex = -1;
      number.textContent = String(pageNumber);
      page.append(number);
    }

    if (pagePlan.index === 0) {
      const heading = ownerDocument.createElement("h1");
      heading.className = "ref-head";
      heading.textContent = headingText;
      page.append(heading);
    }

    for (const refId of pagePlan.entryKeys) {
      const entry = entriesById.get(refId);
      if (!entry) continue;
      const paragraph = ownerDocument.createElement("p");
      paragraph.className = "ref-entry";
      paragraph.dataset["referenceEntry"] = refId;
      if (pagePlan.overflowKeys.includes(refId)) {
        paragraph.dataset["referenceOverflow"] = "true";
      }
      appendRuns(ownerDocument, paragraph, entry.runs);
      page.append(paragraph);
    }

    if (entries.length === 0 && pagePlan.index === 0) {
      const empty = ownerDocument.createElement("p");
      empty.className = "ref-empty";
      empty.textContent = env.emptyLabel;
      page.append(empty);
    }
    wrapper.append(page);
  }

  return wrapper;
}

export function measureReferencePagesElement(
  root: HTMLElement,
  env: ReferenceDecorationEnv,
): ReferencePagePlan {
  const measure = env.measureElement ?? ((element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const scale = canonicalLayoutScale(rect.width, element.offsetWidth);
    return canonicalLayoutLength(rect.height, scale);
  });
  const heading = root.querySelector<HTMLElement>(".ref-head");
  const entries = [...root.querySelectorAll<HTMLElement>(
    "[data-reference-entry]",
  )].map((entry) => ({
    key: entry.dataset["referenceEntry"]!,
    height: measure(entry),
  }));
  return planReferencePages({
    headingHeight: heading ? measure(heading) + verticalMargins(heading) : 0,
    entries,
  });
}

function createReferencePage(
  env: ReferenceDecorationEnv,
  plan: ReferencePagePlan,
  followingAppendix: boolean,
  ownerDocument: Document,
): HTMLElement {
  return createReferencePagesElement(
    env,
    plan,
    env.pageNumbers ?? [],
    followingAppendix,
    ownerDocument,
  );
}

function applyReferenceMeta(
  previous: ReferenceDecorationState,
  meta: ReferenceDecorationMeta | true | undefined,
): ReferenceDecorationState {
  if (!meta) return previous;
  if (meta === true || meta.type === "refresh") {
    return {
      version: previous.version + 1,
      contentEpoch: previous.contentEpoch + 1,
      measuredEpoch: previous.measuredEpoch,
    };
  }
  if (meta.type === "measured") {
    if (meta.epoch !== previous.contentEpoch) return previous;
    return {
      ...previous,
      version: previous.version + 1,
      measuredEpoch: meta.epoch,
    };
  }
  return { ...previous, version: previous.version + 1 };
}

/**
 * A derived, non-document references page positioned before the first
 * appendix. A ProseMirror widget keeps the page inside the one EditorView
 * without adding a schema node or moving editor-owned DOM. The page is
 * always present — a brand-new essay shows title page, body, and an empty
 * references page — with a hint until the first citable entry exists.
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
            init: () => ({ version: 0, contentEpoch: 0, measuredEpoch: -1 }),
            apply: (transaction, previous) =>
              applyReferenceMeta(
                previous,
                transaction.getMeta(EXTERNAL_REFERENCE_META) as
                  | ReferenceDecorationMeta
                  | true
                  | undefined,
              ),
          },
          props: {
            decorations(state) {
              const pluginState = referenceDecorationKey.getState(state)!;
              const plan =
                pluginState.measuredEpoch === pluginState.contentEpoch
                  ? env.pagePlan ?? defaultPagePlan(env)
                  : defaultPagePlan(env);
              return DecorationSet.create(state.doc, [
                Decoration.widget(
                  insertionPosition(state.doc),
                  (view) =>
                    createReferencePage(
                      env,
                      plan,
                      hasAppendix(state.doc),
                      view.dom.ownerDocument,
                    ),
                  {
                    side: -2,
                    key: `tesina-reference-page:${pluginState.version}`,
                    stopEvent: () => true,
                    ignoreSelection: true,
                  },
                ),
              ]);
            },
          },
          view: (initialView) => {
            let frame: number | null = null;
            let destroyed = false;
            let scheduledEpoch = -1;
            const ownerWindow = initialView.dom.ownerDocument.defaultView;
            const requestFrame = env.requestFrame ??
              ownerWindow?.requestAnimationFrame.bind(ownerWindow);
            const cancelFrame = env.cancelFrame ??
              ownerWindow?.cancelAnimationFrame.bind(ownerWindow);
            if (!requestFrame || !cancelFrame) {
              throw new Error("Reference pagination requires a window");
            }

            const scheduleMeasurement = (
              view: typeof initialView,
              epoch: number,
            ) => {
              scheduledEpoch = epoch;
              const fontsReady = view.dom.ownerDocument.fonts?.ready ??
                Promise.resolve();
              void fontsReady.catch(() => undefined).then(() => {
                if (destroyed || scheduledEpoch !== epoch || frame !== null) {
                  return;
                }
                frame = requestFrame(() => {
                  frame = null;
                  if (destroyed || scheduledEpoch !== epoch) return;
                  const state = referenceDecorationKey.getState(view.state);
                  if (!state || state.contentEpoch !== epoch) return;
                  const root = view.dom.querySelector<HTMLElement>(
                    "[data-reference-pages]",
                  );
                  if (!root) return;
                  const plan = measureReferencePagesElement(root, env);
                  env.pagePlan = plan;
                  env.onPageCountChange?.(plan.pageCount);
                  view.dispatch(
                    view.state.tr
                      .setMeta(
                        EXTERNAL_REFERENCE_META,
                        {
                          type: "measured",
                          epoch,
                        } satisfies ReferenceDecorationMeta,
                      )
                      .setMeta(paginationPluginKey, {
                        type: "invalidate",
                        reason: "references",
                      })
                      .setMeta("addToHistory", false),
                  );
                });
              });
            };

            const initialState = referenceDecorationKey.getState(
              initialView.state,
            );
            if (initialState) {
              scheduleMeasurement(initialView, initialState.contentEpoch);
            }
            return {
              update(view, previousState) {
                const previous = referenceDecorationKey.getState(previousState);
                const current = referenceDecorationKey.getState(view.state);
                if (
                  current && current.contentEpoch !== previous?.contentEpoch
                ) {
                  if (frame !== null) {
                    cancelFrame(frame);
                    frame = null;
                  }
                  scheduleMeasurement(view, current.contentEpoch);
                }
              },
              destroy() {
                destroyed = true;
                scheduledEpoch += 1;
                if (frame !== null) cancelFrame(frame);
                frame = null;
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
    editor.state.tr
      .setMeta(
        EXTERNAL_REFERENCE_META,
        {
          type: "refresh",
        } satisfies ReferenceDecorationMeta,
      )
      .setMeta("addToHistory", false),
  );
}

/** Repaint derived numbering without starting a new measurement epoch. */
export function repaintReferenceDecoration(editor: Editor): void {
  editor.view.dispatch(
    editor.state.tr
      .setMeta(
        EXTERNAL_REFERENCE_META,
        {
          type: "repaint",
        } satisfies ReferenceDecorationMeta,
      )
      .setMeta("addToHistory", false),
  );
}

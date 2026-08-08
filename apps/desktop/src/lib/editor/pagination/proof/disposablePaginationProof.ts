import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type DisposableProofGap =
  | { kind: "line" | "block"; pos: number; height: number }
  | {
    kind: "tableRow";
    pos: number;
    height: number;
    columns: number;
  };

export interface DisposablePaginationProofPlan {
  epoch: number;
  gaps: DisposableProofGap[];
}

const EMPTY_PLAN: DisposablePaginationProofPlan = { epoch: 0, gaps: [] };
export const disposablePaginationProofKey = new PluginKey<
  DisposablePaginationProofPlan
>("tesinaDisposablePaginationProof");

function setProofAttributes(
  element: HTMLElement,
  kind: DisposableProofGap["kind"],
) {
  element.dataset["paginationProofGap"] = kind;
  element.contentEditable = "false";
  element.setAttribute("aria-hidden", "true");
  element.style.pointerEvents = "none";
  element.style.userSelect = "none";
}

function createGapElement(gap: DisposableProofGap): HTMLElement {
  if (gap.kind === "tableRow") {
    const row = document.createElement("tr");
    setProofAttributes(row, gap.kind);
    const cell = document.createElement("td");
    cell.colSpan = gap.columns;
    cell.style.height = `${gap.height}px`;
    cell.style.padding = "0";
    cell.style.border = "0";
    row.append(cell);
    return row;
  }

  const spacer = document.createElement("span");
  setProofAttributes(spacer, gap.kind);
  spacer.style.display = gap.kind === "line" ? "inline-block" : "block";
  if (gap.kind === "line") spacer.style.verticalAlign = "top";
  spacer.style.height = `${gap.height}px`;
  spacer.style.margin = "0";
  spacer.style.padding = "0";
  spacer.style.border = "0";
  return spacer;
}

function decorationsFor(
  doc: Parameters<typeof DecorationSet.create>[0],
  plan: DisposablePaginationProofPlan,
): DecorationSet {
  const decorations = plan.gaps.map((gap) =>
    Decoration.widget(gap.pos, () => createGapElement(gap), {
      side: -1,
      key: `proof-${plan.epoch}-${gap.kind}-${gap.pos}`,
      stopEvent: () => true,
      ignoreSelection: true,
    })
  );
  return DecorationSet.create(doc, decorations);
}

/**
 * Disposable feasibility plugin: it paints only derived gap widgets inside a
 * single EditorView. It intentionally has no persistence or product wiring.
 */
export function createDisposablePaginationProofPlugin() {
  return new Plugin<DisposablePaginationProofPlan>({
    key: disposablePaginationProofKey,
    state: {
      init: () => EMPTY_PLAN,
      apply(transaction, previous) {
        const requested = transaction.getMeta(disposablePaginationProofKey) as
          | DisposablePaginationProofPlan
          | undefined;
        if (requested) return requested;
        if (!transaction.docChanged || previous.gaps.length === 0) {
          return previous;
        }
        return {
          ...previous,
          gaps: previous.gaps.map((gap) => ({
            ...gap,
            pos: transaction.mapping.map(gap.pos, -1),
          })),
        };
      },
    },
    props: {
      decorations(state) {
        return decorationsFor(
          state.doc,
          disposablePaginationProofKey.getState(state) ?? EMPTY_PLAN,
        );
      },
    },
  });
}

export function setDisposablePaginationProofPlan(
  editor: Editor,
  plan: DisposablePaginationProofPlan,
): void {
  editor.view.dispatch(
    editor.state.tr
      .setMeta(disposablePaginationProofKey, plan)
      .setMeta("addToHistory", false),
  );
}

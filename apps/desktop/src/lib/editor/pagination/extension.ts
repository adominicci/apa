import { type Editor, Extension } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import {
  createPaginationMeasurer,
  type PaginationMeasurer,
  type PaginationMeasurerOptions,
} from "./measure.ts";
import { planPagination } from "./plan.ts";
import type {
  PaginationEnvironment,
  PaginationGap,
  PaginationInput,
  PaginationPlan,
  PaginationReason,
  StablePaginationPlan,
  TableRowStart,
} from "./types.ts";

export type PaginationStatus = "settling" | "stable" | "fallback";

export interface PaginationPluginState {
  status: PaginationStatus;
  epoch: number;
  pass: number;
  reason: PaginationReason;
  visiblePlan: StablePaginationPlan | null;
  lastStablePlan: StablePaginationPlan | null;
  candidateSignature: string | null;
}

export interface PaginationDependencies {
  createMeasurer(options: PaginationMeasurerOptions): PaginationMeasurer;
  plan(input: PaginationInput): PaginationPlan;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
  maxPasses: number;
}

type PaginationMeta =
  | { type: "invalidate"; reason: PaginationReason }
  | {
    type: "candidate";
    epoch: number;
    pass: number;
    plan: StablePaginationPlan;
    signature: string;
  }
  | {
    type: "stable";
    epoch: number;
    pass: number;
    plan: StablePaginationPlan;
    signature: string;
  }
  | { type: "fallback"; epoch: number; pass: number };

const DEFAULT_MAX_PASSES = 4;

export const paginationPluginKey = new PluginKey<PaginationPluginState>(
  "tesinaPagination",
);

function mapPlan(
  plan: StablePaginationPlan | null,
  transaction: Transaction,
): StablePaginationPlan | null {
  if (!plan) return null;
  const map = (pos: number) => transaction.mapping.map(pos, -1);
  return {
    ...plan,
    pageStarts: plan.pageStarts.map((start) => ({
      ...start,
      pos: map(start.pos),
    })),
    pageGaps: plan.pageGaps.map((gap) => ({ ...gap, pos: map(gap.pos) })),
    tableRowStarts: plan.tableRowStarts.map((start) => ({
      ...start,
      pos: map(start.pos),
    })),
    overflows: plan.overflows.map((overflow) => ({
      ...overflow,
      pos: map(overflow.pos),
    })),
  };
}

function initialState(reason: PaginationReason): PaginationPluginState {
  return {
    status: "settling",
    epoch: 1,
    pass: 0,
    reason,
    visiblePlan: null,
    lastStablePlan: null,
    candidateSignature: null,
  };
}

function applyMeta(
  state: PaginationPluginState,
  meta: PaginationMeta,
): PaginationPluginState {
  if (meta.type === "invalidate") {
    return {
      ...state,
      status: "settling",
      epoch: state.epoch + 1,
      pass: 0,
      reason: meta.reason,
      visiblePlan: state.lastStablePlan,
      candidateSignature: null,
    };
  }
  if (meta.epoch !== state.epoch) return state;
  if (meta.type === "fallback") {
    return {
      ...state,
      status: "fallback",
      pass: meta.pass,
      visiblePlan: state.lastStablePlan,
      candidateSignature: null,
    };
  }
  if (meta.type === "stable") {
    return {
      ...state,
      status: "stable",
      pass: meta.pass,
      visiblePlan: meta.plan,
      lastStablePlan: meta.plan,
      candidateSignature: meta.signature,
    };
  }
  return {
    ...state,
    status: "settling",
    pass: meta.pass,
    visiblePlan: state.lastStablePlan,
    candidateSignature: meta.signature,
  };
}

function reduceState(
  transaction: Transaction,
  previous: PaginationPluginState,
): PaginationPluginState {
  if (transaction.docChanged) {
    const mappedLastStable = mapPlan(previous.lastStablePlan, transaction);
    return {
      ...previous,
      status: "settling",
      epoch: previous.epoch + 1,
      pass: 0,
      reason: "authored-content",
      visiblePlan: mappedLastStable,
      lastStablePlan: mappedLastStable,
      candidateSignature: null,
    };
  }
  const meta = transaction.getMeta(paginationPluginKey) as
    | PaginationMeta
    | undefined;
  return meta ? applyMeta(previous, meta) : previous;
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

/** Epoch is deliberately omitted: equal visual plans must stabilize. */
export function paginationPlanSignature(plan: StablePaginationPlan): string {
  return JSON.stringify({
    pageStarts: plan.pageStarts,
    pageGaps: plan.pageGaps.map((gap) => ({
      ...gap,
      height: rounded(gap.height),
    })),
    tableRowStarts: plan.tableRowStarts.map((start) => ({
      ...start,
      repeatedHeader: start.repeatedHeader
        ? {
          ...start.repeatedHeader,
          height: rounded(start.repeatedHeader.height),
        }
        : undefined,
    })),
    overflows: plan.overflows,
    pageCount: plan.pageCount,
  });
}

function setGapAttributes(element: HTMLElement, gap: PaginationGap): void {
  element.dataset["paginationGap"] = gap.kind;
  element.dataset["paginationPos"] = String(gap.pos);
  element.dataset["paginationPageIndex"] = String(gap.pageIndex);
  element.dataset["paginationGapHeight"] = String(gap.height);
  element.contentEditable = "false";
  element.setAttribute("aria-hidden", "true");
  element.tabIndex = -1;
  element.style.pointerEvents = "none";
  element.style.userSelect = "none";
}

/** Creates presentation-only DOM; it never clones a ProseMirror table row. */
export function createPaginationGapElement(
  ownerDocument: Document,
  gap: PaginationGap,
  tableStart?: TableRowStart,
): HTMLElement {
  if (gap.kind === "tableRow" && tableStart) {
    const row = ownerDocument.createElement("tr");
    setGapAttributes(row, gap);
    const cell = ownerDocument.createElement("td");
    cell.colSpan = tableStart.columnCount;
    cell.style.padding = "0";
    cell.style.border = "0";

    const header = tableStart.repeatedHeader;
    const spacer = ownerDocument.createElement("div");
    spacer.dataset["paginationGapSpace"] = "true";
    spacer.style.height = `${
      Math.max(0, gap.height - (header?.height ?? 0))
    }px`;
    cell.append(spacer);

    if (header) {
      const visualHeader = ownerDocument.createElement("div");
      visualHeader.dataset["paginationRepeatedHeader"] = "true";
      visualHeader.style.display = "grid";
      visualHeader.style.gridTemplateColumns =
        `repeat(${tableStart.columnCount}, minmax(0, 1fr))`;
      visualHeader.style.height = `${header.height}px`;
      for (const headerCell of header.cells) {
        const visualCell = ownerDocument.createElement("span");
        visualCell.dataset["paginationRepeatedHeaderCell"] = "true";
        visualCell.style.gridColumn = `span ${headerCell.colSpan}`;
        visualCell.textContent = headerCell.text;
        visualHeader.append(visualCell);
      }
      cell.append(visualHeader);
    }
    row.append(cell);
    return row;
  }

  const spacer = ownerDocument.createElement("span");
  setGapAttributes(spacer, gap);
  spacer.style.display = gap.kind === "line" ? "inline-block" : "block";
  if (gap.kind === "line") spacer.style.verticalAlign = "top";
  spacer.style.height = `${gap.height}px`;
  spacer.style.margin = "0";
  spacer.style.padding = "0";
  spacer.style.border = "0";
  return spacer;
}

function gapKey(gap: PaginationGap, tableStart?: TableRowStart): string {
  const header = tableStart?.repeatedHeader;
  const headerFingerprint = header
    ? `${rounded(header.height)}:${
      header.cells.map((cell) => `${cell.colSpan}:${cell.text}`).join("|")
    }`
    : "";
  return [
    "pagination-gap",
    gap.kind,
    gap.pos,
    gap.pageIndex,
    rounded(gap.height),
    tableStart?.columnCount ?? "",
    headerFingerprint,
  ].join(":");
}

function decorationsFor(
  doc: Parameters<typeof DecorationSet.create>[0],
  plan: StablePaginationPlan | null,
): DecorationSet {
  if (!plan) return DecorationSet.empty;
  const decorations = plan.pageGaps.flatMap((gap) => {
    if (gap.pos < 0 || gap.pos > doc.content.size) return [];
    const tableStart = gap.kind === "tableRow"
      ? plan.tableRowStarts.find((start) =>
        start.pageIndex === gap.pageIndex && start.pos === gap.pos
      )
      : undefined;
    if (gap.kind === "tableRow" && !tableStart) return [];
    return [Decoration.widget(
      gap.pos,
      (view) =>
        createPaginationGapElement(view.dom.ownerDocument, gap, tableStart),
      {
        side: -1,
        key: gapKey(gap, tableStart),
        stopEvent: () => true,
        ignoreSelection: true,
      },
    )];
  });
  return DecorationSet.create(doc, decorations);
}

function dispatchMeta(view: EditorView, meta: PaginationMeta): void {
  view.dispatch(
    view.state.tr
      .setMeta(paginationPluginKey, meta)
      .setMeta("addToHistory", false),
  );
}

class PaginationController {
  readonly #environment: PaginationEnvironment;
  readonly #dependencies: PaginationDependencies;
  readonly #measurer: PaginationMeasurer;
  #view: EditorView;
  #readFrame: number | null = null;
  #writeFrame: number | null = null;
  #readAbort: AbortController | null = null;
  #readInFlight = false;
  #destroyed = false;

  constructor(
    view: EditorView,
    environment: PaginationEnvironment,
    dependencies: PaginationDependencies,
  ) {
    this.#view = view;
    this.#environment = environment;
    this.#dependencies = dependencies;
    this.#measurer = dependencies.createMeasurer({
      view,
      onInvalidate: (reason) => this.invalidateFromMeasurement(reason),
    });
    const state = paginationPluginKey.getState(view.state);
    if (state) this.scheduleRead(state.epoch);
  }

  update(view: EditorView, previousState: EditorView["state"]): void {
    this.#view = view;
    const previous = paginationPluginKey.getState(previousState);
    const current = paginationPluginKey.getState(view.state);
    if (current && current.epoch !== previous?.epoch) {
      this.restart(current.epoch);
    }
  }

  invalidateFromMeasurement(reason: PaginationReason): void {
    if (this.#destroyed) return;
    const state = paginationPluginKey.getState(this.#view.state);
    if (!state) return;
    if (state.status === "settling") {
      this.scheduleRead(state.epoch);
      return;
    }
    dispatchMeta(this.#view, { type: "invalidate", reason });
  }

  restart(epoch: number): void {
    this.cancelScheduledWork();
    this.#readAbort?.abort();
    this.#readAbort = null;
    this.#readInFlight = false;
    this.scheduleRead(epoch);
  }

  scheduleRead(epoch: number): void {
    if (
      this.#destroyed || this.#readFrame !== null || this.#readInFlight ||
      this.#writeFrame !== null
    ) return;
    this.#readFrame = this.#dependencies.requestFrame(() => {
      this.#readFrame = null;
      void this.read(epoch);
    });
  }

  async read(epoch: number): Promise<void> {
    if (!this.isCurrent(epoch)) return;
    const abort = new AbortController();
    this.#readAbort = abort;
    this.#readInFlight = true;
    try {
      const measurement = await this.#measurer.read({
        epoch,
        signal: abort.signal,
        latestEpoch: () =>
          paginationPluginKey.getState(this.#view.state)?.epoch ?? epoch,
      });
      if (!this.isCurrent(epoch) || measurement.status === "stale") return;
      const plan = this.#dependencies.plan({
        epoch,
        latestEpoch: paginationPluginKey.getState(this.#view.state)?.epoch,
        fragments: measurement.fragments,
        emptySections: measurement.emptySections,
      });
      if (plan.status === "stable") this.schedulePlanWrite(epoch, plan);
    } catch {
      if (this.isCurrent(epoch)) this.scheduleFallbackWrite(epoch);
    } finally {
      if (this.#readAbort === abort) {
        this.#readAbort = null;
        this.#readInFlight = false;
      }
    }
  }

  schedulePlanWrite(epoch: number, plan: StablePaginationPlan): void {
    if (!this.isCurrent(epoch) || this.#writeFrame !== null) return;
    this.#writeFrame = this.#dependencies.requestFrame(() => {
      this.#writeFrame = null;
      this.writePlan(epoch, plan);
    });
  }

  writePlan(epoch: number, plan: StablePaginationPlan): void {
    if (!this.isCurrent(epoch)) return;
    const state = paginationPluginKey.getState(this.#view.state);
    if (!state) return;
    const signature = paginationPlanSignature(plan);
    const nextPass = state.pass + 1;
    if (state.candidateSignature === signature && state.pass > 0) {
      dispatchMeta(this.#view, {
        type: "stable",
        epoch,
        pass: nextPass,
        plan,
        signature,
      });
      this.#environment.onPageCount?.(plan.pageCount);
      return;
    }
    if (nextPass >= this.#dependencies.maxPasses) {
      dispatchMeta(this.#view, { type: "fallback", epoch, pass: nextPass });
      return;
    }
    dispatchMeta(this.#view, {
      type: "candidate",
      epoch,
      pass: nextPass,
      plan,
      signature,
    });
    this.scheduleRead(epoch);
  }

  scheduleFallbackWrite(epoch: number): void {
    if (!this.isCurrent(epoch) || this.#writeFrame !== null) return;
    this.#writeFrame = this.#dependencies.requestFrame(() => {
      this.#writeFrame = null;
      if (!this.isCurrent(epoch)) return;
      const state = paginationPluginKey.getState(this.#view.state);
      dispatchMeta(this.#view, {
        type: "fallback",
        epoch,
        pass: Math.min(
          this.#dependencies.maxPasses,
          (state?.pass ?? 0) + 1,
        ),
      });
    });
  }

  isCurrent(epoch: number): boolean {
    return !this.#destroyed &&
      paginationPluginKey.getState(this.#view.state)?.epoch === epoch;
  }

  cancelScheduledWork(): void {
    if (this.#readFrame !== null) {
      this.#dependencies.cancelFrame(this.#readFrame);
      this.#readFrame = null;
    }
    if (this.#writeFrame !== null) {
      this.#dependencies.cancelFrame(this.#writeFrame);
      this.#writeFrame = null;
    }
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.cancelScheduledWork();
    this.#readAbort?.abort();
    this.#readAbort = null;
    this.#measurer.destroy();
  }
}

function dependenciesFor(
  view: EditorView,
  overrides: Partial<PaginationDependencies>,
): PaginationDependencies {
  const ownerWindow = view.dom.ownerDocument.defaultView;
  if (!ownerWindow && (!overrides.requestFrame || !overrides.cancelFrame)) {
    throw new Error("Pagination requires a window-backed EditorView");
  }
  return {
    createMeasurer: overrides.createMeasurer ?? createPaginationMeasurer,
    plan: overrides.plan ?? planPagination,
    requestFrame: overrides.requestFrame ??
      ownerWindow!.requestAnimationFrame.bind(ownerWindow),
    cancelFrame: overrides.cancelFrame ??
      ownerWindow!.cancelAnimationFrame.bind(ownerWindow),
    maxPasses: Math.max(1, overrides.maxPasses ?? DEFAULT_MAX_PASSES),
  };
}

export function createPaginationPlugin(
  environment: PaginationEnvironment,
  dependencyOverrides: Partial<PaginationDependencies> = {},
): Plugin<PaginationPluginState> {
  return new Plugin<PaginationPluginState>({
    key: paginationPluginKey,
    state: {
      init: () => initialState(environment.reason),
      apply: reduceState,
    },
    props: {
      decorations(state) {
        return decorationsFor(
          state.doc,
          paginationPluginKey.getState(state)?.visiblePlan ?? null,
        );
      },
    },
    view(view) {
      const controller = new PaginationController(
        view,
        environment,
        dependenciesFor(view, dependencyOverrides),
      );
      return {
        update: (updatedView, previousState) =>
          controller.update(updatedView, previousState),
        destroy: () => controller.destroy(),
      };
    },
  });
}

export function createPaginationExtension(
  environment: PaginationEnvironment,
  dependencies: Partial<PaginationDependencies> = {},
): Extension {
  return Extension.create({
    name: "tesinaPagination",
    addProseMirrorPlugins() {
      return [createPaginationPlugin(environment, dependencies)];
    },
  });
}

export function invalidatePagination(
  editor: Editor,
  reason: PaginationReason,
): void {
  editor.view.dispatch(
    editor.state.tr
      .setMeta(paginationPluginKey, { type: "invalidate", reason })
      .setMeta("addToHistory", false),
  );
}

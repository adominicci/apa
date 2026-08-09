// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { exportDocx } from "@tesina/docx-export";
import { strFromU8, unzipSync } from "fflate";
import { createEmptyEssay } from "$lib/model/essay";
import { renderEssayHtml } from "$lib/preview/renderEssayHtml.ts";
import { createTesinaEditor } from "../createEditor.ts";
import type {
  MeasurementResult,
  MeasureRequest,
  PaginationMeasurer,
  PaginationMeasurerOptions,
} from "./measure.ts";
import { createPaginationMeasurer } from "./measure.ts";
import type {
  PaginationInput,
  PaginationPlan,
  PaginationReason,
  PaginationStateReport,
  StablePaginationPlan,
} from "./types.ts";
import {
  createPaginationGapElement,
  createPaginationPlugin,
  invalidatePagination,
  paginationPluginKey,
} from "./extension.ts";
import { createLongDocumentFixtures } from "./proof/longDocumentFixture.ts";

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

class TestFrames {
  readonly callbacks = new Map<number, FrameRequestCallback>();
  readonly cancelled: number[] = [];
  #next = 1;

  request = (callback: FrameRequestCallback): number => {
    const id = this.#next++;
    this.callbacks.set(id, callback);
    return id;
  };

  cancel = (id: number): void => {
    this.cancelled.push(id);
    this.callbacks.delete(id);
  };

  async flushOne(): Promise<void> {
    const entry = this.callbacks.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    if (!entry) throw new Error("No scheduled pagination frame");
    this.callbacks.delete(entry[0]);
    entry[1](performance.now());
    await Promise.resolve();
    await Promise.resolve();
  }

  async flushAll(limit = 20): Promise<void> {
    let count = 0;
    while (this.callbacks.size > 0) {
      if (count++ >= limit) throw new Error("Pagination frames did not settle");
      await this.flushOne();
    }
  }
}

function positionOfText(doc: PMNode, needle: string): number {
  let result = -1;
  doc.descendants((node, pos) => {
    if (result >= 0) return false;
    if (node.isText && node.text?.includes(needle)) {
      result = pos + node.text.indexOf(needle);
      return false;
    }
    return true;
  });
  if (result < 0) throw new Error(`Missing test text: ${needle}`);
  return result;
}

function positionsOf(doc: PMNode, typeName: string): number[] {
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === typeName) positions.push(pos);
    return true;
  });
  return positions;
}

function stablePlan(epoch: number, gapPos: number): StablePaginationPlan {
  return {
    status: "stable",
    epoch,
    pageStarts: [
      { pageIndex: 0, pos: 1, section: "body", kind: "section" },
      { pageIndex: 1, pos: gapPos, section: "body", kind: "line" },
    ],
    pageGaps: [{
      fragmentId: "test-line",
      pageIndex: 1,
      pos: gapPos,
      section: "body",
      kind: "line",
      height: 220,
    }],
    tableRowStarts: [],
    overflows: [],
    pageCount: {
      authored: 2,
      references: 0,
      total: 2,
      bySection: { abstract: 0, body: 2, appendix: 0, references: 0 },
    },
  };
}

function tablePlan(epoch: number, rowPos: number): StablePaginationPlan {
  const plan = stablePlan(epoch, rowPos);
  return {
    ...plan,
    pageStarts: plan.pageStarts.map((start, index) =>
      index === 1 ? { ...start, kind: "tableRow" } : start
    ),
    pageGaps: [{
      ...plan.pageGaps[0]!,
      fragmentId: "results-row-2",
      kind: "tableRow",
      height: 312,
    }],
    tableRowStarts: [{
      pageIndex: 1,
      pos: rowPos,
      section: "body",
      tableId: "results",
      columnCount: 3,
      repeatedHeader: {
        height: 44,
        cells: [
          { text: "Round", colSpan: 1 },
          { text: "Cards", colSpan: 1 },
          { text: "Envelopes", colSpan: 1 },
        ],
      },
    }],
  };
}

function measured(epoch: number): MeasurementResult {
  return { status: "measured", epoch, fragments: [], emptySections: [] };
}

function deferredMeasurement(): {
  promise: Promise<MeasurementResult>;
  resolve(result: MeasurementResult): void;
} {
  let resolve!: (result: MeasurementResult) => void;
  const promise = new Promise<MeasurementResult>((done) => resolve = done);
  return { promise, resolve };
}

function createEditor(): { editor: Editor; element: HTMLElement } {
  const fixture = createLongDocumentFixtures().en;
  const element = document.createElement("div");
  document.body.append(element);
  const editor = createTesinaEditor({
    element,
    content: fixture.content,
    newlyCreated: true,
    citationEnv: {
      refsById: new Map(fixture.references.map((ref) => [ref.id, ref])),
      locale: "en",
    },
    referenceEnv: {
      references: fixture.references,
      locale: "en",
      emptyLabel: "unused",
    },
    paginationEnv: null,
  });
  return { editor, element };
}

function contentWithFigureAsset(content: unknown, src: string): unknown {
  const authored = structuredClone(content);
  let replaced = false;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const node = value as {
      type?: string;
      attrs?: Record<string, unknown>;
      content?: unknown[];
    };
    if (!replaced && node.type === "figureImage") {
      node.attrs = { ...node.attrs, src };
      replaced = true;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(authored);
  if (!replaced) throw new Error("Fixture has no figure image");
  return authored;
}

async function flushUntilStatus(
  editor: Editor,
  frames: TestFrames,
  status: "stable" | "fallback",
  attempts = 8,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (paginationPluginKey.getState(editor.state)?.status === status) return;
    if (frames.callbacks.size > 0) await frames.flushOne();
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(
    `Pagination did not reach ${status}; got ${
      paginationPluginKey.getState(editor.state)?.status
    }`,
  );
}

afterEach(() => document.body.replaceChildren());

describe("derived pagination extension", () => {
  it("reports settling, stable, and last-stable fallback lifecycle states", async () => {
    const frames = new TestFrames();
    const { editor } = createEditor();
    const gapPos = positionOfText(editor.state.doc, "simulated round") + 8;
    const reports: PaginationStateReport[] = [];
    let failMeasurement = false;
    const measurer: PaginationMeasurer = {
      read: ({ epoch }) =>
        failMeasurement
          ? Promise.reject(new Error("layout unavailable"))
          : Promise.resolve(measured(epoch)),
      destroy: () => {},
    };
    try {
      editor.registerPlugin(createPaginationPlugin(
        {
          reason: "authored-content",
          onPageCount: (report) => reports.push(report),
        },
        {
          createMeasurer: () => measurer,
          plan: (input) => stablePlan(input.epoch, gapPos),
          requestFrame: frames.request,
          cancelFrame: frames.cancel,
        },
      ));

      expect(reports).toEqual([expect.objectContaining({
        status: "settling",
        epoch: 1,
        pageCount: null,
        lastStablePlan: null,
      })]);
      await frames.flushAll();
      expect(reports.at(-1)).toEqual(expect.objectContaining({
        status: "stable",
        epoch: 1,
        pageCount: expect.objectContaining({ authored: 2 }),
        lastStablePlan: expect.objectContaining({ epoch: 1 }),
      }));

      failMeasurement = true;
      invalidatePagination(editor, "font");
      expect(reports.at(-1)).toEqual(expect.objectContaining({
        status: "settling",
        epoch: 2,
        reason: "font",
        pageCount: expect.objectContaining({ authored: 2 }),
        lastStablePlan: expect.objectContaining({ epoch: 1 }),
      }));
      await frames.flushAll();
      expect(reports.at(-1)).toEqual(expect.objectContaining({
        status: "fallback",
        epoch: 2,
        pageCount: expect.objectContaining({ authored: 2 }),
        lastStablePlan: expect.objectContaining({ epoch: 1 }),
      }));
    } finally {
      editor.destroy();
    }
  });

  it("reports first-plan failure as fallback without an exact count", async () => {
    const frames = new TestFrames();
    const { editor } = createEditor();
    const reports: PaginationStateReport[] = [];
    try {
      editor.registerPlugin(createPaginationPlugin(
        {
          reason: "canonical-layout",
          onPageCount: (report) => reports.push(report),
        },
        {
          createMeasurer: () => ({
            read: () => Promise.reject(new Error("layout unavailable")),
            destroy: () => {},
          }),
          requestFrame: frames.request,
          cancelFrame: frames.cancel,
        },
      ));
      await frames.flushAll();

      expect(reports.at(-1)).toEqual(expect.objectContaining({
        status: "fallback",
        pageCount: null,
        lastStablePlan: null,
      }));
    } finally {
      editor.destroy();
    }
  });

  it("maps a stable plan through authored edits without entering JSON or undo history", async () => {
    const frames = new TestFrames();
    const { editor, element } = createEditor();
    const initialGapPos = positionOfText(editor.state.doc, "simulated round") +
      8;
    let plannedGapPos = initialGapPos;
    const measurer: PaginationMeasurer = {
      read: ({ epoch }) => Promise.resolve(measured(epoch)),
      destroy: () => {},
    };
    try {
      editor.registerPlugin(createPaginationPlugin(
        { reason: "authored-content" },
        {
          createMeasurer: (_options: PaginationMeasurerOptions) => measurer,
          plan: (input: PaginationInput): PaginationPlan =>
            stablePlan(input.epoch, plannedGapPos),
          requestFrame: frames.request,
          cancelFrame: frames.cancel,
        },
      ));
      await frames.flushAll();

      const baselineJson = JSON.stringify(editor.getJSON());
      expect(paginationPluginKey.getState(editor.state)?.status).toBe("stable");
      expect(
        element.querySelector<HTMLElement>("[data-pagination-gap]")?.dataset
          .paginationPos,
      ).toBe(String(initialGapPos));

      const editPos = initialGapPos - 2;
      plannedGapPos += 1;
      editor.view.dispatch(editor.state.tr.insertText("X", editPos));
      await frames.flushAll();

      expect(JSON.stringify(editor.getJSON())).not.toBe(baselineJson);
      expect(
        paginationPluginKey.getState(editor.state)?.visiblePlan?.pageGaps[0]
          ?.pos,
      ).toBe(initialGapPos + 1);
      expect(editor.commands.undo()).toBe(true);
      expect(JSON.stringify(editor.getJSON())).toBe(baselineJson);
    } finally {
      editor.destroy();
    }
  });

  it("exports authored JSON without serializing a painted live page gap", async () => {
    const frames = new TestFrames();
    const fixture = createLongDocumentFixtures().en;
    const { editor, element } = createEditor();
    const gapPos = positionOfText(editor.state.doc, "simulated round") + 8;
    try {
      editor.registerPlugin(createPaginationPlugin(
        { reason: "authored-content" },
        {
          createMeasurer: () => ({
            read: ({ epoch }) => Promise.resolve(measured(epoch)),
            destroy: () => {},
          }),
          plan: (input) => stablePlan(input.epoch, gapPos),
          requestFrame: frames.request,
          cancelFrame: frames.cancel,
        },
      ));
      await frames.flushAll();
      expect(element.querySelectorAll("[data-pagination-gap]")).toHaveLength(
        1,
      );

      const bytes = await exportDocx({
        content: editor.getJSON(),
        settings: {
          documentLanguage: "en",
          variant: "student",
          font: "times-new-roman-12",
          paperSize: "us-letter",
        },
        titlePage: {
          title: "Fallback proof paper",
          authors: [],
          affiliations: [],
        },
        references: fixture.references,
        images: {},
      });
      const files = unzipSync(bytes);
      const documentXml = strFromU8(files["word/document.xml"]!);
      expect(documentXml).not.toMatch(/<w:br[^>]*w:type="page"/);
      expect(documentXml.match(/<w:pageBreakBefore\/>/g)).toHaveLength(4);
      expect(documentXml).toContain(
        '<w:pgSz w:w="12240" w:h="15840" w:orient="portrait"/>',
      );
      expect(documentXml).toContain(
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"',
      );
    } finally {
      editor.destroy();
    }
  });

  it("never lets an older asynchronous measurement replace the newest epoch", async () => {
    const frames = new TestFrames();
    const { editor } = createEditor();
    const initialGapPos = positionOfText(editor.state.doc, "simulated round") +
      8;
    const pending: Array<{
      request: MeasureRequest;
      deferred: ReturnType<typeof deferredMeasurement>;
    }> = [];
    let invalidate: ((reason: PaginationReason) => void) | undefined;
    const pageCounts: number[] = [];
    const measurer: PaginationMeasurer = {
      read: (request) => {
        const deferred = deferredMeasurement();
        pending.push({ request, deferred });
        return deferred.promise;
      },
      destroy: () => {},
    };
    try {
      editor.registerPlugin(createPaginationPlugin(
        {
          reason: "authored-content",
          onPageCount: (report) => {
            if (report.status === "stable" && report.pageCount) {
              pageCounts.push(report.pageCount.authored);
            }
          },
        },
        {
          createMeasurer: (options) => {
            invalidate = options.onInvalidate;
            return measurer;
          },
          plan: (input) => stablePlan(input.epoch, initialGapPos + input.epoch),
          requestFrame: frames.request,
          cancelFrame: frames.cancel,
        },
      ));
      await frames.flushOne();
      expect(pending.map(({ request }) => request.epoch)).toEqual([1]);

      editor.view.dispatch(editor.state.tr.insertText("X", initialGapPos - 2));
      await frames.flushOne();
      expect(pending.map(({ request }) => request.epoch)).toEqual([1, 2]);

      pending[0]!.deferred.resolve(measured(1));
      await Promise.resolve();
      expect(frames.callbacks.size).toBe(0);
      invalidate?.("asset");
      expect(frames.callbacks.size).toBe(0);
      expect(pending).toHaveLength(2);

      pending[1]!.deferred.resolve(measured(2));
      await Promise.resolve();
      await frames.flushOne(); // candidate write
      await frames.flushOne(); // verification read
      pending[2]!.deferred.resolve(measured(2));
      await Promise.resolve();
      await frames.flushOne(); // stable write

      const state = paginationPluginKey.getState(editor.state);
      expect(state?.status).toBe("stable");
      expect(state?.epoch).toBe(2);
      expect(state?.visiblePlan?.pageGaps[0]?.pos).toBe(initialGapPos + 2);
      expect(pageCounts).toEqual([2]);
    } finally {
      editor.destroy();
    }
  });

  it("bounds oscillating layouts and restores the last stable plan", async () => {
    const frames = new TestFrames();
    const { editor, element } = createEditor();
    const gapPos = positionOfText(editor.state.doc, "simulated round") + 8;
    let call = 0;
    let oscillating = false;
    const pageCounts: number[] = [];
    const measurer: PaginationMeasurer = {
      read: ({ epoch }) => Promise.resolve(measured(epoch)),
      destroy: () => {},
    };
    try {
      editor.registerPlugin(createPaginationPlugin(
        {
          reason: "authored-content",
          onPageCount: (report) => {
            if (report.status === "stable" && report.pageCount) {
              pageCounts.push(report.pageCount.authored);
            }
          },
        },
        {
          createMeasurer: () => measurer,
          plan: (input) => {
            call += 1;
            const plan = stablePlan(input.epoch, gapPos);
            if (oscillating) {
              plan.pageGaps[0] = {
                ...plan.pageGaps[0]!,
                height: call % 2 === 0 ? 221 : 222,
              };
            }
            return plan;
          },
          requestFrame: frames.request,
          cancelFrame: frames.cancel,
          maxPasses: 3,
        },
      ));
      await frames.flushAll();
      const stableGap = element.querySelector<HTMLElement>(
        "[data-pagination-gap]",
      );
      expect(stableGap?.style.height).toBe("220px");

      oscillating = true;
      invalidatePagination(editor, "font");
      await frames.flushOne(); // measurement read
      await frames.flushOne(); // provisional result
      const settling = paginationPluginKey.getState(editor.state);
      expect(settling).toMatchObject({ status: "settling", pass: 1 });
      expect(settling?.visiblePlan?.pageGaps[0]?.height).toBe(220);
      expect(
        element.querySelector<HTMLElement>("[data-pagination-gap]"),
      ).toBe(stableGap);
      await frames.flushAll();

      const state = paginationPluginKey.getState(editor.state);
      expect(state).toMatchObject({ status: "fallback", pass: 3, epoch: 2 });
      expect(state?.visiblePlan?.pageGaps[0]?.height).toBe(220);
      expect(
        element.querySelector<HTMLElement>("[data-pagination-gap]")?.style
          .height,
      ).toBe("220px");
      expect(pageCounts).toEqual([2]);
    } finally {
      editor.destroy();
    }
  });

  it("falls back to a continuous editable view when the first measurement fails", async () => {
    const frames = new TestFrames();
    const { editor, element } = createEditor();
    const editPos = positionOfText(editor.state.doc, "simulated round") + 2;
    const measurer: PaginationMeasurer = {
      read: () => Promise.reject(new Error("layout unavailable")),
      destroy: () => {},
    };
    try {
      editor.registerPlugin(createPaginationPlugin(
        { reason: "font" },
        {
          createMeasurer: () => measurer,
          requestFrame: frames.request,
          cancelFrame: frames.cancel,
        },
      ));
      await frames.flushAll();

      expect(paginationPluginKey.getState(editor.state)).toMatchObject({
        status: "fallback",
        visiblePlan: null,
        lastStablePlan: null,
      });
      expect(element.querySelector("[data-pagination-gap]")).toBeNull();
      editor.view.dispatch(editor.state.tr.insertText("X", editPos));
      expect(editor.state.doc.textBetween(editPos, editPos + 1)).toBe("X");
    } finally {
      editor.destroy();
    }
  });

  it("keeps fallback edits available to autosave, preview, and export with a missing asset", async () => {
    const frames = new TestFrames();
    const fixture = createLongDocumentFixtures().en;
    const missingAsset = "essays/assets/missing-proof-figure.png";
    const content = contentWithFigureAsset(fixture.content, missingAsset);
    const element = document.createElement("div");
    document.body.append(element);
    let autosaveContent: unknown;
    const editor = createTesinaEditor({
      element,
      content,
      newlyCreated: true,
      citationEnv: {
        refsById: new Map(fixture.references.map((ref) => [ref.id, ref])),
        locale: "en",
      },
      referenceEnv: {
        references: fixture.references,
        locale: "en",
        emptyLabel: "unused",
      },
      paginationEnv: null,
      onUpdate: (docJson) => autosaveContent = structuredClone(docJson),
    });
    const editPos = positionOfText(editor.state.doc, "simulated round") + 2;
    const image = element.querySelector<HTMLImageElement>("img.fig-img")!;
    let assetReady = false;
    Object.defineProperty(image, "complete", {
      configurable: true,
      get: () => assetReady,
    });
    try {
      editor.registerPlugin(createPaginationPlugin(
        { reason: "asset" },
        {
          createMeasurer: (options) =>
            createPaginationMeasurer({
              ...options,
              readinessTimeoutMs: 25,
            }),
          requestFrame: frames.request,
          cancelFrame: frames.cancel,
        },
      ));
      await flushUntilStatus(editor, frames, "fallback");
      expect(paginationPluginKey.getState(editor.state)?.status).toBe(
        "fallback",
      );

      editor.view.dispatch(editor.state.tr.insertText("X", editPos));
      expect(autosaveContent).toEqual(editor.getJSON());
      await flushUntilStatus(editor, frames, "fallback");

      expect(paginationPluginKey.getState(editor.state)?.status).toBe(
        "fallback",
      );
      expect(JSON.stringify(autosaveContent)).toContain(missingAsset);

      const essay = createEmptyEssay("en", "2026-08-08T12:00:00.000Z");
      essay.titlePage.title = "Fallback proof paper";
      essay.content = autosaveContent;
      essay.referencesSnapshot = fixture.references;
      expect(JSON.stringify(essay)).not.toMatch(
        /"(?:pagination|pageStarts|pageGaps|pageCount|pageNumber)"/,
      );

      const preview = renderEssayHtml(
        essay,
        essay.content,
        fixture.references,
      );
      expect(preview).toContain("X");
      expect(preview).toContain('class="apa-figure"');
      expect(preview).not.toContain(missingAsset);

      const bytes = await exportDocx({
        content: essay.content,
        settings: essay.settings,
        titlePage: essay.titlePage,
        references: fixture.references,
        images: {},
      });
      expect([...bytes.slice(0, 4)]).toEqual([80, 75, 3, 4]);

      assetReady = true;
      image.dispatchEvent(new Event("load"));
      expect(frames.callbacks.size).toBe(1);
    } finally {
      editor.destroy();
    }
  });

  it("tears down observers, pending reads, and scheduled frame work", async () => {
    const frames = new TestFrames();
    const { editor } = createEditor();
    const deferred = deferredMeasurement();
    let readSignal: AbortSignal | undefined;
    let destroys = 0;
    const pageCounts: number[] = [];
    const measurer: PaginationMeasurer = {
      read: (request) => {
        readSignal = request.signal;
        return deferred.promise;
      },
      destroy: () => destroys += 1,
    };
    editor.registerPlugin(createPaginationPlugin(
      {
        reason: "canonical-layout",
        onPageCount: (report) => {
          if (report.status === "stable" && report.pageCount) {
            pageCounts.push(report.pageCount.total);
          }
        },
      },
      {
        createMeasurer: () => measurer,
        requestFrame: frames.request,
        cancelFrame: frames.cancel,
      },
    ));
    await frames.flushOne();
    expect(readSignal?.aborted).toBe(false);

    editor.destroy();
    expect(readSignal?.aborted).toBe(true);
    expect(destroys).toBe(1);
    deferred.resolve(measured(1));
    await Promise.resolve();
    await Promise.resolve();
    expect(frames.callbacks.size).toBe(0);
    expect(pageCounts).toEqual([]);
  });

  it("coalesces measurement observer feedback while settling", async () => {
    const frames = new TestFrames();
    const { editor } = createEditor();
    const gapPos = positionOfText(editor.state.doc, "simulated round") + 8;
    let invalidate: ((reason: PaginationReason) => void) | undefined;
    const measurer: PaginationMeasurer = {
      read: ({ epoch }) => Promise.resolve(measured(epoch)),
      destroy: () => {},
    };
    try {
      editor.registerPlugin(createPaginationPlugin(
        { reason: "authored-content" },
        {
          createMeasurer: (options) => {
            invalidate = options.onInvalidate;
            return measurer;
          },
          plan: (input) => stablePlan(input.epoch, gapPos),
          requestFrame: frames.request,
          cancelFrame: frames.cancel,
        },
      ));
      await frames.flushOne(); // first read
      await frames.flushOne(); // candidate write and verification read request
      expect(paginationPluginKey.getState(editor.state)).toMatchObject({
        status: "settling",
        epoch: 1,
        pass: 1,
      });

      invalidate?.("asset");
      invalidate?.("asset");
      expect(paginationPluginKey.getState(editor.state)?.epoch).toBe(1);
      expect(frames.callbacks.size).toBe(1);
      await frames.flushAll();
      expect(paginationPluginKey.getState(editor.state)?.status).toBe("stable");

      invalidate?.("asset");
      invalidate?.("asset");
      expect(paginationPluginKey.getState(editor.state)).toMatchObject({
        status: "settling",
        epoch: 2,
      });
      expect(frames.callbacks.size).toBe(1);
    } finally {
      editor.destroy();
    }
  });

  it("cancels a queued read frame when the plugin view is destroyed", () => {
    const frames = new TestFrames();
    const { editor } = createEditor();
    let destroys = 0;
    editor.registerPlugin(createPaginationPlugin(
      { reason: "canonical-layout" },
      {
        createMeasurer: () => ({
          read: ({ epoch }) => Promise.resolve(measured(epoch)),
          destroy: () => destroys += 1,
        }),
        requestFrame: frames.request,
        cancelFrame: frames.cancel,
      },
    ));
    const queued = [...frames.callbacks.keys()];

    editor.destroy();

    expect(queued).toHaveLength(1);
    expect(frames.cancelled).toEqual(queued);
    expect(frames.callbacks.size).toBe(0);
    expect(destroys).toBe(1);
  });

  it("reuses keyed gap DOM only while all visual geometry is unchanged", async () => {
    const frames = new TestFrames();
    const { editor, element } = createEditor();
    const gapPos = positionOfText(editor.state.doc, "simulated round") + 8;
    let gapHeight = 220;
    const measurer: PaginationMeasurer = {
      read: ({ epoch }) => Promise.resolve(measured(epoch)),
      destroy: () => {},
    };
    try {
      editor.registerPlugin(createPaginationPlugin(
        { reason: "authored-content" },
        {
          createMeasurer: () => measurer,
          plan: (input) => {
            const plan = stablePlan(input.epoch, gapPos);
            plan.pageGaps[0] = { ...plan.pageGaps[0]!, height: gapHeight };
            return plan;
          },
          requestFrame: frames.request,
          cancelFrame: frames.cancel,
        },
      ));
      await frames.flushAll();
      const first = element.querySelector<HTMLElement>("[data-pagination-gap]");
      expect(first).toMatchObject({
        contentEditable: "false",
        tabIndex: -1,
        textContent: "",
      });
      expect(first?.getAttribute("aria-hidden")).toBe("true");

      invalidatePagination(editor, "font");
      await frames.flushAll();
      expect(element.querySelector("[data-pagination-gap]")).toBe(first);

      gapHeight = 221;
      invalidatePagination(editor, "font");
      await frames.flushAll();
      const changed = element.querySelector<HTMLElement>(
        "[data-pagination-gap]",
      );
      expect(changed).not.toBe(first);
      expect(changed?.style.height).toBe("221px");
    } finally {
      editor.destroy();
    }
  });

  it("paints a valid table-row gap and a visual-only repeated header", async () => {
    const frames = new TestFrames();
    const { editor, element } = createEditor();
    const rowPositions = positionsOf(editor.state.doc, "tableRow");
    const rowPos = rowPositions[2]!;
    const baselineJson = JSON.stringify(editor.getJSON());
    let columnCount = 3;
    const measurer: PaginationMeasurer = {
      read: ({ epoch }) => Promise.resolve(measured(epoch)),
      destroy: () => {},
    };
    try {
      editor.registerPlugin(createPaginationPlugin(
        { reason: "authored-content" },
        {
          createMeasurer: () => measurer,
          plan: (input) => {
            const plan = tablePlan(input.epoch, rowPos);
            plan.tableRowStarts[0] = {
              ...plan.tableRowStarts[0]!,
              columnCount,
            };
            return plan;
          },
          requestFrame: frames.request,
          cancelFrame: frames.cancel,
        },
      ));
      await frames.flushAll();

      const gapRow = element.querySelector<HTMLTableRowElement>(
        "tr[data-pagination-gap='tableRow']",
      );
      expect(gapRow?.parentElement?.tagName).toBe("TBODY");
      expect(gapRow?.cells).toHaveLength(1);
      expect(gapRow?.cells[0]?.colSpan).toBe(3);
      expect(gapRow?.contentEditable).toBe("false");
      expect(gapRow?.getAttribute("aria-hidden")).toBe("true");
      expect(
        [...gapRow!.querySelectorAll("[data-pagination-repeated-header-cell]")]
          .map((cell) => cell.textContent),
      ).toEqual(["Round", "Cards", "Envelopes"]);
      expect(JSON.stringify(editor.getJSON())).toBe(baselineJson);
      expect(positionsOf(editor.state.doc, "tableRow")).toEqual(rowPositions);

      columnCount = 4;
      invalidatePagination(editor, "canonical-layout");
      await frames.flushAll();
      const changedGapRow = element.querySelector<HTMLTableRowElement>(
        "tr[data-pagination-gap='tableRow']",
      );
      expect(changedGapRow).not.toBe(gapRow);
      expect(changedGapRow?.cells[0]?.colSpan).toBe(4);
      expect(JSON.stringify(editor.getJSON())).toBe(baselineJson);
    } finally {
      editor.destroy();
    }
  });

  it("creates line and block widgets that cannot enter selection or copied text", () => {
    const line = createPaginationGapElement(document, {
      fragmentId: "line",
      pageIndex: 1,
      pos: 10,
      section: "body",
      kind: "line",
      height: 220,
    });
    const block = createPaginationGapElement(document, {
      fragmentId: "figure",
      pageIndex: 2,
      pos: 20,
      section: "body",
      kind: "block",
      height: 240,
    });

    expect(line.style.display).toBe("inline-block");
    expect(block.style.display).toBe("block");
    for (const widget of [line, block]) {
      expect(widget.contentEditable).toBe("false");
      expect(widget.getAttribute("aria-hidden")).toBe("true");
      expect(widget.tabIndex).toBe(-1);
      expect(widget.textContent).toBe("");
      expect(widget.style.pointerEvents).toBe("none");
    }
  });

  it("numbers authored pages around derived references without changing JSON", async () => {
    const frames = new TestFrames();
    const { editor, element } = createEditor();
    const bodyPos = positionOfText(editor.state.doc, "Invented paragraph 1");
    const appendixPos = positionOfText(
      editor.state.doc,
      "The appendix contains",
    );
    const baselineJson = JSON.stringify(editor.getJSON());
    let referenceCount = 2;
    const measurer: PaginationMeasurer = {
      read: ({ epoch }) => Promise.resolve(measured(epoch)),
      destroy: () => {},
    };
    try {
      editor.registerPlugin(createPaginationPlugin(
        {
          reason: "authored-content",
          getReferencePageCount: () => referenceCount,
        },
        {
          createMeasurer: () => measurer,
          plan: (input) => {
            const plan = stablePlan(input.epoch, appendixPos);
            const references = input.referencePageCount ?? 0;
            return {
              ...plan,
              pageStarts: [
                {
                  pageIndex: 0,
                  pos: bodyPos,
                  section: "body",
                  kind: "section",
                },
                {
                  pageIndex: 1,
                  pos: appendixPos,
                  section: "appendix",
                  kind: "section",
                },
              ],
              pageCount: {
                ...plan.pageCount,
                references,
                total: plan.pageCount.authored + references,
              },
            };
          },
          requestFrame: frames.request,
          cancelFrame: frames.cancel,
        },
      ));
      await frames.flushAll();

      const numbers = [...element.querySelectorAll<HTMLElement>(
        "[data-pagination-page-number]",
      )];
      expect(numbers.map((number) => number.textContent)).toEqual(["2", "5"]);
      const references = element.querySelector("[data-reference-pages]");
      expect(references).not.toBeNull();
      expect(
        references!.compareDocumentPosition(numbers[1]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);
      for (const number of numbers) {
        expect(number.contentEditable).toBe("false");
        expect(number.getAttribute("aria-hidden")).toBe("true");
        expect(number.tabIndex).toBe(-1);
      }
      referenceCount = 1;
      invalidatePagination(editor, "references");
      expect(
        [...element.querySelectorAll<HTMLElement>(
          "[data-pagination-page-number]",
        )].map((number) => number.textContent),
      ).toEqual(["2", "5"]);
      expect(JSON.stringify(editor.getJSON())).toBe(baselineJson);
    } finally {
      editor.destroy();
    }
  });
});

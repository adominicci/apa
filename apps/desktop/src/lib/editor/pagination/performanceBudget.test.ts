// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { createTesinaEditor } from "../createEditor.ts";
import {
  createPaginationPlugin,
  invalidatePagination,
  paginationPluginKey,
} from "./extension.ts";
import { calculatePaperScale } from "./paperScale.ts";
import { PAGINATION_RESPONSIVENESS_BUDGET } from "./performanceBudget.ts";
import type { MeasurementResult, PaginationMeasurer } from "./measure.ts";
import type { MeasuredFragment, PaginationStateReport } from "./types.ts";

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

class BenchmarkFrames {
  readonly callbacks = new Map<number, FrameRequestCallback>();
  readonly cancelled: number[] = [];
  executed = 0;
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

  async flushAll(limit = 12): Promise<number> {
    const before = this.executed;
    while (this.callbacks.size > 0) {
      if (this.executed - before >= limit) {
        throw new Error("Pagination frame budget did not settle");
      }
      const entry = this.callbacks.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined;
      if (!entry) break;
      this.callbacks.delete(entry[0]);
      this.executed += 1;
      entry[1](performance.now());
      await Promise.resolve();
      await Promise.resolve();
    }
    return this.executed - before;
  }
}

function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function paragraphContent(page: number) {
  return {
    type: "paragraph",
    content: [{
      type: "text",
      text: `Representative page ${page} carries stable invented text.`,
    }],
  };
}

function paragraphFragments(editor: Editor): MeasuredFragment[] {
  const fragments: MeasuredFragment[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph") return true;
    const index = fragments.length;
    fragments.push({
      id: `benchmark-paragraph-${index}`,
      from: pos,
      to: pos + node.nodeSize,
      section: "body",
      kind: "line",
      height: 864,
      breakBefore: { kind: "line", pos, section: "body" },
      forcePageStart: index === 0,
      lineGroup: { id: `benchmark-${index}`, index: 0, count: 1 },
    });
    return false;
  });
  return fragments;
}

function measurement(editor: Editor, epoch: number): MeasurementResult {
  return {
    status: "measured",
    epoch,
    fragments: paragraphFragments(editor),
    emptySections: [],
  };
}

function stableReportsSince(
  reports: readonly PaginationStateReport[],
  index: number,
): PaginationStateReport[] {
  return reports.slice(index).filter((report) => report.status === "stable");
}

afterEach(() => document.body.replaceChildren());

describe("deterministic pagination controller budget contract", () => {
  for (const targetPages of [10, 25, 50] as const) {
    it(`keeps ${targetPages}-page input responsive and pagination coalesced`, async () => {
      const budget = PAGINATION_RESPONSIVENESS_BUDGET.workloads[targetPages];
      const frames = new BenchmarkFrames();
      const reports: PaginationStateReport[] = [];
      let reads = 0;
      let referencePages = 0;
      const element = document.createElement("div");
      document.body.append(element);
      const editor = createTesinaEditor({
        element,
        content: {
          type: "doc",
          content: [{
            type: "sectionBody",
            content: Array.from(
              { length: targetPages },
              (_, index) => paragraphContent(index + 1),
            ),
          }],
        },
        newlyCreated: true,
        citationEnv: { refsById: new Map(), locale: "en" },
        referenceEnv: { references: [], locale: "en", emptyLabel: "unused" },
        paginationEnv: null,
      });
      const measurer: PaginationMeasurer = {
        read: ({ epoch }) => {
          reads += 1;
          return Promise.resolve(measurement(editor, epoch));
        },
        destroy: () => {},
      };

      try {
        editor.registerPlugin(createPaginationPlugin(
          {
            reason: "canonical-layout",
            getReferencePageCount: () => referencePages,
            onPageCount: (report) => reports.push(report),
          },
          {
            createMeasurer: () => measurer,
            requestFrame: frames.request,
            cancelFrame: frames.cancel,
          },
        ));
        expect(await frames.flushAll()).toBeLessThanOrEqual(
          PAGINATION_RESPONSIVENESS_BUDGET.maxFramesPerEpoch,
        );
        expect(reports.at(-1)?.pageCount?.authored).toBe(targetPages);

        const firstParagraph = paragraphFragments(editor)[0]!.from + 1;
        const readsBeforeTyping = reads;
        const reportIndexBeforeTyping = reports.length;
        const inputDurations: number[] = [];
        for (let index = 0; index < 20; index += 1) {
          const startedAt = performance.now();
          editor.view.dispatch(editor.state.tr.insertText("x", firstParagraph));
          inputDurations.push(performance.now() - startedAt);
        }
        expect(reads).toBe(readsBeforeTyping);
        expect(frames.callbacks.size).toBeLessThanOrEqual(1);
        expect(percentile95(inputDurations)).toBeLessThanOrEqual(
          PAGINATION_RESPONSIVENESS_BUDGET.inputP95Ms,
        );
        expect(Math.max(...inputDurations)).toBeLessThanOrEqual(
          PAGINATION_RESPONSIVENESS_BUDGET.inputMaxMs,
        );
        const typingStartedAt = performance.now();
        const typingFrames = await frames.flushAll();
        const typingSettledMs = performance.now() - typingStartedAt;
        expect(typingFrames).toBeLessThanOrEqual(
          PAGINATION_RESPONSIVENESS_BUDGET.maxFramesPerEpoch,
        );
        expect(typingSettledMs).toBeLessThanOrEqual(budget.typingDeletionMs);
        const typingStable = stableReportsSince(
          reports,
          reportIndexBeforeTyping,
        );
        expect(typingStable).toHaveLength(1);
        expect(typingStable[0]?.epoch).toBe(
          paginationPluginKey.getState(editor.state)?.epoch,
        );

        const deleteReportIndex = reports.length;
        const deleteStartedAt = performance.now();
        editor.view.dispatch(
          editor.state.tr.delete(firstParagraph, firstParagraph + 20),
        );
        const deleteInputMs = performance.now() - deleteStartedAt;
        expect(deleteInputMs).toBeLessThanOrEqual(
          PAGINATION_RESPONSIVENESS_BUDGET.inputMaxMs,
        );
        const deleteSettleStartedAt = performance.now();
        expect(await frames.flushAll()).toBeLessThanOrEqual(
          PAGINATION_RESPONSIVENESS_BUDGET.maxFramesPerEpoch,
        );
        const deleteSettledMs = performance.now() - deleteSettleStartedAt;
        expect(deleteSettledMs).toBeLessThanOrEqual(budget.typingDeletionMs);
        expect(stableReportsSince(reports, deleteReportIndex)).toHaveLength(1);

        referencePages = 2;
        const referenceReportIndex = reports.length;
        const referenceStartedAt = performance.now();
        invalidatePagination(editor, "references");
        expect(await frames.flushAll()).toBeLessThanOrEqual(
          PAGINATION_RESPONSIVENESS_BUDGET.maxFramesPerEpoch,
        );
        const referenceSettledMs = performance.now() - referenceStartedAt;
        expect(referenceSettledMs).toBeLessThanOrEqual(
          budget.referenceFontMs,
        );
        const referenceStable = stableReportsSince(
          reports,
          referenceReportIndex,
        );
        expect(referenceStable).toHaveLength(1);
        expect(referenceStable[0]?.pageCount?.references).toBe(2);

        const fontReportIndex = reports.length;
        const fontStartedAt = performance.now();
        invalidatePagination(editor, "font");
        expect(await frames.flushAll()).toBeLessThanOrEqual(
          PAGINATION_RESPONSIVENESS_BUDGET.maxFramesPerEpoch,
        );
        const fontSettledMs = performance.now() - fontStartedAt;
        expect(fontSettledMs).toBeLessThanOrEqual(budget.referenceFontMs);
        expect(stableReportsSince(reports, fontReportIndex)).toHaveLength(1);

        const resizeEpoch = paginationPluginKey.getState(editor.state)?.epoch;
        const resizeStartedAt = performance.now();
        const scaled = calculatePaperScale(612, targetPages * 1_084);
        const resizeMs = performance.now() - resizeStartedAt;
        expect(scaled.scale).toBe(0.75);
        expect(resizeMs).toBeLessThanOrEqual(budget.resizeMs);
        expect(paginationPluginKey.getState(editor.state)?.epoch).toBe(
          resizeEpoch,
        );
        expect(frames.callbacks.size).toBe(0);

        const stableEpochs = reports
          .filter((report) => report.status === "stable")
          .map((report) => report.epoch);
        expect(new Set(stableEpochs).size).toBe(stableEpochs.length);
      } finally {
        editor.destroy();
      }
    });
  }
});

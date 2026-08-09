import { describe, expect, it } from "vitest";
import {
  evaluateLivePagedGeometry,
  evaluateNativePaginationWorkload,
  type NativePaginationWorkloadResult,
  remainingNativeDeadlineMs,
  waitForNativeCondition,
} from "./nativePerformance.ts";

function passingResult(
  targetPages: 10 | 25 | 50,
): NativePaginationWorkloadResult {
  return {
    targetPages,
    authoredPages: targetPages,
    inputDurationsMs: [2, 3, 4],
    maxPendingFrames: 1,
    readsDuringInput: 0,
    staleStableCommits: 0,
    duplicateStableEpochs: 0,
    referenceEntriesBefore: 1,
    referenceEntriesAfter: 4,
    fontFamilyBefore: "Georgia, Times New Roman, serif",
    fontFamilyAfter: "Times New Roman, Times, Georgia, serif",
    scaleBefore: 1,
    scaleAfter: 0.75,
    operations: {
      rapidTyping: {
        settlementMs: 100,
        paginationFrames: 4,
        stableCommits: 1,
        fallbackCommits: 0,
        startEpoch: 2,
        endEpoch: 2,
      },
      deletion: {
        settlementMs: 90,
        paginationFrames: 4,
        stableCommits: 1,
        fallbackCommits: 0,
        startEpoch: 3,
        endEpoch: 3,
      },
      referenceRefresh: {
        settlementMs: 120,
        paginationFrames: 4,
        stableCommits: 1,
        fallbackCommits: 0,
        startEpoch: 4,
        endEpoch: 4,
      },
      fontChange: {
        settlementMs: 130,
        paginationFrames: 4,
        stableCommits: 1,
        fallbackCommits: 0,
        startEpoch: 5,
        endEpoch: 5,
      },
      scaleResize: {
        settlementMs: 10,
        paginationFrames: 0,
        stableCommits: 0,
        fallbackCommits: 0,
        startEpoch: 5,
        endEpoch: 5,
      },
    },
  };
}

describe("native pagination performance evidence", () => {
  it.each([10, 25, 50] as const)(
    "accepts a rendered %i-page workload inside the fixed budget",
    (targetPages) => {
      const evaluation = evaluateNativePaginationWorkload(
        passingResult(targetPages),
      );

      expect(evaluation.passed).toBe(true);
      expect(Object.values(evaluation.checks).every(Boolean)).toBe(true);
    },
  );

  it("rejects synthetic or unstable evidence at every native boundary", () => {
    const result = passingResult(10);
    result.authoredPages = 9;
    result.inputDurationsMs = [17, 33];
    result.maxPendingFrames = 2;
    result.readsDuringInput = 1;
    result.staleStableCommits = 1;
    result.duplicateStableEpochs = 1;
    result.referenceEntriesAfter = 1;
    result.fontFamilyAfter = result.fontFamilyBefore;
    result.scaleAfter = result.scaleBefore;
    result.operations.rapidTyping.paginationFrames = 9;
    result.operations.rapidTyping.stableCommits = 2;
    result.operations.deletion.fallbackCommits = 1;
    result.operations.referenceRefresh.settlementMs = 1_001;
    result.operations.fontChange.endEpoch = 4;
    result.operations.scaleResize.paginationFrames = 1;
    result.operations.scaleResize.endEpoch = 6;

    expect(evaluateNativePaginationWorkload(result)).toEqual({
      passed: false,
      checks: {
        exactAuthoredPageCount: false,
        authoredInputLatency: false,
        onePendingPaginationFrame: false,
        noSynchronousPaginationRead: false,
        boundedPaginationFrames: false,
        noStaleStableCommit: false,
        noVisibleOscillation: false,
        operationsSettledWithinBudget: false,
        stableOperationsCommittedOnce: false,
        noFallbackCommit: false,
        actualReferenceRefresh: false,
        actualSelectedFontChange: false,
        actualScaleResize: false,
        scaleResizeDidNotPaginate: false,
      },
    });
  });
});

describe("native condition settlement", () => {
  it("consumes one absolute deadline instead of resetting retry time", () => {
    expect(remainingNativeDeadlineMs(8_000, 1_250)).toBe(6_750);
    expect(remainingNativeDeadlineMs(8_000, 7_999)).toBe(1);
    expect(remainingNativeDeadlineMs(8_000, 8_001)).toBe(0);
  });

  it("waits by elapsed time instead of exhausting a fast frame count", async () => {
    let now = 0;
    let yields = 0;

    await expect(waitForNativeCondition(
      "production pagination",
      () => yields === 300,
      {
        timeoutMs: 100,
        now: () => now,
        yieldControl: () => {
          yields += 1;
          now += 0.1;
          return Promise.resolve();
        },
      },
    )).resolves.toBe(300);
  });

  it("fails closed when the elapsed-time budget expires", async () => {
    let now = 0;

    await expect(waitForNativeCondition(
      "stalled pagination",
      () => false,
      {
        timeoutMs: 5,
        now: () => now,
        yieldControl: () => {
          now += 2;
          return Promise.resolve();
        },
      },
    )).rejects.toThrow(
      "Timed out waiting for stalled pagination after 5ms",
    );
  });
});

describe("live editor and Paged.js geometry evidence", () => {
  it("accepts matching canonical Letter geometry and selected Georgia type", () => {
    expect(
      evaluateLivePagedGeometry({
        livePageWidth: 816,
        livePageMinHeight: 1056,
        livePaddingTop: 96,
        livePaddingRight: 96,
        livePaddingBottom: 96,
        livePaddingLeft: 96,
        livePrintableWidth: 624,
        livePrintableHeight: 864,
        previewPageWidth: 816,
        previewPageHeight: 1056,
        previewMarginTop: 96,
        previewMarginLeft: 96,
        previewPrintableWidth: 624,
        previewPrintableHeight: 864,
        expectedFontFamily: "Georgia",
        expectedFontSizePt: 11,
        liveFontFamily: "Georgia, Times New Roman, serif",
        previewFontFamily: "Georgia, Times New Roman, serif",
        liveFontSize: 14.6667,
        previewFontSize: 14.6667,
        liveLineHeight: 29.3334,
        previewLineHeight: 29.3334,
      }).passed,
    ).toBe(true);
  });

  it("accepts matching canonical Times New Roman 12 type", () => {
    expect(
      evaluateLivePagedGeometry({
        livePageWidth: 816,
        livePageMinHeight: 1056,
        livePaddingTop: 96,
        livePaddingRight: 96,
        livePaddingBottom: 96,
        livePaddingLeft: 96,
        livePrintableWidth: 624,
        livePrintableHeight: 864,
        previewPageWidth: 816,
        previewPageHeight: 1056,
        previewMarginTop: 96,
        previewMarginLeft: 96,
        previewPrintableWidth: 624,
        previewPrintableHeight: 864,
        expectedFontFamily: "Times New Roman",
        expectedFontSizePt: 12,
        liveFontFamily: "Times New Roman, Times, Georgia, serif",
        previewFontFamily: "Times New Roman, Times, Georgia, serif",
        liveFontSize: 16,
        previewFontSize: 16,
        liveLineHeight: 32,
        previewLineHeight: 32,
      }).passed,
    ).toBe(true);
  });

  it("rejects the wrong selected font or either renderer's geometry drift", () => {
    const evaluation = evaluateLivePagedGeometry({
      livePageWidth: 815,
      livePageMinHeight: 1055,
      livePaddingTop: 95,
      livePaddingRight: 96,
      livePaddingBottom: 96,
      livePaddingLeft: 96,
      livePrintableWidth: 623,
      livePrintableHeight: 863,
      previewPageWidth: 817,
      previewPageHeight: 1057,
      previewMarginTop: 95,
      previewMarginLeft: 97,
      previewPrintableWidth: 625,
      previewPrintableHeight: 865,
      expectedFontFamily: "Georgia",
      expectedFontSizePt: 11,
      liveFontFamily: "Times New Roman",
      previewFontFamily: "Times New Roman",
      liveFontSize: 16,
      previewFontSize: 16,
      liveLineHeight: 32,
      previewLineHeight: 32,
    });

    expect(evaluation).toEqual({
      passed: false,
      checks: {
        liveLetterPage: false,
        liveOneInchPadding: false,
        livePrintableArea: false,
        previewLetterPage: false,
        previewOneInchMargin: false,
        previewPrintableArea: false,
        rendererGeometryParity: false,
        selectedCanonicalFont: false,
        doubleSpacing: false,
        rendererTypeParity: true,
      },
    });
  });
});

import { PAGINATION_RESPONSIVENESS_BUDGET } from "../performanceBudget.ts";

export type NativePaginationWorkloadPages = 10 | 25 | 50;

export type NativePaginationOperationName =
  | "rapidTyping"
  | "deletion"
  | "referenceRefresh"
  | "fontChange"
  | "scaleResize";

export interface NativePaginationOperationResult {
  settlementMs: number;
  paginationFrames: number;
  stableCommits: number;
  fallbackCommits: number;
  startEpoch: number;
  endEpoch: number;
}

export interface NativePaginationWorkloadResult {
  targetPages: NativePaginationWorkloadPages;
  authoredPages: number;
  inputDurationsMs: number[];
  maxPendingFrames: number;
  readsDuringInput: number;
  staleStableCommits: number;
  duplicateStableEpochs: number;
  referenceEntriesBefore: number;
  referenceEntriesAfter: number;
  fontFamilyBefore: string;
  fontFamilyAfter: string;
  scaleBefore: number;
  scaleAfter: number;
  operations: Record<
    NativePaginationOperationName,
    NativePaginationOperationResult
  >;
}

export interface NativePaginationWorkloadEvaluation {
  passed: boolean;
  checks: Record<
    | "exactAuthoredPageCount"
    | "authoredInputLatency"
    | "onePendingPaginationFrame"
    | "noSynchronousPaginationRead"
    | "boundedPaginationFrames"
    | "noStaleStableCommit"
    | "noVisibleOscillation"
    | "operationsSettledWithinBudget"
    | "stableOperationsCommittedOnce"
    | "noFallbackCommit"
    | "actualReferenceRefresh"
    | "actualSelectedFontChange"
    | "actualScaleResize"
    | "scaleResizeDidNotPaginate",
    boolean
  >;
}

export interface LivePagedGeometryResult {
  livePageWidth: number;
  livePageMinHeight: number;
  livePaddingTop: number;
  livePaddingRight: number;
  livePaddingBottom: number;
  livePaddingLeft: number;
  livePrintableWidth: number;
  livePrintableHeight: number;
  previewPageWidth: number;
  previewPageHeight: number;
  previewMarginTop: number;
  previewMarginLeft: number;
  previewPrintableWidth: number;
  previewPrintableHeight: number;
  expectedFontFamily: string;
  expectedFontSizePt: number;
  liveFontFamily: string;
  previewFontFamily: string;
  liveFontSize: number;
  previewFontSize: number;
  liveLineHeight: number;
  previewLineHeight: number;
}

function near(value: number, expected: number, tolerance = 0.5): boolean {
  return Math.abs(value - expected) < tolerance;
}

export function evaluateLivePagedGeometry(result: LivePagedGeometryResult) {
  const expectedFontSizePx = result.expectedFontSizePt * 96 / 72;
  const expectedLineHeightPx = expectedFontSizePx * 2;
  const checks = {
    liveLetterPage: near(result.livePageWidth, 816) &&
      near(result.livePageMinHeight, 1056),
    liveOneInchPadding: [
      result.livePaddingTop,
      result.livePaddingRight,
      result.livePaddingBottom,
      result.livePaddingLeft,
    ].every((value) => near(value, 96)),
    livePrintableArea: near(result.livePrintableWidth, 624) &&
      near(result.livePrintableHeight, 864),
    previewLetterPage: near(result.previewPageWidth, 816) &&
      near(result.previewPageHeight, 1056),
    previewOneInchMargin: near(result.previewMarginTop, 96) &&
      near(result.previewMarginLeft, 96),
    previewPrintableArea: near(result.previewPrintableWidth, 624) &&
      near(result.previewPrintableHeight, 864),
    rendererGeometryParity:
      near(result.livePageWidth, result.previewPageWidth) &&
      near(result.livePageMinHeight, result.previewPageHeight) &&
      near(result.livePaddingTop, result.previewMarginTop) &&
      near(result.livePaddingLeft, result.previewMarginLeft) &&
      near(result.livePrintableWidth, result.previewPrintableWidth) &&
      near(result.livePrintableHeight, result.previewPrintableHeight),
    selectedCanonicalFont:
      result.liveFontFamily.includes(result.expectedFontFamily) &&
      result.previewFontFamily.includes(result.expectedFontFamily) &&
      near(result.liveFontSize, expectedFontSizePx) &&
      near(result.previewFontSize, expectedFontSizePx),
    doubleSpacing: near(result.liveLineHeight, expectedLineHeightPx) &&
      near(result.previewLineHeight, expectedLineHeightPx),
    rendererTypeParity: near(result.liveFontSize, result.previewFontSize) &&
      near(result.liveLineHeight, result.previewLineHeight) &&
      result.liveFontFamily === result.previewFontFamily,
  };
  return { passed: Object.values(checks).every(Boolean), checks };
}

export function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

export function evaluateNativePaginationWorkload(
  result: NativePaginationWorkloadResult,
): NativePaginationWorkloadEvaluation {
  const budget = PAGINATION_RESPONSIVENESS_BUDGET.workloads[result.targetPages];
  const stableOperationNames = [
    "rapidTyping",
    "deletion",
    "referenceRefresh",
    "fontChange",
  ] as const;
  const stableOperations = stableOperationNames.map((name) =>
    result.operations[name]
  );
  const allOperations = Object.values(result.operations);
  const maxInput = Math.max(0, ...result.inputDurationsMs);
  const checks = {
    exactAuthoredPageCount: result.authoredPages === result.targetPages,
    authoredInputLatency: percentile95(result.inputDurationsMs) <=
        PAGINATION_RESPONSIVENESS_BUDGET.inputP95Ms &&
      maxInput <= PAGINATION_RESPONSIVENESS_BUDGET.inputMaxMs,
    onePendingPaginationFrame: result.maxPendingFrames <= 1,
    noSynchronousPaginationRead: result.readsDuringInput === 0,
    boundedPaginationFrames: allOperations.every((operation) =>
      operation.paginationFrames <=
        PAGINATION_RESPONSIVENESS_BUDGET.maxFramesPerEpoch
    ),
    noStaleStableCommit: result.staleStableCommits === 0,
    noVisibleOscillation: result.duplicateStableEpochs === 0,
    operationsSettledWithinBudget:
      result.operations.rapidTyping.settlementMs <= budget.typingDeletionMs &&
      result.operations.deletion.settlementMs <= budget.typingDeletionMs &&
      result.operations.referenceRefresh.settlementMs <=
        budget.referenceFontMs &&
      result.operations.fontChange.settlementMs <= budget.referenceFontMs &&
      result.operations.scaleResize.settlementMs <= budget.resizeMs,
    stableOperationsCommittedOnce: stableOperations.every((operation) =>
      operation.stableCommits === 1 &&
      operation.startEpoch === operation.endEpoch
    ),
    noFallbackCommit: allOperations.every((operation) =>
      operation.fallbackCommits === 0
    ),
    actualReferenceRefresh:
      result.referenceEntriesAfter > result.referenceEntriesBefore,
    actualSelectedFontChange:
      result.fontFamilyAfter !== result.fontFamilyBefore,
    actualScaleResize: result.scaleAfter !== result.scaleBefore,
    scaleResizeDidNotPaginate:
      result.operations.scaleResize.paginationFrames === 0 &&
      result.operations.scaleResize.stableCommits === 0 &&
      result.operations.scaleResize.startEpoch ===
        result.operations.scaleResize.endEpoch,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
  };
}

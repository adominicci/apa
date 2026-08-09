import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = await readFile(
  resolve(import.meta.dirname!, "nativeProof.ts"),
  "utf8",
);
const proofCss = await readFile(
  resolve(import.meta.dirname!, "nativeProof.css"),
  "utf8",
);
const capture = source.slice(
  source.indexOf("async function captureNativePaginationOperation"),
  source.indexOf("function workloadParagraphText"),
);
const workload = source.slice(
  source.indexOf("async function runNativePerformanceWorkload"),
  source.indexOf("function domSelectionPosition"),
);
const rapidTyping = workload.slice(
  workload.indexOf("const inputDurationsMs"),
  workload.indexOf("const deletion ="),
);
const scaleResize = workload.slice(
  workload.indexOf("const resizeReportIndex"),
  workload.indexOf("const capturedOperations"),
);
const firstPaint = source.slice(
  source.indexOf("const lineGap = requireElement<HTMLElement>("),
  source.indexOf("const beforeCaret = editor.view.coordsAtPos(lineGapPos - 1)"),
);
const paintedBandOracle = source.slice(
  source.indexOf("function capturePaintedBandGeometry"),
  source.indexOf("interface LayoutSnapshot"),
);
const parityCapture = source.slice(
  source.indexOf("const captureParity = async"),
  source.indexOf("const timesParity = await captureParity"),
);

describe("native performance harness wiring", () => {
  it("waits for an idle stable barrier inside measured operations", () => {
    expect(capture).toContain("waitForNativeQuiescence(");
    expect(capture).toContain("remainingNativeDeadlineMs(deadline)");
    expect(capture).toContain(
      'diagnostic("native-performance-operation-complete"',
    );
    expect(workload).toContain("inputP95Ms: percentile95(inputDurationsMs)");
    expect(workload).toContain("inputMaxMs: Math.max(0, ...inputDurationsMs)");
  });

  it("measures only synchronous reads for typing and deletion", () => {
    expect(rapidTyping).toContain("captureSynchronousNativeMutation(");
    expect(rapidTyping).not.toContain("const readsBeforeInput");
    expect(workload.match(/captureSynchronousNativeMutation\(/g)).toHaveLength(
      2,
    );
  });

  it("settles transformed geometry without hidden pagination work", () => {
    expect(scaleResize).toContain("waitForNativeQuiescence(");
    expect(scaleResize).not.toMatch(
      /await frame\(\);\s*await frame\(\);\s*await frame\(\);/,
    );
  });

  it("uses only positive painted marker rectangles and samples every stable state", () => {
    expect(paintedBandOracle).toContain("[data-pagination-canvas-gap]");
    expect(paintedBandOracle).toContain("clipPaintedCanvasRectToRoot");
    expect(paintedBandOracle).toContain("misalignedMarkerCount");
    expect(source).toContain("function expectedPaintedBandCount");
    expect(source).toContain("[data-reference-page-gap]");
    expect(source.match(/expectedPaintedBandCount\(/g)?.length).toBeGreaterThan(
      4,
    );
    expect(paintedBandOracle).toContain("markerCount !== derivedGapCount");
    expect(paintedBandOracle).toContain("markerCount === 0");
    expect(paintedBandOracle).not.toContain(
      'querySelectorAll<HTMLElement>("[data-pagination-gap]")',
    );
    expect(paintedBandOracle).toContain("marker.getBoundingClientRect()");
    expect(paintedBandOracle).toMatch(
      /clipPaintedCanvasRectToRoot\(rect, rootRect\)/,
    );
    expect(workload).toContain("capturePaintedBandGeometry(");
    for (
      const label of [
        "initial settlement",
        "calibration settlement",
        "final calibrated state",
        "rapid typing",
        "deletion",
        "reference refresh",
        "font change",
        "scale resize",
      ]
    ) {
      expect(workload).toMatch(
        new RegExp(`captureWorkloadPaintedBand\\(\\s*\"${label}\"`),
      );
    }
    expect(source).toContain("production initial stable painted band");
    expect(source).toContain("production scaled stable painted band");
    expect(source).toContain("Times stable painted band");
    expect(source).toContain("Georgia stable painted band");
    expect(paintedBandOracle).toContain("authoredTextRects.length === 0");
  });

  it("samples production and parity only from the current quiescent stable epoch", () => {
    expect(source).toContain(
      "async function waitForCurrentStableNativeReport",
    );
    expect(source.match(/await waitForCurrentStableNativeReport\(/g))
      .toHaveLength(3);
    expect(parityCapture).toContain("await waitForCurrentStableNativeReport(");
  });

  it("measures the full-canvas first paint from its marker, not the narrow spacer", () => {
    expect(firstPaint).toContain(
      "const lineGapCanvas = requireElement<HTMLElement>(",
    );
    expect(firstPaint).toContain(
      "\"[data-pagination-proof-gap='line'] [data-pagination-canvas-gap]\"",
    );
    expect(source).toMatch(
      /firstPlannedGap\.height >= 179 &&\s+firstPlannedCanvas\.width >= 815/,
    );
  });

  it("compares overflow table cells with the scrollbar-free client width", () => {
    expect(source).toContain(
      "const productionRowClientWidth = productionRowOverflow.clientWidth;",
    );
    expect(source).toMatch(
      /productionRowCellWidths\.reduce\([\s\S]*?-\s+productionRowClientWidth/,
    );
    expect(source).toContain("plannedRowOverflow.maxHeight");
    expect(source).toMatch(
      /productionRowRect\.height\s*<=\s*plannedRowOverflow\.maxHeight\s*\+\s*0\.5/,
    );
  });

  it("proves oversized references stay bounded and fully reachable", () => {
    expect(source).toContain("productionReferenceOverflowGeometry");
    expect(source).toContain(
      '[data-reference-overflow="true"]',
    );
    expect(source).toMatch(
      /productionReferenceOverflowScrollHeight\s*>\s*productionReferenceOverflowClientHeight/,
    );
    expect(source).toContain("productionReferenceOverflowContentReachable");
    expect(source).toMatch(
      /productionReferenceOverflowGeometry:\s*productionReferenceOverflow\.passed/,
    );
  });

  it("preserves only the final stable parity editor for an opt-in visual sweep", () => {
    expect(source).toMatch(
      /const preserveStableEditor\s*=\s*new URLSearchParams\(location\.search\)\.get\("inspect"\) === "1";/,
    );
    expect(source).toContain("pendingParityEditor = parityEditor;");
    expect(source).toContain(
      'document.body.dataset["stablePaginationInspection"] = "ready";',
    );
    expect(source).toContain(
      "settleStableInspectionEditor({",
    );
    expect(proofCss).toContain(
      'body[data-stable-pagination-inspection="ready"] #proof-result',
    );
  });
});

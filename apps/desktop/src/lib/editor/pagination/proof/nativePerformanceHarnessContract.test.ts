import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = await readFile(
  resolve(import.meta.dirname!, "nativeProof.ts"),
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
});

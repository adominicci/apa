import { describe, expect, it } from "vitest";
import { nativeWorkloadTrimPosition } from "./nativeWorkloadCalibration.ts";

describe("native workload calibration", () => {
  it("backs a line cutoff up to its containing authored paragraph", () => {
    expect(nativeWorkloadTrimPosition(22_216, [
      1,
      400,
      21_900,
      22_600,
    ])).toBe(21_900);
  });

  it("keeps an exact paragraph-boundary cutoff and fails safe without one", () => {
    expect(nativeWorkloadTrimPosition(400, [1, 400, 800])).toBe(400);
    expect(nativeWorkloadTrimPosition(1, [2, 400])).toBe(1);
  });
});

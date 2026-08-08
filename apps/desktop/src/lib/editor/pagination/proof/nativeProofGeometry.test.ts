import { describe, expect, it } from "vitest";
import { inlineFlowVisualHeight } from "./nativeProofGeometry.ts";

describe("native proof geometry", () => {
  it("ignores Blink's zero-area terminal pseudo box when measuring a run-in flow", () => {
    const blinkRects = [
      { top: 111, width: 145, height: 17 },
      { top: 143, width: 213, height: 17 },
      { top: 111.25, width: 477, height: 17 },
      { top: 168, width: 624, height: 0 },
      { top: 168, width: 0, height: 17 },
    ];

    expect(inlineFlowVisualHeight(blinkRects, 32)).toBe(64);
  });

  it("keeps the same exact advance for WebKit-style positive-area line rects", () => {
    const webKitRects = [
      { top: 111, width: 145, height: 17 },
      { top: 111.25, width: 477, height: 17 },
      { top: 143, width: 213, height: 17 },
    ];

    expect(inlineFlowVisualHeight(webKitRects, 32)).toBe(64);
  });
});

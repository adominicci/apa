import { describe, expect, it } from "vitest";
import {
  authoredTextPaintedCanvasIntersections,
  inlineFlowVisualHeight,
} from "./nativeProofGeometry.ts";

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

  it("reports only positive-area authored text that intersects a painted canvas band", () => {
    const gaps = [{
      top: 100,
      right: 624,
      bottom: 320,
      left: 0,
      width: 624,
      height: 220,
    }];
    const textRects = [
      {
        top: 90,
        right: 180,
        bottom: 107,
        left: 0,
        width: 180,
        height: 17,
      },
      {
        top: 320,
        right: 220,
        bottom: 337,
        left: 0,
        width: 220,
        height: 17,
      },
      {
        top: 180,
        right: 0,
        bottom: 197,
        left: 0,
        width: 0,
        height: 17,
      },
    ];

    expect(authoredTextPaintedCanvasIntersections(textRects, gaps)).toEqual([{
      textRectIndex: 0,
      gapRectIndex: 0,
      overlapWidth: 180,
      overlapHeight: 7,
    }]);
  });

  it("uses the actual painted canvas rectangle rather than its spacer parent", () => {
    const authoredText = [{
      top: 1_056,
      right: 240,
      bottom: 1_073,
      left: 0,
      width: 240,
      height: 17,
    }];
    const spacerParent = [{
      top: 800,
      right: 624,
      bottom: 1_000,
      left: 0,
      width: 624,
      height: 200,
    }];
    const paintedCanvasBand = [{
      top: 1_050,
      right: 816,
      bottom: 1_078,
      left: -96,
      width: 816,
      height: 28,
    }];

    expect(authoredTextPaintedCanvasIntersections(authoredText, spacerParent))
      .toEqual([]);
    expect(
      authoredTextPaintedCanvasIntersections(authoredText, paintedCanvasBand),
    ).toEqual([{
      textRectIndex: 0,
      gapRectIndex: 0,
      overlapWidth: 240,
      overlapHeight: 17,
    }]);
  });
});

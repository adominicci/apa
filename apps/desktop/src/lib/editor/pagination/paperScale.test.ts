// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  calculatePaperScale,
  observePaperScale,
  type PaperScaleLayout,
} from "./paperScale.ts";

describe("calculatePaperScale", () => {
  it("keeps canonical layout width and does not upscale a wide canvas", () => {
    expect(calculatePaperScale(1200, 2112)).toEqual({
      layoutWidth: 816,
      scale: 1,
      outerWidth: 816,
      outerHeight: 2112,
    });
  });

  it("scales a narrow canvas visually and compensates both outer dimensions", () => {
    expect(calculatePaperScale(408, 2112)).toEqual({
      layoutWidth: 816,
      scale: 0.5,
      outerWidth: 408,
      outerHeight: 1056,
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "keeps a safe unscaled layout for invalid available width %s",
    (availableWidth) => {
      expect(calculatePaperScale(availableWidth, 1056)).toEqual({
        layoutWidth: 816,
        scale: 1,
        outerWidth: 816,
        outerHeight: 1056,
      });
    },
  );

  it("normalizes an invalid stack height without changing the scale input", () => {
    expect(calculatePaperScale(612, Number.NaN)).toEqual({
      layoutWidth: 816,
      scale: 0.75,
      outerWidth: 612,
      outerHeight: 0,
    });
  });
});

describe("observePaperScale", () => {
  it("observes viewport width and untransformed stack height independently", () => {
    const viewport = document.createElement("div");
    const stack = document.createElement("div");
    let availableWidth = 408;
    let stackHeight = 2112;
    Object.defineProperty(viewport, "clientWidth", {
      configurable: true,
      get: () => availableWidth,
    });
    Object.defineProperty(stack, "scrollHeight", {
      configurable: true,
      get: () => stackHeight,
    });
    const observed: Element[] = [];
    let notify!: () => void;
    let disconnected = false;
    const layouts: PaperScaleLayout[] = [];

    const cleanup = observePaperScale(viewport, stack, (layout) => {
      layouts.push(layout);
    }, (callback) => {
      notify = callback;
      return {
        observe: (element) => observed.push(element),
        disconnect: () => disconnected = true,
      };
    });

    expect(observed).toEqual([viewport, stack]);
    expect(layouts).toEqual([{
      layoutWidth: 816,
      scale: 0.5,
      outerWidth: 408,
      outerHeight: 1056,
    }]);

    stackHeight = 3168;
    notify();
    expect(layouts.at(-1)).toEqual({
      layoutWidth: 816,
      scale: 0.5,
      outerWidth: 408,
      outerHeight: 1584,
    });

    availableWidth = 1020;
    notify();
    expect(layouts.at(-1)).toEqual({
      layoutWidth: 816,
      scale: 1,
      outerWidth: 816,
      outerHeight: 3168,
    });

    cleanup();
    expect(disconnected).toBe(true);
  });
});

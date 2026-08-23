// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { titleOffsetAtPointer } from "./titlePointer";

describe("paper-title pointer mapping", () => {
  it("uses rendered pointer coordinates rather than the existing selection", () => {
    const input = document.createElement("input");
    input.value = "Wrng title";
    input.setSelectionRange(2, 2);
    input.getBoundingClientRect = () =>
      new DOMRect(100, 20, 200, 24) as DOMRect;
    const measure = (text: string) => text.length * 10;
    expect(titleOffsetAtPointer(input, {
      clientX: 180,
      clientY: 30,
    }, measure)).toBe(8);
    expect(input.selectionStart).toBe(2);
  });

  it("returns the half-open issue boundary at the rendered end coordinate", () => {
    const input = document.createElement("input");
    input.value = "Wrng title";
    input.getBoundingClientRect = () =>
      new DOMRect(100, 20, 200, 24) as DOMRect;
    expect(titleOffsetAtPointer(input, {
      clientX: 140,
      clientY: 30,
    }, (text) => text.length * 10)).toBe(4);
  });
});

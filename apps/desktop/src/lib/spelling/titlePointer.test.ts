// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { titleOffsetAtPointer } from "./titlePointer";

describe("paper-title pointer mapping", () => {
  it.each([
    [0.5, 100],
    [2, 400],
  ])(
    "maps the exact half-open end through an ancestor scale of %s",
    (scale, renderedWidth) => {
      const input = document.createElement("input");
      input.style.border = "0";
      input.style.padding = "0";
      input.value = "Wrng title";
      Object.defineProperty(input, "offsetWidth", { value: 200 });
      input.getBoundingClientRect = () =>
        new DOMRect(100, 20, renderedWidth, 24 * scale);
      expect(titleOffsetAtPointer(input, {
        clientX: 100 + 40 * scale,
        clientY: 20 + 12 * scale,
      }, (text) => text.length * 10)).toBe(4);
    },
  );

  it("uses scale one for the untransformed modal title input", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const input = document.createElement("input");
    input.style.border = "0";
    input.style.padding = "0";
    input.value = "Wrng title";
    Object.defineProperty(input, "offsetWidth", { value: 200 });
    input.getBoundingClientRect = () => new DOMRect(100, 20, 200, 24);
    dialog.append(input);
    document.body.append(dialog);
    expect(titleOffsetAtPointer(input, {
      clientX: 140,
      clientY: 32,
    }, (text) => text.length * 10)).toBe(4);
  });

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

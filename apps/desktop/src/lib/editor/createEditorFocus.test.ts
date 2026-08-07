// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createTesinaEditor } from "./createEditor.ts";

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const content = {
  type: "doc",
  content: [{
    type: "sectionBody",
    content: [{
      type: "paragraph",
      content: [{ type: "text", text: "Start writing here" }],
    }],
  }],
};

function createEditor(newlyCreated: boolean) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = createTesinaEditor({
    element,
    content,
    newlyCreated,
    citationEnv: { refsById: new Map(), locale: "en" },
    referenceEnv: {
      references: [],
      locale: "en",
      emptyLabel: "No references yet",
    },
  });
  return { editor, element };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("editor focus for a paper launch", () => {
  it("leaves a newly created paper unfocused at the start", () => {
    vi.useFakeTimers();
    const { editor, element } = createEditor(true);

    vi.runAllTimers();

    expect(editor.isFocused).toBe(false);
    expect(element.querySelector(".ProseMirror-focused")).toBeNull();
    expect(editor.state.selection.from).toBe(2);
    editor.destroy();
  });

  it("keeps the existing-paper focus-at-end behavior", () => {
    vi.useFakeTimers();
    const { editor, element } = createEditor(false);

    vi.runAllTimers();

    expect(editor.isFocused).toBe(true);
    expect(element.querySelector(".ProseMirror-focused")).not.toBeNull();
    expect(editor.state.selection.from).toBe(20);
    editor.destroy();
  });
});

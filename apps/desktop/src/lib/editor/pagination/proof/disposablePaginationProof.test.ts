// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { createTesinaEditor } from "../../createEditor.ts";
import { createLongDocumentFixtures } from "./longDocumentFixture.ts";
import {
  createDisposablePaginationProofPlugin,
  setDisposablePaginationProofPlan,
} from "./disposablePaginationProof.ts";

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

function positionOfText(doc: PMNode, needle: string): number {
  let result = -1;
  doc.descendants((node, pos) => {
    if (result >= 0) return false;
    if (node.isText && node.text?.includes(needle)) {
      result = pos + (node.text.indexOf(needle) || 1);
      return false;
    }
    return true;
  });
  if (result < 0) throw new Error(`Missing proof text: ${needle}`);
  return result;
}

function positionsOf(doc: PMNode, type: string): number[] {
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === type) positions.push(pos);
    return true;
  });
  return positions;
}

function createProofEditor(): { editor: Editor; element: HTMLElement } {
  const fixture = createLongDocumentFixtures().en;
  const element = document.createElement("div");
  document.body.append(element);
  const editor = createTesinaEditor({
    element,
    content: fixture.content,
    newlyCreated: true,
    citationEnv: {
      refsById: new Map(fixture.references.map((ref) => [ref.id, ref])),
      locale: "en",
    },
    referenceEnv: {
      references: fixture.references,
      locale: "en",
      emptyLabel: "unused",
    },
  });
  editor.registerPlugin(createDisposablePaginationProofPlugin());
  return { editor, element };
}

afterEach(() => document.body.replaceChildren());

describe("disposable derived-pagination proof extension", () => {
  it("adds a line gap inside one paragraph without changing JSON or fragmenting the EditorView", () => {
    const { editor, element } = createProofEditor();
    try {
      const before = JSON.stringify(editor.getJSON());
      const gapPos = positionOfText(editor.state.doc, "simulated round") + 10;

      setDisposablePaginationProofPlan(editor, {
        epoch: 1,
        gaps: [{ kind: "line", pos: gapPos, height: 180 }],
      });

      expect(element.querySelectorAll(".ProseMirror")).toHaveLength(1);
      const lineGap = element.querySelector<HTMLElement>(
        "[data-pagination-proof-gap='line']",
      );
      expect(lineGap).not.toBeNull();
      expect(lineGap?.style.display).toBe("inline-block");
      expect(JSON.stringify(editor.getJSON())).toBe(before);

      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, gapPos - 3, gapPos + 3),
        ),
      );
      expect(editor.state.selection.from).toBe(gapPos - 3);
      expect(editor.state.selection.to).toBe(gapPos + 3);
    } finally {
      editor.destroy();
    }
  });

  it("keeps pagination transactions out of the one-step authored undo", () => {
    const { editor } = createProofEditor();
    try {
      const before = JSON.stringify(editor.getJSON());
      const editPos = positionOfText(editor.state.doc, "Invented paragraph 1") +
        1;
      editor.view.dispatch(editor.state.tr.insertText("X", editPos));
      expect(JSON.stringify(editor.getJSON())).not.toBe(before);

      setDisposablePaginationProofPlan(editor, {
        epoch: 2,
        gaps: [{ kind: "line", pos: editPos + 2, height: 180 }],
      });
      expect(editor.commands.undo()).toBe(true);
      expect(JSON.stringify(editor.getJSON())).toBe(before);
    } finally {
      editor.destroy();
    }
  });

  it("places a valid gap row between authored table rows", () => {
    const { editor, element } = createProofEditor();
    try {
      const rowPositions = positionsOf(editor.state.doc, "tableRow");
      expect(rowPositions.length).toBeGreaterThan(2);

      setDisposablePaginationProofPlan(editor, {
        epoch: 3,
        gaps: [{
          kind: "tableRow",
          pos: rowPositions[2]!,
          height: 180,
          columns: 3,
        }],
      });

      const gapRow = element.querySelector<HTMLTableRowElement>(
        "tr[data-pagination-proof-gap='tableRow']",
      );
      expect(gapRow?.parentElement?.tagName).toBe("TBODY");
      expect(gapRow?.cells).toHaveLength(1);
      expect(gapRow?.cells[0]?.colSpan).toBe(3);
      expect(gapRow?.contentEditable).toBe("false");
      expect(gapRow?.getAttribute("aria-hidden")).toBe("true");
    } finally {
      editor.destroy();
    }
  });

  it("moves an atomic figure as one DOM unit and removes a trailing gap deterministically", () => {
    const { editor, element } = createProofEditor();
    try {
      const before = JSON.stringify(editor.getJSON());
      const figurePos = positionsOf(editor.state.doc, "figure")[0]!;
      setDisposablePaginationProofPlan(editor, {
        epoch: 4,
        gaps: [{ kind: "block", pos: figurePos, height: 180 }],
      });

      const gap = element.querySelector("[data-pagination-proof-gap='block']");
      const figure = element.querySelector("[data-apa-figure]");
      expect(gap?.nextElementSibling).toBe(figure);
      expect(figure?.querySelectorAll(".fig-img")).toHaveLength(1);
      expect(figure?.querySelectorAll("[data-figure-title]")).toHaveLength(1);
      expect(figure?.querySelectorAll("[data-figure-note]")).toHaveLength(1);

      setDisposablePaginationProofPlan(editor, { epoch: 5, gaps: [] });
      expect(element.querySelector("[data-pagination-proof-gap]")).toBeNull();
      expect(JSON.stringify(editor.getJSON())).toBe(before);
    } finally {
      editor.destroy();
    }
  });
});

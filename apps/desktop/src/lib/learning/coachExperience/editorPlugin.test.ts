// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { TextSelection } from "@tiptap/pm/state";
import { undoDepth } from "@tiptap/pm/history";
import { NODE_NAMES } from "@tesina/engine";
import { createTesinaEditor } from "$lib/editor/createEditor.ts";
import { refreshCitations } from "$lib/editor/citation.ts";
import { analyzeCoachPassages } from "./analysisAdapter.ts";
import type { CoachEditorBridge, CoachEditorHandle } from "./editorPlugin.ts";

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

function createHarness(text: string) {
  const element = document.createElement("div");
  document.body.append(element);
  let handle: CoachEditorHandle | null = null;
  const transactions: Parameters<
    NonNullable<CoachEditorBridge["onTransaction"]>
  >[0][] = [];
  const bridge: CoachEditorBridge = {
    currentRevision: () => 1,
    attach: (next) => {
      handle = next;
    },
    onTransaction: (event) => transactions.push(event),
  };
  const editor = createTesinaEditor({
    element,
    content: {
      type: "doc",
      content: [{
        type: NODE_NAMES.sectionBody,
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      }],
    },
    newlyCreated: false,
    citationEnv: { refsById: new Map(), locale: "en" },
    referenceEnv: { references: [], locale: "en", emptyLabel: "None" },
    paginationEnv: null,
    coachBridge: bridge,
  });
  if (!handle) throw new Error("coach editor bridge was not attached");
  return { editor, element, handle: handle as CoachEditorHandle, transactions };
}

afterEach(() => document.body.replaceChildren());

describe("schema-free coach editor bridge", () => {
  it("captures exact passages and reports document and external citation transactions", () => {
    const { editor, handle, transactions } = createHarness(
      "The policy changed in many ways during review.",
    );
    const beforeSchema = Object.keys(editor.schema.nodes);
    const snapshot = handle.capture("essay-1");
    expect(snapshot.passages.map((passage) => passage.text)).toEqual([
      "The policy changed in many ways during review.",
    ]);
    expect(snapshot.revision).toBe(1);
    expect(snapshot.citationEnvironmentVersion).toBe(0);
    editor.commands.insertContentAt(2, "Earlier ");
    refreshCitations(editor);
    expect(transactions.some((event) => event.docChanged)).toBe(true);
    expect(transactions.some((event) => event.externalCitationRefresh)).toBe(
      true,
    );
    expect(Object.keys(editor.schema.nodes)).toEqual(beforeSchema);
    editor.destroy();
  });

  it("selects only an exact current repeated range without content or history mutation", () => {
    const { editor, handle } = createHarness(
      "The policy changed in many ways, while the method changed in many ways.",
    );
    const baselineJson = JSON.stringify(editor.getJSON());
    const baselineUndo = undoDepth(editor.state);
    const analyzed = analyzeCoachPassages(
      handle.capture("essay-1").passages,
      1,
    );
    if (analyzed.status !== "available") throw new Error("expected analysis");
    const second = analyzed.issues.filter((item) =>
      item.issue.observedText === "in many ways"
    )[1]!;
    expect(handle.navigate(second)).toBe(true);
    expect(editor.state.selection).toMatchObject(second.editorRange);
    expect(JSON.stringify(editor.getJSON())).toBe(baselineJson);
    expect(undoDepth(editor.state)).toBe(baselineUndo);
    expect(handle.getHighlight()).toEqual(second.editorRange);
    editor.destroy();
  });

  it("fails stale navigation without guessing and clears emphasis on selection, edits, refresh, and teardown", () => {
    const { editor, handle } = createHarness(
      "The policy changed in many ways during review.",
    );
    const analyzed = analyzeCoachPassages(
      handle.capture("essay-1").passages,
      1,
    );
    if (analyzed.status !== "available") throw new Error("expected analysis");
    const issue = analyzed.issues[0]!;
    const selectionBefore = editor.state.selection;
    expect(handle.navigate({ ...issue, editorRange: { from: 30, to: 42 } }))
      .toBe(false);
    expect(editor.state.selection.eq(selectionBefore)).toBe(true);
    expect(handle.navigate(issue)).toBe(true);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)),
    );
    expect(handle.getHighlight()).toBeNull();
    expect(handle.navigate(issue)).toBe(true);
    editor.commands.insertContentAt(issue.editorRange.from, "x");
    expect(handle.getHighlight()).toBeNull();
    refreshCitations(editor);
    expect(handle.getHighlight()).toBeNull();
    const second = createHarness("Various aspects shaped the final review.");
    second.handle.clearHighlight();
    second.editor.destroy();
    expect(second.handle.getHighlight()).toBeNull();
    editor.destroy();
  });
});

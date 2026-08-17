// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { createTesinaEditor } from "./createEditor.ts";
import { deleteIssueRanges, type PositionedApaIssue } from "./apaCheck.ts";

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function docWith(...bodyChildren: unknown[]) {
  return {
    type: "doc",
    content: [{ type: "sectionBody", content: bodyChildren }],
  };
}

const text = (t: string) => [{ type: "text", text: t }];

function createEditor(content: unknown) {
  const element = document.createElement("div");
  document.body.append(element);
  let issues: PositionedApaIssue[] = [];
  let emissions = 0;
  const editor = createTesinaEditor({
    element,
    content,
    newlyCreated: false,
    citationEnv: { refsById: new Map(), locale: "en" },
    referenceEnv: { references: [], locale: "en", emptyLabel: "None" },
    paginationEnv: null,
    onApaIssues: (next) => {
      issues = next;
      emissions += 1;
    },
  });
  return { editor, element, issues: () => issues, emissions: () => emissions };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("apa check editor integration", () => {
  it("reports initial issues with real doc positions", async () => {
    const { editor, issues } = createEditor(docWith(
      { type: "paragraph", content: text("Hola") },
      { type: "paragraph" },
    ));
    await flush();
    expect(issues()).toHaveLength(1);
    const [issue] = issues();
    expect(issue.rule).toBe("empty-paragraph");
    const node = editor.state.doc.nodeAt(issue.from);
    expect(node?.type.name).toBe("paragraph");
    expect(node?.textContent).toBe("");
    expect(issue.to).toBe(issue.from + (node?.nodeSize ?? 0));
  });

  it("reports nothing for a clean document", async () => {
    const { issues } = createEditor(docWith(
      { type: "paragraph", content: text("Hola") },
    ));
    await flush();
    expect(issues()).toEqual([]);
  });

  it("re-reports when the document changes", async () => {
    const { editor, issues } = createEditor(docWith(
      { type: "paragraph", content: text("Hola") },
    ));
    await flush();
    const end = editor.state.doc.content.size - 1;
    editor.chain().insertContentAt(end, { type: "paragraph" }).run();
    await flush();
    expect(issues().map((i) => i.rule)).toEqual(["empty-paragraph"]);
  });

  it("tints flagged blocks with a node decoration", async () => {
    const { element } = createEditor(docWith(
      { type: "paragraph", content: text("Hola") },
      { type: "paragraph" },
    ));
    await flush();
    expect(element.querySelectorAll("p.apa-check-flag")).toHaveLength(1);
  });

  it("positions an empty table title inside its block", async () => {
    const { editor, issues } = createEditor(docWith(
      { type: "paragraph", content: text("Hola") },
      {
        type: "apaTable",
        content: [
          { type: "tableTitle" },
          {
            type: "table",
            content: [{
              type: "tableRow",
              content: [{
                type: "tableCell",
                content: [{ type: "paragraph", content: text("c") }],
              }],
            }],
          },
          { type: "tableNote" },
        ],
      },
    ));
    await flush();
    expect(issues().map((i) => i.rule)).toEqual(["empty-table-title"]);
    const node = editor.state.doc.nodeAt(issues()[0].from);
    expect(node?.type.name).toBe("tableTitle");
  });

  it("does not re-emit an unchanged issue list on plain typing", async () => {
    const { editor, emissions } = createEditor(docWith(
      { type: "paragraph", content: text("Hola") },
    ));
    await flush();
    const before = emissions();
    editor.chain().insertContentAt(2, "x").run();
    editor.chain().insertContentAt(3, "y").run();
    await flush();
    expect(emissions()).toBe(before);
  });

  it("re-emits when typing shifts the positions of existing issues", async () => {
    const { editor, issues } = createEditor(docWith(
      { type: "paragraph", content: text("Hola") },
      { type: "paragraph" },
    ));
    await flush();
    const originalFrom = issues()[0].from;
    editor.chain().insertContentAt(2, "xx").run();
    await flush();
    expect(issues()[0].from).toBe(originalFrom + 2);
  });

  it("deleteIssueRanges removes every flagged blank paragraph at once", async () => {
    const { editor, issues } = createEditor(docWith(
      { type: "paragraph" },
      { type: "paragraph", content: text("Hola") },
      { type: "paragraph" },
      { type: "paragraph" },
    ));
    await flush();
    expect(issues()).toHaveLength(3);
    deleteIssueRanges(editor, issues());
    await flush();
    expect(issues()).toEqual([]);
    expect(editor.state.doc.textContent).toContain("Hola");
  });
});

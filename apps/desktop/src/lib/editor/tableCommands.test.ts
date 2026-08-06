import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { sectionExtensions } from "./sections.ts";
import { OrderedListStyleAttr } from "./lists.ts";
import { blockExtensions, createApaEquationExtension } from "./blocks.ts";
import { apaTableRange } from "./tableCommands.ts";

// The real editor schema (minus the citation extension, which needs a live
// library env) so the test exercises the same node hierarchy the app uses.
const schema = getSchema([
  StarterKit.configure({
    document: false,
    heading: { levels: [1, 2, 3, 4, 5] },
    code: false,
    codeBlock: false,
    horizontalRule: false,
    strike: false,
  }),
  ...sectionExtensions,
  OrderedListStyleAttr,
  ...blockExtensions,
  createApaEquationExtension(() => {}),
]);

const para = (text: string) => ({
  type: "paragraph",
  content: text === "" ? [] : [{ type: "text", text }],
});

const docJson = {
  type: "doc",
  content: [
    {
      type: "sectionBody",
      content: [
        para("Antes de la tabla."),
        {
          type: "apaTable",
          content: [
            { type: "tableTitle", content: [{ type: "text", text: "Título" }] },
            {
              type: "table",
              content: [
                {
                  type: "tableRow",
                  content: [
                    { type: "tableHeader", content: [para("Col")] },
                    { type: "tableHeader", content: [para("Col")] },
                  ],
                },
                {
                  type: "tableRow",
                  content: [
                    { type: "tableCell", content: [para("celda")] },
                    { type: "tableCell", content: [para("")] },
                  ],
                },
              ],
            },
            { type: "tableNote", content: [{ type: "text", text: "Nota" }] },
          ],
        },
        para("Después de la tabla."),
      ],
    },
  ],
};

/** Position of the first text matching `needle`, in document order. */
function posOf(doc: PMNode, needle: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (node.isText && node.text?.includes(needle)) found = pos + 1;
    return found === -1;
  });
  if (found === -1) throw new Error(`text not found: ${needle}`);
  return found;
}

function countNodes(doc: PMNode, name: string): number {
  let n = 0;
  doc.descendants((node) => {
    if (node.type.name === name) n++;
    return true;
  });
  return n;
}

describe("apaTableRange", () => {
  it("spans the whole apaTable from a cursor inside a cell", () => {
    const doc = schema.nodeFromJSON(docJson);
    const $pos = doc.resolve(posOf(doc, "celda"));
    const range = apaTableRange($pos);
    expect(range).not.toBeNull();
    const node = doc.nodeAt(range!.from);
    expect(node?.type.name).toBe("apaTable");
    expect(range!.to - range!.from).toBe(node!.nodeSize);
  });

  it("covers the node when the apaTable itself is node-selected", () => {
    const doc = schema.nodeFromJSON(docJson);
    // NodeSelection resolves before the node; find the apaTable's position.
    let tablePos = -1;
    doc.descendants((node, pos) => {
      if (node.type.name === "apaTable") tablePos = pos;
      return tablePos === -1;
    });
    const range = apaTableRange(doc.resolve(tablePos));
    expect(range).not.toBeNull();
    expect(range!.from).toBe(tablePos);
    expect(range!.to - range!.from).toBe(doc.nodeAt(tablePos)!.nodeSize);
  });

  it("returns null when the cursor is not inside a table", () => {
    const doc = schema.nodeFromJSON(docJson);
    const $pos = doc.resolve(posOf(doc, "Antes"));
    expect(apaTableRange($pos)).toBeNull();
  });

  it("deleting the range removes caption, grid, and note together", () => {
    const doc = schema.nodeFromJSON(docJson);
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, posOf(doc, "celda")),
    });
    const range = apaTableRange(state.selection.$from)!;
    const next = state.apply(state.tr.deleteRange(range.from, range.to));
    for (const name of ["apaTable", "table", "tableTitle", "tableNote"]) {
      expect(countNodes(next.doc, name)).toBe(0);
    }
    // Surrounding text is untouched.
    expect(next.doc.textContent).toContain("Antes de la tabla.");
    expect(next.doc.textContent).toContain("Después de la tabla.");
  });
});

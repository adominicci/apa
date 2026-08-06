import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { sectionExtensions } from "./sections.ts";
import { OrderedListStyleAttr } from "./lists.ts";
import { blockExtensions, createApaEquationExtension } from "./blocks.ts";

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
        para("Antes de la figura."),
        {
          type: "figure",
          content: [
            {
              type: "figureTitle",
              content: [{ type: "text", text: "Título" }],
            },
            { type: "figureImage", attrs: { src: "essays/assets/x.png" } },
            { type: "figureNote", content: [{ type: "text", text: "Nota" }] },
          ],
        },
        para("Después de la figura."),
      ],
    },
  ],
};

function countNodes(doc: PMNode, name: string): number {
  let n = 0;
  doc.descendants((node) => {
    if (node.type.name === name) n++;
    return true;
  });
  return n;
}

function figurePos(doc: PMNode): number {
  let pos = -1;
  doc.descendants((node, p) => {
    if (node.type.name === "figure") pos = p;
    return pos === -1;
  });
  if (pos === -1) throw new Error("figure not found");
  return pos;
}

describe("figure deletion", () => {
  it("deleting the node range removes title, image, and note together", () => {
    const doc = schema.nodeFromJSON(docJson);
    const pos = figurePos(doc);
    const node = doc.nodeAt(pos)!;
    const state = EditorState.create({ schema, doc });
    const next = state.apply(
      state.tr.deleteRange(pos, pos + node.nodeSize),
    );
    for (const name of ["figure", "figureTitle", "figureImage", "figureNote"]) {
      expect(countNodes(next.doc, name)).toBe(0);
    }
    // Surrounding text is untouched.
    expect(next.doc.textContent).toContain("Antes de la figura.");
    expect(next.doc.textContent).toContain("Después de la figura.");
  });

  it("keeps the required image node — it cannot be deleted on its own", () => {
    // The schema forces figureImage to exist, which is why the image is made
    // non-selectable and removal is whole-figure only.
    const doc = schema.nodeFromJSON(docJson);
    expect(schema.nodes["figureImage"].spec.selectable).toBe(false);
    expect(countNodes(doc, "figureImage")).toBe(1);
  });
});

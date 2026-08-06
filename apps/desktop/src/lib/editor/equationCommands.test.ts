import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Fragment } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { sectionExtensions } from "./sections.ts";
import { OrderedListStyleAttr } from "./lists.ts";
import {
  blockExtensions,
  canInsertApaEquation,
  createApaEquationExtension,
} from "./blocks.ts";

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

function stateAt(text: string, content: unknown[]): EditorState {
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [{ type: "sectionBody", content }],
  });
  let pos = -1;
  doc.descendants((node, nodePos) => {
    if (node.isText && node.text === text) pos = nodePos + 1;
    return pos === -1;
  });
  if (pos === -1) throw new Error(`text not found: ${text}`);
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, pos),
  });
}

function abstractState(): EditorState {
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [
      {
        type: "sectionAbstract",
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: "abstract" }],
        }],
      },
      { type: "sectionBody", content: [{ type: "paragraph" }] },
    ],
  });
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, 2),
  });
}

describe("canInsertApaEquation", () => {
  it("permits equations only in section schemas", () => {
    const equation = schema.nodes.apaEquation!.create({ latex: "x" });
    const paragraph = schema.nodes.paragraph!.create();
    expect(
      schema.nodes.sectionBody!.validContent(Fragment.from(equation)),
    ).toBe(true);
    expect(
      schema.nodes.sectionAppendix!.validContent(Fragment.from(equation)),
    ).toBe(true);
    expect(
      schema.nodes.blockquote!.validContent(Fragment.from(equation)),
    ).toBe(false);
    expect(
      schema.nodes.listItem!.validContent(Fragment.from([paragraph, equation])),
    ).toBe(false);
  });

  it("allows a top-level section paragraph", () => {
    const state = stateAt("top", [{
      type: "paragraph",
      content: [{ type: "text", text: "top" }],
    }]);
    expect(canInsertApaEquation(state)).toBe(true);
  });

  it("rejects a nonempty selection so insertion cannot replace content", () => {
    const state = stateAt("selected", [{
      type: "paragraph",
      content: [{ type: "text", text: "selected" }],
    }]);
    const selected = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 2, 5)),
    );
    expect(canInsertApaEquation(selected)).toBe(false);
  });

  it("rejects insertion in the abstract schema", () => {
    expect(canInsertApaEquation(abstractState())).toBe(false);
  });

  it.each([
    ["blockquote", {
      type: "blockquote",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "nested" }],
      }],
    }],
    ["list item", {
      type: "bulletList",
      content: [{
        type: "listItem",
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: "nested" }],
        }],
      }],
    }],
  ])("rejects insertion inside a %s", (_label, nested) => {
    expect(canInsertApaEquation(stateAt("nested", [nested]))).toBe(false);
  });
});

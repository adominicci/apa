// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Reference } from "@tesina/engine";
import { createTesinaEditor } from "./createEditor.ts";

const reference: Reference = {
  id: "ref-order",
  type: "book",
  authors: [{ kind: "person", family: "Rivera", given: "Ana" }],
  date: { year: 2024 },
  title: "Writing Clearly",
  publisher: "Island Press",
};

const docJson = {
  type: "doc",
  content: [
    {
      type: "sectionBody",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "Body text" }],
      }],
    },
    {
      type: "sectionAppendix",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "Appendix one" }],
      }],
    },
    {
      type: "sectionAppendix",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "Appendix two" }],
      }],
    },
  ],
};

function textPosition(doc: PMNode, needle: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (node.isText && node.text?.includes(needle)) {
      found = pos;
      return false;
    }
    return found === -1;
  });
  if (found === -1) throw new Error(`Text not found: ${needle}`);
  return found;
}

describe("live reference-page decoration", () => {
  it("orders derived references before appendices without changing or splitting the document", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const referenceEnv = {
      references: [reference],
      locale: "en" as const,
      emptyLabel: "No references yet",
    };
    const editor = createTesinaEditor(
      {
        element,
        content: docJson,
        citationEnv: {
          refsById: new Map([[reference.id, reference]]),
          locale: "en",
        },
        referenceEnv,
      } as Parameters<typeof createTesinaEditor>[0],
    );

    try {
      const root = element.querySelector(".tiptap");
      const order = [...(root?.children ?? [])].map((child) =>
        child.getAttribute("data-sec") ??
          child.getAttribute("data-reference-sheet")
      );

      expect(order).toEqual(["body", "references", "appendix", "appendix"]);
      expect(root?.querySelector("[data-reference-sheet='references']"))
        .toHaveProperty("contentEditable", "false");
      expect(root?.textContent).toContain("References");
      expect(root?.textContent).toContain("Rivera, A. (2024)");
      expect(editor.getJSON()).toEqual(docJson);

      referenceEnv.references = [];
      editor.view.dispatch(
        editor.state.tr.setMeta("apa:references-external", true),
      );
      expect(root?.textContent).toContain("No references yet");
      expect(root?.textContent).not.toContain("Rivera, A. (2024)");

      const appendixTwo = textPosition(editor.state.doc, "Appendix two");
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, appendixTwo),
        ).insertText("Edited "),
      );
      expect(editor.getText()).toContain("Edited Appendix two");
      expect(editor.getJSON()).not.toHaveProperty(
        "content.1.type",
        "references",
      );
    } finally {
      editor.destroy();
      element.remove();
    }
  });
});

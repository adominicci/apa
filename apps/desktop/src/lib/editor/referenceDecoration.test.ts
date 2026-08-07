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

const personalCommunication: Reference = {
  id: "ref-personal",
  type: "personalCommunication",
  authors: [{ kind: "person", family: "Salgado", given: "Nora" }],
  date: { year: 2026, month: 7, day: 3 },
  title: "Conversation about writing",
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
        newlyCreated: false,
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
      expect(
        [...(root?.querySelectorAll("[data-sec='appendix']") ?? [])].map(
          (appendix) => appendix.getAttribute("data-appendix-letter"),
        ),
      ).toEqual(["A", "B"]);
      expect(root?.querySelector("[data-reference-sheet='references']"))
        .toHaveProperty("contentEditable", "false");
      expect(root?.textContent).toContain("References");
      expect(root?.textContent).toContain("Rivera, A. (2024)");
      expect(editor.getJSON()).toEqual(docJson);

      referenceEnv.references = [];
      editor.view.dispatch(
        editor.state.tr.setMeta("apa:references-external", true),
      );
      expect(root?.querySelector("[data-reference-sheet='references']"))
        .toBeNull();
      expect(root?.textContent).not.toContain("No references yet");
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

  it("omits a personal-only references widget and filters personal entries from a mixed widget", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const referenceEnv = {
      references: [personalCommunication] as Reference[],
      locale: "en" as const,
      emptyLabel: "No references yet",
    };
    const editor = createTesinaEditor({
      element,
      content: docJson,
      newlyCreated: false,
      citationEnv: {
        refsById: new Map([[personalCommunication.id, personalCommunication]]),
        locale: "en",
      },
      referenceEnv,
    });

    try {
      const root = element.querySelector(".tiptap");
      expect(root?.querySelector("[data-reference-sheet='references']"))
        .toBeNull();
      expect(root?.textContent).not.toContain("References");

      referenceEnv.references = [personalCommunication, reference];
      editor.view.dispatch(
        editor.state.tr.setMeta("apa:references-external", true),
      );

      const page = root?.querySelector(
        "[data-reference-sheet='references']",
      );
      expect(page).not.toBeNull();
      expect(page?.textContent).toContain("Rivera, A. (2024)");
      expect(page?.textContent).not.toContain("Conversation about writing");
    } finally {
      editor.destroy();
      element.remove();
    }
  });

  it("decorates a lone appendix without a letter and run-in headings without storing presentation data", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const content = {
      type: "doc",
      content: [
        {
          type: "sectionBody",
          content: [
            {
              type: "heading",
              attrs: { level: 4 },
              content: [{ type: "text", text: "Authored period." }],
            },
            {
              type: "paragraph",
              content: [{ type: "text", text: "Level four continuation" }],
            },
            {
              type: "heading",
              attrs: { level: 5 },
              content: [{ type: "text", text: "Needs punctuation" }],
            },
            {
              type: "paragraph",
              content: [{ type: "text", text: "Level five continuation" }],
            },
          ],
        },
        {
          type: "sectionAppendix",
          content: [{
            type: "paragraph",
            content: [{ type: "text", text: "Only appendix" }],
          }],
        },
      ],
    };
    const editor = createTesinaEditor({
      element,
      content,
      newlyCreated: false,
      citationEnv: { refsById: new Map(), locale: "en" },
      referenceEnv: {
        references: [],
        locale: "en",
        emptyLabel: "No references yet",
      },
    });

    try {
      const root = element.querySelector(".tiptap");
      const appendix = root?.querySelector("[data-sec='appendix']");
      const levelFour = root?.querySelector("h4");
      const levelFive = root?.querySelector("h5");

      expect(appendix?.getAttribute("data-appendix-letter")).toBeNull();
      expect(levelFour?.getAttribute("data-apa-run-in")).toBe("true");
      expect(levelFour?.getAttribute("data-run-in-punctuation")).toBe(
        "preserve",
      );
      expect(levelFive?.getAttribute("data-apa-run-in")).toBe("true");
      expect(levelFive?.getAttribute("data-run-in-punctuation")).toBe(
        "append",
      );
      expect(editor.getJSON()).toEqual(content);
    } finally {
      editor.destroy();
      element.remove();
    }
  });
});

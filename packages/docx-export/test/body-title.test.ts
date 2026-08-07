import { describe, expect, it } from "vitest";
import { hasAuthoredBodyTitle, type PMJson } from "../src/index.ts";

function documentWithBody(content: PMJson[]): PMJson {
  return {
    type: "doc",
    content: [
      {
        type: "sectionAbstract",
        content: [{ type: "paragraph" }],
      },
      { type: "sectionBody", content },
    ],
  };
}

function heading(
  text: string,
  level = 1,
  marks?: PMJson["marks"],
): PMJson {
  return {
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
  };
}

describe("hasAuthoredBodyTitle", () => {
  it("recognizes a first level-1 body heading by its marked plain text", () => {
    const document = documentWithBody([
      {
        type: "heading",
        attrs: { level: 1 },
        content: [
          { type: "text", text: "Legacy " },
          { type: "text", text: "Body", marks: [{ type: "italic" }] },
          { type: "text", text: " Title", marks: [{ type: "bold" }] },
        ],
      },
      { type: "paragraph" },
    ]);

    expect(hasAuthoredBodyTitle(document, "Legacy Body Title")).toBe(true);
  });

  it("allows only outer whitespace and NFC normalization", () => {
    const document = documentWithBody([heading("  Café  ")]);

    expect(hasAuthoredBodyTitle(document, "Cafe\u0301")).toBe(true);
  });

  it.each([
    [
      "nonmatching punctuation",
      documentWithBody([heading("Original Title")]),
      "Original Title!",
    ],
    [
      "level-2 heading",
      documentWithBody([heading("Original Title", 2)]),
      "Original Title",
    ],
    [
      "paragraph before the heading",
      documentWithBody([
        { type: "paragraph", content: [{ type: "text", text: "Opening" }] },
        heading("Original Title"),
      ]),
      "Original Title",
    ],
    [
      "case difference",
      documentWithBody([heading("Original Title")]),
      "original title",
    ],
    [
      "renamed title page",
      documentWithBody([heading("Original Title")]),
      "Renamed Title",
    ],
  ])("does not recognize a %s", (_label, document, title) => {
    expect(hasAuthoredBodyTitle(document, title)).toBe(false);
  });
});

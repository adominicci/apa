import { describe, expect, it } from "vitest";
import { checkApaDocument } from "../src/index.ts";

function doc(...sections: unknown[]) {
  return { type: "doc", content: sections };
}

function body(...children: unknown[]) {
  return { type: "sectionBody", content: children };
}

function p(text?: string) {
  return text === undefined
    ? { type: "paragraph" }
    : { type: "paragraph", content: [{ type: "text", text }] };
}

function h(level: number, text: string) {
  return {
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  };
}

describe("checkApaDocument", () => {
  it("returns no issues for a clean body", () => {
    expect(
      checkApaDocument(doc(body(p("Intro"), h(1, "Método"), p("Texto")))),
    ).toEqual([]);
  });

  it("flags an empty paragraph with its child-index path", () => {
    const issues = checkApaDocument(doc(body(p("Hola"), p(), p("Sigue"))));
    expect(issues).toEqual([{ rule: "empty-paragraph", path: [0, 1] }]);
  });

  it("flags a whitespace-only paragraph", () => {
    const issues = checkApaDocument(doc(body(p("Hola"), p("   "))));
    expect(issues).toEqual([{ rule: "empty-paragraph", path: [0, 1] }]);
  });

  it("does not flag the placeholder paragraph of an otherwise empty section", () => {
    expect(
      checkApaDocument(
        doc(body(p("Hola")), { type: "sectionAppendix", content: [p()] }),
      ),
    ).toEqual([]);
  });

  it("allows a first heading of level 2: the generated section title is the de facto level 1", () => {
    expect(
      checkApaDocument(doc(body(p("Intro"), h(2, "Subsección"), p("x")))),
    ).toEqual([]);
  });

  it("flags a first heading deeper than level 2", () => {
    const issues = checkApaDocument(doc(body(p("Hola"), h(3, "Salto"))));
    expect(issues).toEqual([
      { rule: "skipped-heading-level", path: [0, 1], found: 3, allowed: 2 },
    ]);
  });

  it("allows headings that descend one level at a time", () => {
    expect(
      checkApaDocument(
        doc(body(h(1, "A"), p("x"), h(2, "B"), p("y"), h(3, "C"), p("z"))),
      ),
    ).toEqual([]);
  });

  it("allows a heading to return to any shallower level", () => {
    expect(
      checkApaDocument(doc(body(h(1, "A"), h(2, "B"), h(1, "C"), h(2, "D")))),
    ).toEqual([]);
  });

  it("flags a heading that skips a level after a shallower one", () => {
    const issues = checkApaDocument(doc(body(h(1, "A"), h(3, "C"))));
    expect(issues).toEqual([
      { rule: "skipped-heading-level", path: [0, 1], found: 3, allowed: 2 },
    ]);
  });

  it("restarts heading tracking on each section", () => {
    const issues = checkApaDocument(
      doc(
        body(h(1, "A"), h(2, "B"), h(3, "C")),
        { type: "sectionAppendix", content: [p("x"), h(3, "D")] },
      ),
    );
    expect(issues).toEqual([
      { rule: "skipped-heading-level", path: [1, 1], found: 3, allowed: 2 },
    ]);
  });

  it("flags an empty table title, pointing at the title node", () => {
    const table = {
      type: "apaTable",
      content: [
        { type: "tableTitle" },
        { type: "table" },
        { type: "tableNote", content: [{ type: "text", text: "Nota" }] },
      ],
    };
    expect(checkApaDocument(doc(body(p("Hola"), table)))).toEqual([
      { rule: "empty-table-title", path: [0, 1, 0] },
    ]);
  });

  it("flags an empty figure title, pointing at the title node", () => {
    const figure = {
      type: "figure",
      content: [
        { type: "figureTitle" },
        { type: "figureImage", attrs: { src: "x.png" } },
        { type: "figureNote" },
      ],
    };
    expect(checkApaDocument(doc(body(p("Hola"), figure)))).toEqual([
      { rule: "empty-figure-title", path: [0, 1, 0] },
    ]);
  });

  it("accepts a titled table and figure", () => {
    const table = {
      type: "apaTable",
      content: [
        { type: "tableTitle", content: [{ type: "text", text: "Título" }] },
        { type: "table" },
        { type: "tableNote" },
      ],
    };
    expect(checkApaDocument(doc(body(p("Hola"), table)))).toEqual([]);
  });

  it("reports several issues in document order", () => {
    const issues = checkApaDocument(
      doc(body(p("Hola"), p(), h(3, "Salto"), p())),
    );
    expect(issues.map((i) => i.rule)).toEqual([
      "empty-paragraph",
      "skipped-heading-level",
      "empty-paragraph",
    ]);
  });

  it("does not flag a paragraph whose only content is an inline atom", () => {
    const citationParagraph = {
      type: "paragraph",
      content: [{ type: "citation", attrs: { items: [] } }],
    };
    expect(
      checkApaDocument(doc(body(p("Hola"), citationParagraph))),
    ).toEqual([]);
  });

  it("does not flag the abstract placeholder when a keywords line follows it", () => {
    const abstract = {
      type: "sectionAbstract",
      content: [p(), { type: "keywordsLine" }],
    };
    expect(checkApaDocument(doc(abstract, body(p("Hola"))))).toEqual([]);
  });

  it("still flags a real blank line in an abstract with keywords", () => {
    const abstract = {
      type: "sectionAbstract",
      content: [p("Resumen breve."), p(), { type: "keywordsLine" }],
    };
    expect(checkApaDocument(doc(abstract, body(p("Hola"))))).toEqual([
      { rule: "empty-paragraph", path: [0, 1] },
    ]);
  });

  it("tolerates a malformed or empty document", () => {
    expect(checkApaDocument(undefined)).toEqual([]);
    expect(checkApaDocument({})).toEqual([]);
    expect(checkApaDocument({ type: "doc" })).toEqual([]);
  });
});

// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { buildReferenceList, getTerms } from "@tesina/engine";
import { createTesinaEditor } from "../../createEditor.ts";
import { createLongDocumentFixtures } from "./longDocumentFixture.ts";

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

function nodesOfType(
  value: unknown,
  type: string,
): Array<Record<string, unknown>> {
  const matches: Array<Record<string, unknown>> = [];
  const visit = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object") return;
    const node = candidate as Record<string, unknown>;
    if (node["type"] === type) matches.push(node);
    const content = node["content"];
    if (Array.isArray(content)) content.forEach(visit);
  };
  visit(value);
  return matches;
}

function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(allStrings);
}

afterEach(() => document.body.replaceChildren());

describe("long-document pagination proof fixtures", () => {
  it.each(["en", "es"] as const)(
    "loads the %s fixture through the real Tesina schema with every authored break risk",
    (locale) => {
      const fixture = createLongDocumentFixtures()[locale];
      const element = document.createElement("div");
      document.body.append(element);
      const editor = createTesinaEditor({
        element,
        content: fixture.content,
        newlyCreated: true,
        citationEnv: {
          refsById: new Map(fixture.references.map((ref) => [ref.id, ref])),
          locale,
        },
        referenceEnv: {
          references: fixture.references,
          locale,
          emptyLabel: "unused",
        },
      });

      try {
        expect(editor.getJSON()).toEqual(fixture.content);
        expect(nodesOfType(fixture.content, "paragraph").length)
          .toBeGreaterThan(8);
        expect(nodesOfType(fixture.content, "hardBreak")).toHaveLength(1);
        expect(nodesOfType(fixture.content, "blockquote")).toHaveLength(1);
        expect(
          nodesOfType(fixture.content, "heading").some((node) =>
            (node["attrs"] as { level?: number } | undefined)?.level === 4
          ),
        ).toBe(true);
        expect(nodesOfType(fixture.content, "citation")).toHaveLength(1);
        expect(nodesOfType(fixture.content, "keywordsLine")).toHaveLength(1);
        expect(nodesOfType(fixture.content, "orderedList")).toHaveLength(1);
        expect(nodesOfType(fixture.content, "bulletList")).toHaveLength(1);
        expect(nodesOfType(fixture.content, "tableRow").length)
          .toBeGreaterThanOrEqual(8);
        expect(nodesOfType(fixture.content, "figure")).toHaveLength(2);
        expect(nodesOfType(fixture.content, "apaEquation")).toHaveLength(1);
        expect(nodesOfType(fixture.content, "sectionAppendix")).toHaveLength(1);
        expect(fixture.atomicHeights["proof-oversize-figure"]).toBeGreaterThan(
          fixture.printableHeight,
        );
      } finally {
        editor.destroy();
      }
    },
  );

  it("keeps generated English and Spanish labels out of authored JSON", () => {
    const fixtures = createLongDocumentFixtures();
    const expected = {
      en: {
        abstract: getTerms("en").headings.abstract,
        references: getTerms("en").headings.references,
        table: "Table 1",
        figure: "Figure 1",
        appendix: "Appendix",
      },
      es: {
        abstract: getTerms("es").headings.abstract,
        references: getTerms("es").headings.references,
        table: "Tabla 1",
        figure: "Figura 1",
        appendix: "Apéndice",
      },
    };

    expect(fixtures.en.expectedGeneratedLabels).toEqual(expected.en);
    expect(fixtures.es.expectedGeneratedLabels).toEqual(expected.es);
    for (const fixture of Object.values(fixtures)) {
      const authoredStrings = allStrings(fixture.content);
      for (const label of Object.values(fixture.expectedGeneratedLabels)) {
        expect(authoredStrings).not.toContain(label);
      }
    }
  });

  it.each(["en", "es"] as const)(
    "renders several deterministic long %s reference entries",
    (locale) => {
      const fixture = createLongDocumentFixtures()[locale];
      const { entries } = buildReferenceList(fixture.references, locale);
      const rendered = entries.map((entry) =>
        entry.runs.map((run) => run.text).join("")
      );

      expect(rendered).toHaveLength(6);
      expect(rendered.every((entry) => entry.length >= 150)).toBe(true);
      expect(new Set(rendered).size).toBe(rendered.length);
    },
  );
});

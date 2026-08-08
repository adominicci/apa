/**
 * Pure identity/path remapping walkers (tasks 5.3/5.4): citation refIds and
 * figure paths are rewritten in every supported block container — body,
 * abstract, appendices, paragraphs, nested lists, tables — plus the
 * references snapshot, and the input essay object is never mutated.
 */
import { describe, expect, it } from "vitest";
import type { Reference } from "@tesina/engine";
import type { Essay } from "$lib/model/essay";
import { fixtureUuid } from "./fixtures/libraries.ts";
import {
  collectCitationRefIds,
  remapCitationRefIds,
  remapEssay,
} from "./remap.ts";
import { collectFigureSources } from "./snapshot.ts";

const OLD_REF = fixtureUuid(1, 1);
const KEPT_REF = fixtureUuid(1, 2);
const NEW_REF = fixtureUuid(1, 91);
const OLD_SRC = `assets/${fixtureUuid(4, 1)}.png`;
const NEW_SRC = `essays/assets/${fixtureUuid(4, 91)}.png`;

function citation(...refIds: string[]): unknown {
  return {
    type: "citation",
    attrs: { items: refIds.map((refId) => ({ refId })), mode: "parenthetical" },
  };
}

function paragraphWith(...inline: unknown[]): unknown {
  return { type: "paragraph", content: inline };
}

/** Citations nested in every supported block container. */
function fixtureDoc(): unknown {
  return {
    type: "doc",
    content: [
      {
        type: "sectionAbstract",
        content: [paragraphWith(
          { type: "text", text: "Resumen " },
          citation(OLD_REF),
        )],
      },
      {
        type: "sectionBody",
        content: [
          paragraphWith({ type: "text", text: "Cuerpo " }, citation(OLD_REF)),
          {
            type: "bulletList",
            content: [{
              type: "listItem",
              content: [{
                type: "orderedList",
                content: [{
                  type: "listItem",
                  content: [paragraphWith(citation(OLD_REF, KEPT_REF))],
                }],
              }],
            }],
          },
          {
            type: "table",
            content: [{
              type: "tableRow",
              content: [{
                type: "tableCell",
                content: [paragraphWith(citation(OLD_REF))],
              }],
            }],
          },
          {
            type: "figure",
            content: [
              { type: "figureImage", attrs: { src: OLD_SRC, alt: "Figura" } },
            ],
          },
        ],
      },
      {
        type: "sectionAppendix",
        content: [paragraphWith(citation(OLD_REF))],
      },
    ],
  };
}

function fixtureEssay(): Essay {
  const snapshot: Reference[] = [
    {
      type: "journalArticle",
      id: OLD_REF,
      authors: [{ kind: "person", family: "Autora", given: "M." }],
      date: { year: 2020 },
      title: "Estudio remapeado",
      journal: "Revista Sintética",
    },
    {
      type: "book",
      id: KEPT_REF,
      authors: [{ kind: "group", name: "Grupo" }],
      date: { year: 2019 },
      title: "Libro intacto",
    },
  ];
  return {
    schemaVersion: 2,
    id: fixtureUuid(2, 1),
    createdAt: "2026-01-15T12:00:00.000Z",
    updatedAt: "2026-01-15T12:00:00.000Z",
    settings: {
      documentLanguage: "es",
      variant: "student",
      font: "times-new-roman-12",
      paperSize: "us-letter",
      includeUncitedReferences: false,
    },
    titlePage: { title: "Ensayo", authors: [], affiliations: [] },
    content: fixtureDoc(),
    referencesSnapshot: snapshot,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe("collectCitationRefIds", () => {
  it("finds every citation in every container, in document order", () => {
    expect(collectCitationRefIds(fixtureDoc())).toEqual([
      OLD_REF, // abstract
      OLD_REF, // body paragraph
      OLD_REF, // nested list
      KEPT_REF, // nested list, second item
      OLD_REF, // table cell
      OLD_REF, // appendix
    ]);
  });
});

describe("remapCitationRefIds", () => {
  const idMap = new Map([[OLD_REF, NEW_REF]]);

  it("rewrites citations in abstract, body, lists, tables, and appendices", () => {
    const remapped = remapCitationRefIds(fixtureDoc(), idMap);
    expect(collectCitationRefIds(remapped)).toEqual([
      NEW_REF,
      NEW_REF,
      NEW_REF,
      KEPT_REF,
      NEW_REF,
      NEW_REF,
    ]);
  });

  it("leaves unmapped refIds and figure paths untouched", () => {
    const remapped = remapCitationRefIds(fixtureDoc(), idMap);
    expect(collectCitationRefIds(remapped)).toContain(KEPT_REF);
    expect(collectFigureSources(remapped)).toEqual([OLD_SRC]);
  });

  it("returns the document unchanged for an empty map", () => {
    expect(remapCitationRefIds(fixtureDoc(), new Map())).toEqual(fixtureDoc());
  });

  it("never mutates the input document", () => {
    const input = deepFreeze(fixtureDoc());
    remapCitationRefIds(input, idMap);
    expect(input).toEqual(fixtureDoc());
  });
});

describe("remapEssay", () => {
  const maps = {
    referenceIdMap: new Map([[OLD_REF, NEW_REF]]),
    figurePathMap: new Map([[OLD_SRC, NEW_SRC]]),
  };

  it("rewrites citations, figure paths, and the references snapshot", () => {
    const remapped = remapEssay(fixtureEssay(), maps);
    expect(collectCitationRefIds(remapped.content)).toEqual([
      NEW_REF,
      NEW_REF,
      NEW_REF,
      KEPT_REF,
      NEW_REF,
      NEW_REF,
    ]);
    expect(collectFigureSources(remapped.content)).toEqual([NEW_SRC]);
    expect(remapped.referencesSnapshot.map((r) => r.id)).toEqual([
      NEW_REF,
      KEPT_REF,
    ]);
  });

  it("changes only the id of a remapped snapshot reference", () => {
    const remapped = remapEssay(fixtureEssay(), maps);
    expect(remapped.referencesSnapshot[0]).toEqual({
      ...fixtureEssay().referencesSnapshot[0],
      id: NEW_REF,
    });
    expect(remapped.referencesSnapshot[1]).toEqual(
      fixtureEssay().referencesSnapshot[1],
    );
  });

  it("preserves every non-content essay field", () => {
    const remapped = remapEssay(fixtureEssay(), maps);
    const { content: _c1, referencesSnapshot: _r1, ...rest } = remapped;
    const { content: _c2, referencesSnapshot: _r2, ...expected } =
      fixtureEssay();
    expect(rest).toEqual(expected);
  });

  it("is the identity (by value) under empty maps", () => {
    const remapped = remapEssay(fixtureEssay(), {
      referenceIdMap: new Map(),
      figurePathMap: new Map(),
    });
    expect(remapped).toEqual(fixtureEssay());
  });

  it("never mutates a pre-existing local essay object", () => {
    const input = deepFreeze(fixtureEssay());
    const remapped = remapEssay(input, maps);
    expect(input).toEqual(fixtureEssay());
    expect(remapped).not.toBe(input);
    expect(remapped.content).not.toBe(input.content);
    expect(remapped.referencesSnapshot).not.toBe(input.referencesSnapshot);
  });
});

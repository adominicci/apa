import { describe, expect, it } from "vitest";
import { sortReferences, titleSortKey } from "../src/sort.ts";
import type { Contributor, Reference } from "../src/model/reference.ts";

let counter = 0;
function book(
  authors: Contributor[],
  overrides: Partial<Reference> = {},
): Reference {
  counter += 1;
  return {
    type: "book",
    id: `ref-${counter}`,
    authors,
    date: { year: 2020 },
    title: `Título de prueba ${counter}`,
    ...overrides,
  } as Reference;
}

function person(family: string, given = "Ana"): Contributor {
  return { kind: "person", family, given };
}

describe("titleSortKey", () => {
  it("drops leading articles per locale", () => {
    expect(titleSortKey("The quiet method", "en")).toBe("quiet method");
    expect(titleSortKey("El método callado", "es")).toBe("método callado");
    expect(titleSortKey("Una hipótesis más", "es")).toBe("hipótesis más");
  });

  it("keeps titles whose first word is not an article", () => {
    expect(titleSortKey("Método callado", "es")).toBe("Método callado");
  });
});

describe("sortReferences", () => {
  it("alphabetizes with Spanish collation (ñ after n)", () => {
    const refs = [
      book([person("Muñoz")]),
      book([person("Nadal")]),
      book([person("Munar")]),
      book([person("Mora")]),
    ];
    const sorted = sortReferences(refs, "es").map(
      (r) => (r.authors[0] as { family: string }).family,
    );
    expect(sorted).toEqual(["Mora", "Munar", "Muñoz", "Nadal"]);
  });

  it("puts a one-author work before multi-author works with the same lead", () => {
    const solo = book([person("Rivas", "Elena")], { date: { year: 2024 } });
    const dueto = book([person("Rivas", "Elena"), person("Acosta", "Bruno")], {
      date: { year: 1999 },
    });
    expect(sortReferences([dueto, solo], "en").map((r) => r.id)).toEqual([
      solo.id,
      dueto.id,
    ]);
  });

  it("orders identical author lists chronologically: undated, years, in press", () => {
    const authors = [person("Serrano", "Iris")];
    const undated = book(authors, { date: { noDate: true } });
    const early = book(authors, { date: { year: 2001 } });
    const late = book(authors, { date: { year: 2019 } });
    const pending = book(authors, { date: { inPress: true } });
    const sorted = sortReferences([late, pending, undated, early], "en");
    expect(sorted.map((r) => r.id)).toEqual([
      undated.id,
      early.id,
      late.id,
      pending.id,
    ]);
  });

  it("breaks same-author same-year ties by title ignoring articles", () => {
    const authors = [person("Bravo", "Hugo")];
    const zeta = book(authors, { title: "La zona de estudio" });
    const alfa = book(authors, { title: "El aula abierta" });
    const sorted = sortReferences([zeta, alfa], "es");
    expect(sorted.map((r) => r.title)).toEqual([
      "El aula abierta",
      "La zona de estudio",
    ]);
  });

  it("sorts authorless works by title among the rest", () => {
    const anon = book([], { title: "Informe general del programa" });
    const garcia = book([person("García", "Lía")]);
    const zapata = book([person("Zapata", "Raúl")]);
    const sorted = sortReferences([zapata, anon, garcia], "es");
    expect(sorted.map((r) => r.id)).toEqual([garcia.id, anon.id, zapata.id]);
  });
});

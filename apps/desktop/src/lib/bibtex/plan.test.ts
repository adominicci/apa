import { describe, expect, it } from "vitest";
import type { Reference } from "@tesina/engine";
import { buildImportPlan, normalizeTitleKey, parseBib } from "./plan.ts";

function existing(
  partial: Partial<Reference> & { id: string; title: string },
): Reference {
  return {
    type: "journalArticle",
    authors: [],
    date: {},
    journal: "",
    ...partial,
  } as Reference;
}

function plan(bib: string, lib: Reference[] = []) {
  return buildImportPlan(parseBib(bib), lib);
}

describe("normalizeTitleKey", () => {
  it("folds case, strips diacritics and punctuation, and appends the year", () => {
    expect(normalizeTitleKey("Educación, ¡lectura!", 2020)).toBe(
      "educacionlectura|2020",
    );
    expect(normalizeTitleKey("Educacion lectura", 2020)).toBe(
      "educacionlectura|2020",
    );
    expect(normalizeTitleKey("Sin año")).toBe("sinano|?");
  });

  it("keeps non-Latin scripts distinct instead of collapsing them", () => {
    // Two different Chinese titles from the same year must not collide.
    const a = normalizeTitleKey("研究方法", 2024);
    const b = normalizeTitleKey("数据分析", 2024);
    expect(a).not.toBe(b);
    expect(a).toBe("研究方法|2024");
  });
});

describe("buildImportPlan — duplicates", () => {
  it("flags a DOI already in the library regardless of prefix or case", () => {
    const lib = [
      existing({ id: "r1", title: "Trabajo previo", doi: "10.1/AB" }),
    ];
    const { rows } = plan(
      `@article{x, title={Otro título}, journal={J}, year={2021},
        doi={https://doi.org/10.1/ab}}`,
      lib,
    );
    expect(rows[0].duplicate).toEqual({
      of: "library",
      label: "Trabajo previo",
    });
  });

  it("flags a title+year match when neither side has a DOI", () => {
    const lib = [
      existing({
        id: "r1",
        title: "Educación y lectura",
        date: { year: 2020 },
      }),
    ];
    const dup = plan(
      `@book{x, title={educacion, y lectura!}, year={2020}}`,
      lib,
    );
    expect(dup.rows[0].duplicate?.of).toBe("library");

    const notDup = plan(
      `@book{x, title={educacion, y lectura!}, year={2019}}`,
      lib,
    );
    expect(notDup.rows[0].duplicate).toBeUndefined();
  });

  it("flags the second of two identical entries in the same file", () => {
    const { rows } = plan(
      `@book{a, title={Manual repetido}, year={2018}}
       @book{b, title={Manual repetido}, year={2018}}`,
    );
    expect(rows[0].duplicate).toBeUndefined();
    expect(rows[1].duplicate?.of).toBe("batch");
  });

  it("does not flag two different DOIs that share a title", () => {
    const { rows } = plan(
      `@article{a, title={Igual}, journal={J}, year={2020}, doi={10.1/a}}
       @article{b, title={Igual}, journal={J}, year={2020}, doi={10.1/b}}`,
    );
    expect(rows[1].duplicate).toBeUndefined();
  });

  it("does not treat two different non-Latin titles as duplicates", () => {
    const { rows } = plan(
      `@book{a, title={研究方法}, year={2024}}
       @book{b, title={数据分析}, year={2024}}`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].duplicate).toBeUndefined();
    expect(rows[1].duplicate).toBeUndefined();
  });
});

describe("buildImportPlan — parsing", () => {
  it("keeps the readable entries, reports the broken one, and drops its empty stub", () => {
    const { rows, errors } = plan(
      `@article{ok, title={Entrada válida}, journal={J}, year={2020}}
       @article{bad, title={Rota, year={2021}`,
    );
    expect(rows.map((r) => r.key)).toContain("ok");
    // The broken entry is counted as unreadable, not shown as an empty row.
    expect(rows.map((r) => r.key)).not.toContain("bad");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("returns no rows for empty or reference-less text", () => {
    expect(plan("").rows).toEqual([]);
    expect(plan("   % just a comment\n").rows).toEqual([]);
  });

  it("carries the citation key and generates a stable id per row", () => {
    const { rows } = plan(`@book{miClave, title={T}, year={2020}}`);
    expect(rows[0].key).toBe("miClave");
    expect(rows[0].ref.id).toMatch(/[0-9a-f-]{36}/);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildReferenceList,
  type Contributor,
  plainText,
  type Reference,
} from "../src/index.ts";

function person(family: string, given = "Ana"): Contributor {
  return { kind: "person", family, given };
}

let counter = 0;
function book(
  authors: Contributor[],
  year: number,
  title: string,
): Reference {
  counter += 1;
  return {
    type: "book",
    id: `list-${counter}`,
    authors,
    date: { year },
    title,
    publisher: "Editorial de Prueba",
  };
}

describe("buildReferenceList", () => {
  it("sorts, deduplicates, and applies year suffixes end to end", () => {
    const authors = [person("Camacho", "Iris")];
    const b = book(authors, 2020, "Bitácora del taller");
    const a = book(authors, 2020, "Análisis del aula");
    const z = book([person("Zubiri", "Elena")], 2019, "Otro libro más");

    const { entries, ctx } = buildReferenceList([b, a, z, b], "es");

    expect(entries.map((e) => e.refId)).toEqual([a.id, b.id, z.id]);
    expect(ctx.yearSuffixes.get(a.id)).toBe("a");
    expect(ctx.yearSuffixes.get(b.id)).toBe("b");
    expect(plainText(entries[0]!.runs)).toContain("(2020a).");
    expect(plainText(entries[1]!.runs)).toContain("(2020b).");
    expect(plainText(entries[2]!.runs)).toContain("(2019).");
  });

  it("does not suffix same-year works by different authors", () => {
    const one = book([person("Camacho")], 2020, "Primer título");
    const other = book([person("Ferrer")], 2020, "Segundo título");
    const { ctx } = buildReferenceList([one, other], "en");
    expect(ctx.yearSuffixes.size).toBe(0);
  });
});

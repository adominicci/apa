import { describe, expect, it } from "vitest";
import {
  buildCitationContext,
  type CitationAttrs,
  type Contributor,
  formatCitation,
  plainText,
  type Reference,
} from "../src/index.ts";

let counter = 0;
function article(
  authors: Contributor[],
  year: number | undefined,
  overrides: Partial<Reference> = {},
): Reference {
  counter += 1;
  return {
    type: "journalArticle",
    id: `ref-${counter}`,
    authors,
    date: year === undefined ? { noDate: true } : { year },
    title: `Estudio inventado número ${counter}`,
    journal: "Revista Imaginaria",
    ...overrides,
  } as Reference;
}

function person(family: string, given = "Ana"): Contributor {
  return { kind: "person", family, given };
}

function byId(...refs: Reference[]): Map<string, Reference> {
  return new Map(refs.map((r) => [r.id, r]));
}

function cite(
  refs: Reference[],
  mode: CitationAttrs["mode"] = "parenthetical",
): CitationAttrs {
  return { mode, items: refs.map((r) => ({ refId: r.id })) };
}

function render(
  attrs: CitationAttrs,
  refs: Reference[],
  locale: "en" | "es" = "en",
  allCitations: CitationAttrs[] = [attrs],
): string {
  const map = byId(...refs);
  const ctx = buildCitationContext(allCitations, map, locale);
  return plainText(formatCitation(attrs, ctx, map, locale));
}

describe("parenthetical citations", () => {
  it("renders one author with year", () => {
    const ref = article([person("Camacho", "Iris")], 2021);
    expect(render(cite([ref]), [ref])).toBe("(Camacho, 2021)");
  });

  it("joins two authors per locale", () => {
    const ref = article([person("Camacho"), person("Ferrer")], 2021);
    expect(render(cite([ref]), [ref], "en")).toBe("(Camacho & Ferrer, 2021)");
    expect(render(cite([ref]), [ref], "es")).toBe("(Camacho y Ferrer, 2021)");
  });

  it("applies the Spanish e-before-i conjunction in citations", () => {
    const ref = article([person("Camacho"), person("Iglesias")], 2021);
    expect(render(cite([ref]), [ref], "es")).toBe(
      "(Camacho e Iglesias, 2021)",
    );
  });

  it("uses et al. from the first citation with three or more authors", () => {
    const ref = article(
      [person("Camacho"), person("Ferrer"), person("Osorio")],
      2021,
    );
    expect(render(cite([ref]), [ref])).toBe("(Camacho et al., 2021)");
  });

  it("renders undated works per locale", () => {
    const ref = article([person("Camacho")], undefined);
    expect(render(cite([ref]), [ref], "en")).toBe("(Camacho, n.d.)");
    expect(render(cite([ref]), [ref], "es")).toBe("(Camacho, s. f.)");
  });

  it("adds locators with localized labels", () => {
    const ref = article([person("Camacho")], 2021);
    const attrs: CitationAttrs = {
      mode: "parenthetical",
      items: [{
        refId: ref.id,
        locator: { type: "paragraph", value: "4" },
      }],
    };
    expect(render(attrs, [ref], "en")).toBe("(Camacho, 2021, para. 4)");
    expect(render(attrs, [ref], "es")).toBe("(Camacho, 2021, párr. 4)");
  });

  it("sorts multiple works into reference-list order joined by semicolons", () => {
    const zubiri = article([person("Zubiri", "Elena")], 2019);
    const acosta = article([person("Acosta", "Bruno")], 2022);
    expect(render(cite([zubiri, acosta]), [zubiri, acosta])).toBe(
      "(Acosta, 2022; Zubiri, 2019)",
    );
  });

  it("supports prefix, suffix, and suppressed author", () => {
    const ref = article([person("Camacho")], 2021);
    const attrs: CitationAttrs = {
      mode: "parenthetical",
      items: [{
        refId: ref.id,
        prefix: "véase",
        suffix: "para una revisión",
      }],
    };
    expect(render(attrs, [ref], "es")).toBe(
      "(véase Camacho, 2021, para una revisión)",
    );
    const suppressed: CitationAttrs = {
      mode: "parenthetical",
      items: [{ refId: ref.id, suppressAuthor: true }],
    };
    expect(render(suppressed, [ref])).toBe("(2021)");
  });

  it("renders a placeholder for deleted references", () => {
    const ref = article([person("Camacho")], 2021);
    const attrs: CitationAttrs = {
      mode: "parenthetical",
      items: [{ refId: "no-existe" }],
    };
    expect(render(attrs, [ref])).toBe("(???)");
  });

  it("uses the short title for authorless works", () => {
    const ref = article([], 2020, {
      title: "Resultados preliminares del sondeo nacional de lectura",
    });
    expect(render(cite([ref]), [ref])).toBe(
      "(“Resultados preliminares del sondeo”, 2020)",
    );
  });
});

describe("narrative citations", () => {
  it("renders author outside and year inside parens", () => {
    const ref = article(
      [person("Camacho", "Iris"), person("Ferrer", "Hugo")],
      2021,
    );
    expect(render(cite([ref], "narrative"), [ref], "en")).toBe(
      "Camacho and Ferrer (2021)",
    );
    expect(render(cite([ref], "narrative"), [ref], "es")).toBe(
      "Camacho y Ferrer (2021)",
    );
  });

  it("keeps locators inside the year parens", () => {
    const ref = article([person("Camacho")], 2021);
    const attrs: CitationAttrs = {
      mode: "narrative",
      items: [{ refId: ref.id, locator: { type: "page", value: "12" } }],
    };
    expect(render(attrs, [ref])).toBe("Camacho (2021, p. 12)");
  });
});

describe("group authors with abbreviation", () => {
  const group: Contributor = {
    kind: "group",
    name: "Fundación Lectora del Sur",
    abbreviation: "FLS",
  };

  it("introduces the abbreviation on first use, then uses it alone", () => {
    const ref = article([group], 2020);
    const map = byId(ref);
    const attrs = cite([ref]);
    const ctx = buildCitationContext([attrs], map, "es");
    const first = plainText(
      formatCitation(attrs, ctx, map, "es", {
        firstOccurrenceRefIds: new Set([ref.id]),
      }),
    );
    const later = plainText(
      formatCitation(attrs, ctx, map, "es", {
        firstOccurrenceRefIds: new Set(),
      }),
    );
    expect(first).toBe("(Fundación Lectora del Sur [FLS], 2020)");
    expect(later).toBe("(FLS, 2020)");
  });

  it("introduces narrative abbreviations inside the year parens", () => {
    const ref = article([group], 2020);
    const map = byId(ref);
    const attrs = cite([ref], "narrative");
    const ctx = buildCitationContext([attrs], map, "es");
    const first = plainText(
      formatCitation(attrs, ctx, map, "es", {
        firstOccurrenceRefIds: new Set([ref.id]),
      }),
    );
    expect(first).toBe("Fundación Lectora del Sur (FLS, 2020)");
  });

  it("always spells out the full name when no occurrence info is given", () => {
    const ref = article([group], 2020);
    expect(render(cite([ref]), [ref], "es")).toBe(
      "(Fundación Lectora del Sur, 2020)",
    );
  });
});

describe("disambiguation scenarios", () => {
  it("assigns year suffixes to same-author same-year works", () => {
    const authors = [person("Camacho", "Iris")];
    const a = article(authors, 2020, { title: "Análisis del aula" });
    const b = article(authors, 2020, { title: "Bitácora del taller" });
    const all = [cite([a]), cite([b])];
    expect(render(cite([a]), [a, b], "en", all)).toBe("(Camacho, 2020a)");
    expect(render(cite([b]), [a, b], "en", all)).toBe("(Camacho, 2020b)");
  });

  it("hyphenates suffixes on undated same-author works", () => {
    const authors = [person("Camacho", "Iris")];
    const a = article(authors, undefined, { title: "Apuntes sueltos" });
    const b = article(authors, undefined, { title: "Borradores varios" });
    const all = [cite([a]), cite([b])];
    expect(render(cite([a]), [a, b], "es", all)).toBe("(Camacho, s. f.-a)");
    expect(render(cite([b]), [a, b], "es", all)).toBe("(Camacho, s. f.-b)");
  });

  it("expands et al. only far enough to distinguish colliding works", () => {
    const a = article(
      [person("Camacho"), person("Ferrer"), person("Osorio"), person("Prieto")],
      2021,
    );
    const b = article(
      [person("Camacho"), person("Gil"), person("Osorio"), person("Prieto")],
      2021,
    );
    const all = [cite([a]), cite([b])];
    expect(render(cite([a]), [a, b], "en", all)).toBe(
      "(Camacho, Ferrer, et al., 2021)",
    );
    expect(render(cite([b]), [a, b], "en", all)).toBe(
      "(Camacho, Gil, et al., 2021)",
    );
  });

  it("writes all authors when expansion would leave only one omitted", () => {
    const a = article(
      [person("Camacho"), person("Ferrer"), person("Osorio")],
      2021,
    );
    const b = article(
      [person("Camacho"), person("Ferrer"), person("Prieto")],
      2021,
    );
    const all = [cite([a]), cite([b])];
    expect(render(cite([a]), [a, b], "en", all)).toBe(
      "(Camacho, Ferrer, & Osorio, 2021)",
    );
  });

  it("adds initials when different first authors share a surname", () => {
    const marta = article([person("García", "Marta")], 2019);
    const pablo = article([person("García", "Pablo")], 2022);
    const all = [cite([marta]), cite([pablo])];
    expect(render(cite([marta]), [marta, pablo], "en", all)).toBe(
      "(M. García, 2019)",
    );
    expect(render(cite([pablo]), [marta, pablo], "en", all)).toBe(
      "(P. García, 2022)",
    );
  });
});

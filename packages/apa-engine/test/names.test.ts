import { describe, expect, it } from "vitest";
import {
  formatAuthorsForReferences,
  formatAuthorsInText,
  formatContributorsInline,
  initialsFirstName,
  initialsOf,
  invertedName,
} from "../src/names.ts";
import { en } from "../src/locale/en.ts";
import { es } from "../src/locale/es.ts";
import type { Contributor } from "../src/model/reference.ts";

function person(family: string, given?: string, suffix?: string): Contributor {
  return {
    kind: "person",
    family,
    ...(given !== undefined ? { given } : {}),
    ...(suffix !== undefined ? { suffix } : {}),
  };
}

describe("initialsOf", () => {
  it("initials a single given name", () => {
    expect(initialsOf("Marisol")).toBe("M.");
  });

  it("initials multiple given names with spaces between", () => {
    expect(initialsOf("José María")).toBe("J. M.");
  });

  it("preserves hyphenated given names", () => {
    expect(initialsOf("Jean-Paul")).toBe("J.-P.");
  });

  it("normalizes given names already written as initials", () => {
    expect(initialsOf("J.  M.")).toBe("J. M.");
  });
});

describe("invertedName", () => {
  it("inverts a person with initials", () => {
    expect(invertedName(person("García Vélez", "Ana Sofía"))).toBe(
      "García Vélez, A. S.",
    );
  });

  it("appends generational suffixes after the initials", () => {
    expect(invertedName(person("Soto", "Ramón", "Jr."))).toBe(
      "Soto, R., Jr.",
    );
  });

  it("keeps group authors as their full name", () => {
    expect(
      invertedName({ kind: "group", name: "Instituto Andino de Lectura" }),
    ).toBe("Instituto Andino de Lectura");
  });

  it("handles a person with no given name", () => {
    expect(invertedName(person("Sencilla"))).toBe("Sencilla");
  });
});

describe("initialsFirstName", () => {
  it("puts initials before the surname", () => {
    expect(initialsFirstName(person("Quesada", "Lucía"))).toBe("L. Quesada");
  });
});

describe("formatAuthorsForReferences", () => {
  const two = [person("Fuentes", "Carla"), person("Ibarra", "Diego")];
  const three = [...two, person("Peña", "Rosa María")];

  it("joins two authors with & and a comma in English", () => {
    expect(formatAuthorsForReferences(two, en)).toBe(
      "Fuentes, C., & Ibarra, D.",
    );
  });

  it("joins two authors with the conjunction and no comma in Spanish", () => {
    // RAE: "y" becomes "e" before the /i/ of "Ibarra".
    expect(formatAuthorsForReferences(two, es)).toBe(
      "Fuentes, C. e Ibarra, D.",
    );
  });

  it("joins three authors per locale", () => {
    expect(formatAuthorsForReferences(three, en)).toBe(
      "Fuentes, C., Ibarra, D., & Peña, R. M.",
    );
    expect(formatAuthorsForReferences(three, es)).toBe(
      "Fuentes, C., Ibarra, D. y Peña, R. M.",
    );
  });

  it("lists all authors up to twenty", () => {
    const twenty = Array.from(
      { length: 20 },
      (_, i) => person(`Apellido${String(i + 1).padStart(2, "0")}`, "Zoe"),
    );
    const result = formatAuthorsForReferences(twenty, en);
    expect(result).toContain("Apellido20, Z.");
    expect(result).toContain("& Apellido20, Z.");
    expect(result).not.toContain(". . .");
  });

  it("collapses twenty-one or more to first 19, ellipsis, and last", () => {
    const twentyOne = Array.from(
      { length: 21 },
      (_, i) => person(`Apellido${String(i + 1).padStart(2, "0")}`, "Zoe"),
    );
    const result = formatAuthorsForReferences(twentyOne, en);
    expect(result).toContain("Apellido19, Z., . . . Apellido21, Z.");
    expect(result).not.toContain("Apellido20");
    expect(result).not.toContain("&");
  });
});

describe("formatContributorsInline", () => {
  it("formats editors initials-first with the locale and-word", () => {
    const eds = [person("Salas", "Teresa"), person("Vega", "Óscar Luis")];
    expect(formatContributorsInline(eds, en)).toBe("T. Salas & Ó. L. Vega");
    expect(formatContributorsInline(eds, es)).toBe("T. Salas y Ó. L. Vega");
  });
});

describe("formatAuthorsInText", () => {
  it("renders surnames joined by the narrative and-word", () => {
    const pair = [person("Fuentes", "Carla"), person("Ibarra", "Diego")];
    expect(formatAuthorsInText(pair, false, en.andNarrative, en)).toBe(
      "Fuentes and Ibarra",
    );
    expect(formatAuthorsInText(pair, false, es.andNarrative, es)).toBe(
      "Fuentes e Ibarra",
    );
  });

  it("keeps 'y' before names that start with the hie/hia diphthong", () => {
    const pair = [person("Vega", "Luz"), person("Hierro", "Pablo")];
    expect(formatAuthorsInText(pair, false, es.andNarrative, es)).toBe(
      "Vega y Hierro",
    );
    const hidalgoPair = [person("Vega", "Luz"), person("Hidalgo", "Inés")];
    expect(formatAuthorsInText(hidalgoPair, false, es.andNarrative, es)).toBe(
      "Vega e Hidalgo",
    );
  });

  it("adds initials when disambiguation requires them", () => {
    expect(
      formatAuthorsInText(
        [person("García", "Marta")],
        true,
        en.andNarrative,
        en,
      ),
    ).toBe("M. García");
  });
});

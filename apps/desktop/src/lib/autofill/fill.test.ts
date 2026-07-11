import { describe, expect, it } from "vitest";
import { refToQuickFields } from "./fill.ts";

describe("refToQuickFields", () => {
  it("prefills a journal article with author lines and page range", () => {
    const fields = refToQuickFields({
      id: "x",
      type: "journalArticle",
      authors: [
        { kind: "person", family: "Salgado", given: "Nora" },
        { kind: "group", name: "Consejo Nacional de Lectura" },
      ],
      date: { year: 2020 },
      title: "Hábitos de lectura",
      journal: "Revista Imaginaria",
      volume: "12",
      issue: "3",
      pageStart: "45",
      pageEnd: "67",
      doi: "10.1234/x",
    });
    expect(fields).toMatchObject({
      type: "journalArticle",
      authorsText: "Salgado, Nora\nConsejo Nacional de Lectura",
      year: "2020",
      noDate: false,
      journal: "Revista Imaginaria",
      pages: "45–67",
      doi: "10.1234/x",
    });
  });

  it("prefills books and undated works", () => {
    const fields = refToQuickFields({
      id: "y",
      type: "book",
      authors: [{ kind: "person", family: "Padilla", given: "Elena" }],
      date: { noDate: true },
      title: "Fundamentos",
      publisher: "Ediciones Cardenal",
    });
    expect(fields).toMatchObject({
      type: "book",
      noDate: true,
      year: "",
      publisher: "Ediciones Cardenal",
    });
  });

  it("returns null for chapters (not editable in the quick form yet)", () => {
    expect(
      refToQuickFields({
        id: "z",
        type: "bookChapter",
        authors: [],
        date: { year: 2019 },
        title: "Capítulo",
        editors: [],
        bookTitle: "Libro",
      }),
    ).toBeNull();
  });

  it("prefills reports with institution and report number", () => {
    const fields = refToQuickFields({
      id: "r",
      type: "report",
      authors: [{ kind: "group", name: "Consejo Nacional de Lectura" }],
      date: { year: 2021 },
      title: "Panorama lector",
      institution: "Consejo Nacional de Lectura",
      reportNumber: "CL-9",
    });
    expect(fields).toMatchObject({
      type: "report",
      institution: "Consejo Nacional de Lectura",
      reportNumber: "CL-9",
    });
  });

  it("prefills theses with type, institution, and archive", () => {
    const fields = refToQuickFields({
      id: "t",
      type: "thesis",
      authors: [{ kind: "person", family: "Vargas", given: "Óscar" }],
      date: { year: 2018 },
      title: "Estrategias de revisión",
      thesisType: "masters",
      institution: "Universidad del Valle",
      archive: "Repositorio Académico Nacional",
    });
    expect(fields).toMatchObject({
      type: "thesis",
      thesisType: "masters",
      unpublished: false,
      institution: "Universidad del Valle",
      archive: "Repositorio Académico Nacional",
    });
  });
});

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
});

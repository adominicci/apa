import { describe, expect, it } from "vitest";
import { type CrossrefWork, mapCrossrefWork } from "./crossref.ts";

describe("mapCrossrefWork", () => {
  it("maps a journal article with authors, date parts, and pages", () => {
    const work: CrossrefWork = {
      type: "journal-article",
      author: [
        { family: "Salgado", given: "Nora" },
        { family: "Ferrer", given: "Hugo" },
      ],
      title: ["Hábitos de lectura en pantallas"],
      "container-title": ["Revista de Estudios Imaginarios"],
      issued: { "date-parts": [[2020, 7, 3]] },
      volume: "12",
      issue: "3",
      page: "45-67",
      DOI: "10.1234/rei.2020.045",
    };
    expect(mapCrossrefWork(work, "ref-1")).toEqual({
      id: "ref-1",
      type: "journalArticle",
      authors: [
        { kind: "person", family: "Salgado", given: "Nora" },
        { kind: "person", family: "Ferrer", given: "Hugo" },
      ],
      date: { year: 2020, month: 7, day: 3 },
      title: "Hábitos de lectura en pantallas",
      doi: "10.1234/rei.2020.045",
      journal: "Revista de Estudios Imaginarios",
      volume: "12",
      issue: "3",
      pageStart: "45",
      pageEnd: "67",
    });
  });

  it("maps group authors and missing dates", () => {
    const work: CrossrefWork = {
      type: "journal-article",
      author: [{ name: "Consejo Nacional de Lectura" }],
      title: ["Panorama anual"],
      "container-title": ["Boletines"],
      issued: {},
    };
    const ref = mapCrossrefWork(work, "ref-2");
    expect(ref?.authors).toEqual([
      { kind: "group", name: "Consejo Nacional de Lectura" },
    ]);
    expect(ref?.date).toEqual({ noDate: true });
  });

  it("maps books with publisher", () => {
    const work: CrossrefWork = {
      type: "book",
      author: [{ family: "Padilla", given: "Elena" }],
      title: ["Fundamentos de la escritura académica"],
      issued: { "date-parts": [[2017]] },
      publisher: "Ediciones Cardenal",
      DOI: "10.9999/fea",
    };
    const ref = mapCrossrefWork(work, "ref-3");
    expect(ref?.type).toBe("book");
    expect(ref && "publisher" in ref ? ref.publisher : "").toBe(
      "Ediciones Cardenal",
    );
  });

  it("maps book chapters with editors and book title", () => {
    const work: CrossrefWork = {
      type: "book-chapter",
      author: [{ family: "Zamora", given: "Félix" }],
      editor: [{ family: "Navarro", given: "Iris" }],
      title: ["Redactar con intención"],
      "container-title": ["Manual de técnicas de estudio"],
      issued: { "date-parts": [[2019]] },
      page: "85-104",
      publisher: "Ediciones Norlago",
    };
    const ref = mapCrossrefWork(work, "ref-4");
    expect(ref?.type).toBe("bookChapter");
    if (ref?.type === "bookChapter") {
      expect(ref.bookTitle).toBe("Manual de técnicas de estudio");
      expect(ref.editors).toEqual([
        { kind: "person", family: "Navarro", given: "Iris" },
      ]);
      expect(ref.pageStart).toBe("85");
    }
  });

  it("returns null for unsupported types or missing titles", () => {
    expect(
      mapCrossrefWork({ type: "dataset", title: ["Datos"] }, "x"),
    ).toBeNull();
    expect(mapCrossrefWork({ type: "journal-article" }, "x")).toBeNull();
  });
});

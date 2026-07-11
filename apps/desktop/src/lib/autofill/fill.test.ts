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

  it("prefills chapters with editors, book title, and pages", () => {
    const fields = refToQuickFields({
      id: "c",
      type: "bookChapter",
      authors: [{ kind: "person", family: "Zamora", given: "Félix" }],
      date: { year: 2019 },
      title: "Redactar con intención",
      editors: [{ kind: "person", family: "Navarro", given: "Iris" }],
      bookTitle: "Manual de técnicas de estudio",
      pageStart: "85",
      pageEnd: "104",
      publisher: "Ediciones Norlago",
    });
    expect(fields).toMatchObject({
      type: "bookChapter",
      editorsText: "Navarro, Iris",
      bookTitle: "Manual de técnicas de estudio",
      pages: "85–104",
      publisher: "Ediciones Norlago",
    });
  });

  it("prefills full dates for media types", () => {
    const fields = refToQuickFields({
      id: "v",
      type: "video",
      authors: [{ kind: "person", family: "Pérez", given: "Juana" }],
      username: "Aula Abierta",
      date: { year: 2021, month: 3, day: 2 },
      title: "Cómo estructurar tu primera revisión",
      platform: "YouTube",
    });
    expect(fields).toMatchObject({
      type: "video",
      username: "Aula Abierta",
      platform: "YouTube",
      year: "2021",
      month: "3",
      day: "2",
    });
  });

  it("prefills conference papers, social media, and software", () => {
    expect(
      refToQuickFields({
        id: "cf",
        type: "conferencePaper",
        authors: [],
        date: { year: 2023, month: 9, day: 5 },
        dayEnd: 8,
        title: "Rúbricas que viajan",
        conferenceName: "Congreso Imaginario",
        location: "Bogotá, Colombia",
      }),
    ).toMatchObject({
      conferenceName: "Congreso Imaginario",
      location: "Bogotá, Colombia",
      dayEnd: "8",
    });
    expect(
      refToQuickFields({
        id: "sm",
        type: "socialMedia",
        authors: [],
        username: "@mvela_lee",
        date: { year: 2024 },
        title: "Leer veinte páginas al día",
        platform: "X",
        contentType: "Tuit",
      }),
    ).toMatchObject({ username: "@mvela_lee", contentType: "Tuit" });
    expect(
      refToQuickFields({
        id: "sw",
        type: "software",
        kind: "dataset",
        authors: [],
        date: { year: 2023 },
        title: "Panel de hábitos",
        version: "1.2",
      }),
    ).toMatchObject({ softwareKind: "dataset", version: "1.2" });
  });

  it("prefills theses and undated works", () => {
    const fields = refToQuickFields({
      id: "t",
      type: "thesis",
      authors: [{ kind: "person", family: "Vargas", given: "Óscar" }],
      date: { noDate: true },
      title: "Estrategias de revisión",
      thesisType: "masters",
      institution: "Universidad del Valle",
    });
    expect(fields).toMatchObject({
      type: "thesis",
      thesisType: "masters",
      noDate: true,
      year: "",
      institution: "Universidad del Valle",
    });
  });
});

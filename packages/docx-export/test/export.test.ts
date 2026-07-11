import { strFromU8, unzipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import type { Reference } from "@tesina/engine";
import { exportDocx, type ExportInput } from "../src/index.ts";

const salgado: Reference = {
  id: "ref-salgado",
  type: "journalArticle",
  authors: [{ kind: "person", family: "Salgado", given: "Nora" }],
  date: { year: 2020 },
  title: "Hábitos de lectura en pantallas",
  journal: "Revista de Estudios Imaginarios",
  volume: "12",
  issue: "3",
  pageStart: "45",
  pageEnd: "67",
  doi: "10.1234/rei.2020.045",
};

const padilla: Reference = {
  id: "ref-padilla",
  type: "book",
  authors: [{ kind: "person", family: "Padilla", given: "Elena" }],
  date: { year: 2017 },
  title: "Fundamentos de la escritura académica",
  edition: "2",
  publisher: "Ediciones Cardenal",
};

function sampleInput(
  overrides: Partial<ExportInput["settings"]> = {},
): ExportInput {
  return {
    settings: {
      documentLanguage: "es",
      variant: "student",
      font: "times-new-roman-12",
      paperSize: "us-letter",
      ...overrides,
    },
    titlePage: {
      title: "Hábitos de lectura en la universidad",
      authors: ["Ana María Ruiz"],
      affiliations: ["Departamento de Educación, Universidad del Valle"],
      course: "EDU 301",
      instructor: "Dra. Carmen Solís",
      dueDate: "2026-07-11",
    },
    references: [salgado, padilla],
    content: {
      type: "doc",
      content: [
        {
          type: "sectionAbstract",
          content: [
            {
              type: "paragraph",
              content: [{
                type: "text",
                text: "Resumen breve del estudio de lectura.",
              }],
            },
            {
              type: "keywordsLine",
              content: [{ type: "text", text: "lectura, pantallas" }],
            },
          ],
        },
        {
          type: "sectionBody",
          content: [
            {
              type: "heading",
              attrs: { level: 1 },
              content: [{
                type: "text",
                text: "Hábitos de lectura en la universidad",
              }],
            },
            {
              type: "paragraph",
              content: [
                { type: "text", text: "La lectura en pantalla domina " },
                {
                  type: "citation",
                  attrs: {
                    items: [{ refId: "ref-salgado" }],
                    mode: "parenthetical",
                  },
                },
                { type: "text", text: " el aula." },
              ],
            },
            {
              type: "heading",
              attrs: { level: 4 },
              content: [{ type: "text", text: "Detalle menor" }],
            },
            {
              type: "paragraph",
              content: [{
                type: "text",
                text: "El párrafo que sigue al encabezado nivel cuatro.",
              }],
            },
            {
              type: "blockquote",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Una cita textual larga con su fuente ",
                    },
                    {
                      type: "citation",
                      attrs: {
                        items: [{
                          refId: "ref-padilla",
                          locator: { type: "page", value: "34" },
                        }],
                        mode: "parenthetical",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "sectionAppendix",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Material complementario." }],
            },
          ],
        },
      ],
    },
  };
}

let documentXml = "";
let stylesXml = "";
let headerXml = "";

beforeAll(async () => {
  const bytes = await exportDocx(sampleInput());
  const files = unzipSync(bytes);
  documentXml = strFromU8(files["word/document.xml"]!);
  stylesXml = strFromU8(files["word/styles.xml"]!);
  const headerName = Object.keys(files).find((n) =>
    /^word\/header\d*\.xml$/.test(n)
  )!;
  headerXml = strFromU8(files[headerName]!);
});

describe("exportDocx (student, es)", () => {
  it("renders the title page with localized due date", () => {
    expect(documentXml).toContain("Hábitos de lectura en la universidad");
    expect(documentXml).toContain("Ana María Ruiz");
    expect(documentXml).toContain("11 de julio de 2026");
  });

  it("renders localized section headings on new pages", () => {
    expect(documentXml).toContain("Resumen");
    expect(documentXml).toContain("Apéndice");
    expect(documentXml).toContain("Referencias");
    expect(documentXml).toMatch(/w:pageBreakBefore/);
  });

  it("does not letter a lone appendix", () => {
    expect(documentXml).not.toContain("Apéndice A");
  });

  it("renders citations through the engine", () => {
    expect(documentXml).toContain("(Salgado, 2020)");
    expect(documentXml).toContain("(Padilla, 2017, p. 34)");
  });

  it("merges level-4 headings run-in with the following paragraph", () => {
    expect(documentXml).toContain("Detalle menor. ");
    expect(documentXml).not.toMatch(/w:pStyle w:val="Heading4"/);
  });

  it("renders the keywords label in italics", () => {
    expect(documentXml).toContain("Palabras clave:");
  });

  it("renders reference entries with hanging indent and engine formatting", () => {
    expect(stylesXml).toMatch(/w:hanging="720"/);
    expect(documentXml).toContain("Salgado, N. (2020). Hábitos de lectura");
    expect(documentXml).toContain("(2.ª ed.)");
  });

  it("uses a page-number-only header for the student variant", () => {
    expect(headerXml).toContain("PAGE");
    expect(headerXml).not.toContain("HÁBITOS");
  });
});

describe("exportDocx (professional, en)", () => {
  it("adds the uppercased running head and author note", async () => {
    const input = sampleInput({
      documentLanguage: "en",
      variant: "professional",
      runningHead: "Reading habits",
    });
    input.titlePage.authorNote = "Sin conflictos de interés que declarar.";
    const bytes = await exportDocx(input);
    const files = unzipSync(bytes);
    const doc = strFromU8(files["word/document.xml"]!);
    const headerName = Object.keys(files).find((n) =>
      /^word\/header\d*\.xml$/.test(n)
    )!;
    const header = strFromU8(files[headerName]!);
    expect(header).toContain("READING HABITS");
    expect(doc).toContain("Author Note");
    expect(doc).toContain("Abstract");
    expect(doc).toContain("References");
    expect(doc).toContain("(Salgado, 2020)");
  });
});

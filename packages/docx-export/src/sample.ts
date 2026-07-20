import type { Reference } from "@tesina/engine";
import type { ExportInput, MathNode } from "./input.ts";

/** Shorthand mirroring the MathML tag/children shape (see math.test.ts). */
function el(tag: string, ...children: MathNode[]): MathNode {
  return { tag, children };
}
function leaf(tag: string, text: string): MathNode {
  return { tag, text };
}

/** "E = mc^2": mapea limpio a OMML (mi/mo/mi + msup). */
const SUPPORTED_EQUATION_LATEX = "E = mc^2";
const supportedEquationTree: MathNode = el(
  "mrow",
  leaf("mi", "E"),
  leaf("mo", "="),
  leaf("mi", "m"),
  el("msup", leaf("mi", "c"), leaf("mn", "2")),
);

/**
 * Una matriz 2x2: `docx` no expone ningún tipo `m:m` (matriz) — techo real de
 * la librería, no recorte del mapeador — así que `mathTreeToOmml` la rechaza
 * y el exportador debe caer al LaTeX crudo en vez de fallar todo el export.
 */
const UNSUPPORTED_EQUATION_LATEX =
  "\\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}";
const unsupportedEquationTree: MathNode = el(
  "mtable",
  el("mtr", leaf("mn", "1"), leaf("mn", "0")),
  el("mtr", leaf("mn", "0"), leaf("mn", "1")),
);

/**
 * A complete invented sample essay exercising every exporter feature:
 * abstract with keywords, headings (including a run-in level 4), citations,
 * a block quote with locator, an appendix, and two reference types. Used by
 * the golden tests and by the manual-verification sample generator.
 */
export function sampleEssayInput(
  overrides: Partial<ExportInput["settings"]> = {},
): ExportInput {
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
    equations: {
      [SUPPORTED_EQUATION_LATEX]: supportedEquationTree,
      [UNSUPPORTED_EQUATION_LATEX]: unsupportedEquationTree,
    },
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
            {
              type: "apaTable",
              content: [
                {
                  type: "tableTitle",
                  content: [{
                    type: "text",
                    text: "Horas de lectura por semana",
                  }],
                },
                {
                  type: "table",
                  content: [
                    {
                      type: "tableRow",
                      content: [
                        {
                          type: "tableHeader",
                          content: [{
                            type: "paragraph",
                            content: [{ type: "text", text: "Grupo" }],
                          }],
                        },
                        {
                          type: "tableHeader",
                          content: [{
                            type: "paragraph",
                            content: [{ type: "text", text: "Media" }],
                          }],
                        },
                      ],
                    },
                    {
                      type: "tableRow",
                      content: [
                        {
                          type: "tableCell",
                          content: [{
                            type: "paragraph",
                            content: [{ type: "text", text: "Primer año" }],
                          }],
                        },
                        {
                          type: "tableCell",
                          content: [{
                            type: "paragraph",
                            content: [{ type: "text", text: "4.2" }],
                          }],
                        },
                      ],
                    },
                  ],
                },
                {
                  type: "tableNote",
                  content: [{
                    type: "text",
                    text: "Datos inventados para el ejemplo.",
                  }],
                },
              ],
            },
            {
              type: "figure",
              content: [
                {
                  type: "figureTitle",
                  content: [{ type: "text", text: "Distribución por curso" }],
                },
                {
                  type: "figureImage",
                  attrs: { src: "essays/assets/sample-fig.png" },
                },
                {
                  type: "figureNote",
                  content: [{ type: "text", text: "Elaboración propia." }],
                },
              ],
            },
            {
              type: "orderedList",
              attrs: { listStyle: "lower-alpha" },
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Primer criterio" }],
                    },
                    {
                      type: "bulletList",
                      content: [
                        {
                          type: "listItem",
                          content: [
                            {
                              type: "paragraph",
                              content: [{
                                type: "text",
                                text: "Matiz anidado",
                              }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Segundo criterio" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "apaEquation",
              attrs: { latex: SUPPORTED_EQUATION_LATEX },
            },
            {
              type: "apaEquation",
              attrs: { latex: UNSUPPORTED_EQUATION_LATEX },
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

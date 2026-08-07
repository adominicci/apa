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
 * "\sigma_x": deliberately has NO entry in the `equations` map below — this
 * is the path every real export takes today, since `exportEssay.ts` doesn't
 * populate the map yet. The visitor must fall back to the raw LaTeX text
 * exactly as it does for a rejected tree, without ever calling
 * `mathTreeToOmml`.
 */
const UNMAPPED_EQUATION_LATEX = "\\sigma_x";

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
      course: "EDU 301: Fundamentos de la educación",
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
              content: [
                { type: "text", text: "RUN IN HEADING CITATION " },
                {
                  type: "citation",
                  attrs: {
                    items: [{ refId: "ref-salgado" }],
                    mode: "parenthetical",
                  },
                },
              ],
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
                          content: [
                            {
                              type: "paragraph",
                              content: [{ type: "text", text: "Primer año" }],
                            },
                            {
                              type: "paragraph",
                              content: [{
                                type: "text",
                                text: "Segundo bloque de celda",
                                marks: [{ type: "italic" }],
                              }],
                            },
                            {
                              type: "blockquote",
                              content: [
                                {
                                  type: "heading",
                                  attrs: { level: 3 },
                                  content: [{
                                    type: "text",
                                    text: "TABLE CELL BLOCKQUOTE HEADING",
                                  }],
                                },
                                {
                                  type: "paragraph",
                                  content: [{
                                    type: "text",
                                    text: "Quoted cell introduction",
                                  }],
                                },
                                {
                                  type: "orderedList",
                                  attrs: { listStyle: "lower-alpha" },
                                  content: [{
                                    type: "listItem",
                                    content: [{
                                      type: "paragraph",
                                      content: [
                                        {
                                          type: "text",
                                          text:
                                            "TABLE CELL BLOCKQUOTE LIST ITEM ",
                                          marks: [{ type: "bold" }],
                                        },
                                        {
                                          type: "citation",
                                          attrs: {
                                            items: [{
                                              refId: "ref-padilla",
                                            }],
                                            mode: "parenthetical",
                                          },
                                        },
                                      ],
                                    }],
                                  }],
                                },
                              ],
                            },
                          ],
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
                      type: "paragraph",
                      content: [{
                        type: "text",
                        text: "Continuación del primer criterio",
                      }],
                    },
                    {
                      type: "apaTable",
                      content: [
                        {
                          type: "tableTitle",
                          content: [{
                            type: "text",
                            text: "Tabla dentro de la lista",
                          }],
                        },
                        {
                          type: "table",
                          content: [{
                            type: "tableRow",
                            content: [{
                              type: "tableHeader",
                              content: [{
                                type: "paragraph",
                                content: [{ type: "text", text: "Dato" }],
                              }],
                            }],
                          }],
                        },
                        { type: "tableNote" },
                      ],
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
                            {
                              type: "paragraph",
                              content: [{
                                type: "text",
                                text: "Continuación del matiz",
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
              type: "paragraph",
              content: [{
                type: "text",
                text: "Párrafo posterior a la lista",
              }],
            },
            {
              type: "apaEquation",
              attrs: { latex: SUPPORTED_EQUATION_LATEX },
            },
            {
              type: "apaEquation",
              attrs: { latex: UNSUPPORTED_EQUATION_LATEX },
            },
            {
              type: "apaEquation",
              attrs: { latex: UNMAPPED_EQUATION_LATEX },
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

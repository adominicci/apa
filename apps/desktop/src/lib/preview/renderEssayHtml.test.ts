import { describe, expect, it } from "vitest";
import type { Reference } from "@tesina/engine";
import { createEmptyEssay } from "$lib/model/essay";
import { renderEssayCss, renderEssayHtml } from "./renderEssayHtml.ts";

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
};

function sampleEssay() {
  const essay = createEmptyEssay("es", "2026-07-11T12:00:00.000Z");
  essay.titlePage = {
    title: "Hábitos de lectura <en> la universidad",
    authors: ["Ana María Ruiz"],
    affiliations: ["Departamento de Educación"],
    dueDate: "2026-07-11",
  };
  essay.content = {
    type: "doc",
    content: [
      {
        type: "sectionAbstract",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Resumen breve." }],
          },
          {
            type: "keywordsLine",
            content: [{ type: "text", text: "lectura" }],
          },
        ],
      },
      {
        type: "sectionBody",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Título del cuerpo" }],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Como muestra " },
              {
                type: "citation",
                attrs: {
                  items: [{ refId: "ref-salgado" }],
                  mode: "narrative",
                },
              },
              { type: "text", text: ", el hábito cambia." },
            ],
          },
        ],
      },
      {
        type: "sectionAppendix",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Anexo único." }],
          },
        ],
      },
    ],
  };
  return essay;
}

function listEssay() {
  const essay = createEmptyEssay("es", "2026-07-11T12:00:00.000Z");
  essay.content = {
    type: "doc",
    content: [
      {
        type: "sectionBody",
        content: [
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
                            content: [{ type: "text", text: "Matiz anidado" }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  return essay;
}

describe("renderEssayHtml", () => {
  it("renders title page, sections, citations, and references", () => {
    const html = renderEssayHtml(sampleEssay(), sampleEssay().content, [
      salgado,
    ]);
    expect(html).toContain("Hábitos de lectura &lt;en&gt; la universidad");
    expect(html).toContain("11 de julio de 2026");
    expect(html).toContain("<h1>Resumen</h1>");
    expect(html).toContain("Palabras clave:");
    expect(html).toContain("Salgado (2020)");
    expect(html).toContain("<h1>Apéndice</h1>");
    expect(html).not.toContain("Apéndice A");
    expect(html).toContain("<h1>Referencias</h1>");
    expect(html).toContain('class="ref-entry"');
    expect(html).toContain("<em>Revista de Estudios Imaginarios, 12</em>");
  });

  it("renders an APA table with number, title, grid, and note", () => {
    const essay = createEmptyEssay("es", "2026-07-11T12:00:00.000Z");
    essay.content = {
      type: "doc",
      content: [
        {
          type: "sectionBody",
          content: [
            {
              type: "apaTable",
              content: [
                {
                  type: "tableTitle",
                  content: [{ type: "text", text: "Horas de lectura" }],
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
                      ],
                    },
                  ],
                },
                {
                  type: "tableNote",
                  content: [{ type: "text", text: "Datos inventados." }],
                },
              ],
            },
          ],
        },
      ],
    };
    const html = renderEssayHtml(essay, essay.content, []);
    expect(html).toContain('<figure class="apa-table">');
    expect(html).toContain("Tabla 1");
    expect(html).toContain("<em>Horas de lectura</em>");
    expect(html).toContain("<th>Grupo</th>");
    expect(html).toContain("<td>Primer año</td>");
    expect(html).toContain("Nota.");
  });

  it("renders an APA figure with number, title, image URL, and note", () => {
    const essay = createEmptyEssay("es", "2026-07-11T12:00:00.000Z");
    essay.content = {
      type: "doc",
      content: [
        {
          type: "sectionBody",
          content: [
            {
              type: "figure",
              content: [
                {
                  type: "figureTitle",
                  content: [{ type: "text", text: "Distribución" }],
                },
                {
                  type: "figureImage",
                  attrs: { src: "essays/assets/x.png" },
                },
                {
                  type: "figureNote",
                  content: [{ type: "text", text: "Propia." }],
                },
              ],
            },
          ],
        },
      ],
    };
    const urls = new Map([["essays/assets/x.png", "blob:fake-url"]]);
    const html = renderEssayHtml(essay, essay.content, [], urls);
    expect(html).toContain('<figure class="apa-figure">');
    expect(html).toContain("Figura 1");
    expect(html).toContain("<em>Distribución</em>");
    expect(html).toContain('src="blob:fake-url"');
    expect(html).toContain("Nota.");
  });

  it("renders lettered lists with type=a and nested sublists", () => {
    const essay = listEssay();
    const html = renderEssayHtml(essay, essay.content, []);
    expect(html).toContain('<ol type="a">');
    expect(html).toContain("Primer criterio");
    // The nested bullet list stays inside its parent <li>.
    expect(html).toMatch(
      /<li>Primer criterio<ul><li>Matiz anidado<\/li><\/ul>/,
    );
  });

  it("cascades a nested numbered list to letters (1 → a)", () => {
    const essay = createEmptyEssay("es", "2026-07-11T12:00:00.000Z");
    essay.content = {
      type: "doc",
      content: [
        {
          type: "sectionBody",
          content: [
            {
              type: "orderedList",
              attrs: { listStyle: "decimal" },
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Paso uno" }],
                    },
                    {
                      type: "orderedList",
                      attrs: { listStyle: "decimal" },
                      content: [
                        {
                          type: "listItem",
                          content: [
                            {
                              type: "paragraph",
                              content: [{ type: "text", text: "Subpaso" }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const html = renderEssayHtml(essay, essay.content, []);
    // Top level numbered, nested level lettered.
    expect(html).toContain('<ol type="1"><li>Paso uno');
    expect(html).toContain('<ol type="a"><li>Subpaso');
  });

  it("emits the running-head setter only for professional essays", () => {
    const student = sampleEssay();
    expect(renderEssayHtml(student, student.content, [])).not.toContain(
      "rh-set",
    );
    const pro = sampleEssay();
    pro.settings.variant = "professional";
    pro.settings.runningHead = "Hábitos de lectura";
    expect(renderEssayHtml(pro, pro.content, [])).toContain(
      'class="rh-set">HÁBITOS DE LECTURA</span>',
    );
  });
});

describe("renderEssayCss", () => {
  it("sets page size and margin per settings", () => {
    const essay = sampleEssay();
    const css = renderEssayCss(essay.settings);
    expect(css).toContain("size: letter;");
    expect(css).toContain("margin: 1in;");
    expect(css).toContain("counter(page)");
    expect(css).not.toContain("@top-left");
    essay.settings.paperSize = "a4";
    essay.settings.variant = "professional";
    const proCss = renderEssayCss(essay.settings);
    expect(proCss).toContain("size: A4;");
    expect(proCss).toContain("@top-left");
  });

  it("indents nested lists 0.5in per level, matching the editor and DOCX", () => {
    const essay = sampleEssay();
    const css = renderEssayCss(essay.settings);
    // Top-level lists sit one inch in from the page margin.
    expect(css).toContain("ul, ol { margin: 0; padding-left: 1in; }");
    // Each nested level adds only half an inch (as apa.css and styles.ts do),
    // instead of inheriting a full inch per level and over-indenting.
    expect(css).toContain("li ul, li ol { padding-left: 0.5in; }");
  });

  it("applies the chosen APA font family and point size", () => {
    const essay = sampleEssay();
    // Default: Times New Roman 12 pt.
    expect(renderEssayCss(essay.settings)).toContain(
      `font-family: "Times New Roman", Times, Georgia, serif; font-size: 12pt`,
    );
    essay.settings.font = "georgia-11";
    expect(renderEssayCss(essay.settings)).toContain(
      `font-family: Georgia, "Times New Roman", serif; font-size: 11pt`,
    );
    essay.settings.font = "lucida-sans-unicode-10";
    const css = renderEssayCss(essay.settings);
    expect(css).toContain("Lucida Sans Unicode");
    expect(css).toContain("font-size: 10pt");
    essay.settings.font = "aptos-12";
    const aptosCss = renderEssayCss(essay.settings);
    expect(aptosCss).toContain("Aptos");
    expect(aptosCss).toContain("font-size: 12pt");
  });
});

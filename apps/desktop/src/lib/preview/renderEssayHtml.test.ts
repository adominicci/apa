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
          {
            type: "paragraph",
            content: [{ type: "text", text: "Párrafo posterior a la lista" }],
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
    const title = "Hábitos de lectura &lt;en&gt; la universidad";
    expect(html.match(new RegExp(title, "g"))).toHaveLength(2);
    expect(html).toContain(
      `<section class="body-sec"><h1 class="body-title">${title}</h1>`,
    );
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

  it("renders a shared-affiliation byline without superscript numbers", () => {
    const essay = sampleEssay();
    essay.titlePage.authors = ["Ana María Ruiz", "Jordan Lee"];
    essay.titlePage.affiliations = ["Departamento de Educación"];

    const html = renderEssayHtml(essay, essay.content, []);

    expect(html).toContain(
      '<p class="tp-authors">Ana María Ruiz y Jordan Lee</p>',
    );
    expect(html).toContain(
      '<p class="tp-affiliation">Departamento de Educación</p>',
    );
    expect(html.match(/<p class="tp-(?:authors|affiliation)">.*?<\/p>/g))
      .not.toContainEqual(expect.stringContaining("<sup>"));
  });

  it("links different author affiliations with superscript numbers", () => {
    const essay = createEmptyEssay("en", "2026-07-11T12:00:00.000Z");
    essay.titlePage = {
      title: "Reading Habits",
      authors: ["Ana Ruiz", "Jordan Lee", "Lucía Pérez"],
      affiliations: [
        "University of Puerto Rico",
        "Caribbean College",
        "University of Puerto Rico",
      ],
      course: "EDU 301",
      instructor: "Dr. Rivera",
      dueDate: "2026-08-07",
    };

    const html = renderEssayHtml(essay, essay.content, []);

    expect(html).toContain(
      '<p class="tp-authors">Ana Ruiz<sup>1</sup>, Jordan Lee<sup>2</sup>, and Lucía Pérez<sup>1</sup></p>',
    );
    expect(html).toContain(
      '<p class="tp-affiliation"><sup>1</sup>University of Puerto Rico</p>',
    );
    expect(html).toContain(
      '<p class="tp-affiliation"><sup>2</sup>Caribbean College</p>',
    );
  });

  it("orders references between the body and multiple appendices", () => {
    const essay = sampleEssay();
    essay.content = {
      type: "doc",
      content: [
        {
          type: "sectionBody",
          content: [{
            type: "paragraph",
            content: [{ type: "text", text: "Body order marker" }],
          }],
        },
        {
          type: "sectionAppendix",
          content: [{
            type: "paragraph",
            content: [{ type: "text", text: "First appendix marker" }],
          }],
        },
        {
          type: "sectionAppendix",
          content: [{
            type: "paragraph",
            content: [{ type: "text", text: "Second appendix marker" }],
          }],
        },
      ],
    };

    const html = renderEssayHtml(essay, essay.content, [salgado]);
    const body = html.indexOf("Body order marker");
    const references = html.indexOf('<section class="references">');
    const appendixA = html.indexOf("First appendix marker");
    const appendixB = html.indexOf("Second appendix marker");

    expect(body).toBeGreaterThan(-1);
    expect(references).toBeGreaterThan(body);
    expect(appendixA).toBeGreaterThan(references);
    expect(appendixB).toBeGreaterThan(appendixA);
    expect(html).toContain("<h1>Apéndice A</h1>");
    expect(html).toContain("<h1>Apéndice B</h1>");
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

  it("renders APA equations with MathML and a right-aligned number that increments", () => {
    const essay = createEmptyEssay("es", "2026-07-11T12:00:00.000Z");
    essay.content = {
      type: "doc",
      content: [
        {
          type: "sectionBody",
          content: [
            { type: "apaEquation", attrs: { latex: "E = mc^2" } },
            { type: "apaEquation", attrs: { latex: "a^2 + b^2 = c^2" } },
          ],
        },
      ],
    };
    const mathml = new Map([
      ["E = mc^2", "<math><mi>E</mi></math>"],
      ["a^2 + b^2 = c^2", "<math><mi>a</mi></math>"],
    ]);
    const html = renderEssayHtml(
      essay,
      essay.content,
      [],
      new Map(),
      mathml,
    );
    expect(html).toContain(
      '<div class="apa-equation"><math><mi>E</mi></math><span class="eq-no">(1)</span></div>',
    );
    expect(html).toContain(
      '<div class="apa-equation"><math><mi>a</mi></math><span class="eq-no">(2)</span></div>',
    );
  });

  it("matches the complete APA equation preview markup", () => {
    const essay = createEmptyEssay("es", "2026-07-11T12:00:00.000Z");
    essay.content = {
      type: "doc",
      content: [{
        type: "sectionBody",
        content: [{ type: "apaEquation", attrs: { latex: "E = mc^2" } }],
      }],
    };
    const html = renderEssayHtml(
      essay,
      essay.content,
      [],
      new Map(),
      new Map([[
        "E = mc^2",
        "<math><mi>E</mi><mo>=</mo><msup><mi>c</mi><mn>2</mn></msup></math>",
      ]]),
    );
    expect(html).toMatchSnapshot();
  });

  it("falls back to escaped raw LaTeX when an equation has no MathML entry", () => {
    // Mirrors the editor (raw LaTeX in red mono) and the DOCX export (raw
    // LaTeX text run) for a construct Temml couldn't render — the preview
    // must not silently show an empty line with just the number, since it's
    // the pre-export check the user relies on to catch this.
    const essay = createEmptyEssay("es", "2026-07-11T12:00:00.000Z");
    essay.content = {
      type: "doc",
      content: [
        {
          type: "sectionBody",
          content: [
            {
              type: "apaEquation",
              attrs: { latex: "\\begin{matrix}a<b\\end{matrix}" },
            },
          ],
        },
      ],
    };
    const html = renderEssayHtml(
      essay,
      essay.content,
      [],
      new Map(),
      new Map(),
    );
    expect(html).toContain(
      '<div class="apa-equation">\\begin{matrix}a&lt;b\\end{matrix}<span class="eq-no">(1)</span></div>',
    );
  });

  it("renders an equation number the same way in English and Spanish", () => {
    // Unlike "Tabla N"/"Table N", "(1)" does not go through getTerms.
    const essayEs = createEmptyEssay("es", "2026-07-11T12:00:00.000Z");
    const essayEn = createEmptyEssay("en", "2026-07-11T12:00:00.000Z");
    const doc = {
      type: "doc",
      content: [
        {
          type: "sectionBody",
          content: [{ type: "apaEquation", attrs: { latex: "x" } }],
        },
      ],
    };
    essayEs.content = doc;
    essayEn.content = doc;
    expect(renderEssayHtml(essayEs, doc, [])).toContain(
      '<span class="eq-no">(1)</span>',
    );
    expect(renderEssayHtml(essayEn, doc, [])).toContain(
      '<span class="eq-no">(1)</span>',
    );
  });

  it("renders lettered lists with type=a and nested sublists", () => {
    const essay = listEssay();
    const html = renderEssayHtml(essay, essay.content, []);
    expect(html).toContain('<ol type="a">');
    expect(html).toContain(
      '<ol type="a"><li><p>Primer criterio</p>' +
        "<p>Continuación del primer criterio</p>",
    );
    expect(html).toContain('<figure class="apa-table">');
    // The nested bullet list stays inside its parent <li>.
    expect(html).toMatch(
      /<\/figure><ul><li><p>Matiz anidado<\/p><\/li><\/ul><\/li>/,
    );
    expect(html).toContain(
      "</ol><p>Párrafo posterior a la lista</p>",
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
    expect(html).toContain('<ol type="1"><li><p>Paso uno</p>');
    expect(html).toContain('<ol type="a"><li><p>Subpaso</p>');
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

  it("starts the body on a new page independently of an abstract", () => {
    const css = renderEssayCss(sampleEssay().settings);

    expect(css).toMatch(
      /section\.body-sec\s*\{[^}]*break-before:\s*page;/s,
    );
  });

  it("indents nested lists 0.5in per level, matching the editor and DOCX", () => {
    const essay = sampleEssay();
    const css = renderEssayCss(essay.settings);
    // Top-level lists sit one inch in from the page margin.
    expect(css).toContain("ul, ol { margin: 0; padding-left: 1in; }");
    // Each nested level adds only half an inch (as apa.css and styles.ts do),
    // instead of inheriting a full inch per level and over-indenting.
    expect(css).toContain("li ul, li ol { padding-left: 0.5in; }");
    expect(css).toContain("li > p { margin: 0; text-indent: 0; }");
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

  it("centers block equations with the number pinned to the right", () => {
    const essay = sampleEssay();
    const css = renderEssayCss(essay.settings);
    expect(css).toContain(
      ".apa-equation { display: flex; align-items: center; justify-content: center; position: relative;",
    );
    expect(css).toContain(
      ".apa-equation .eq-no { position: absolute; right: 0; }",
    );
  });
});

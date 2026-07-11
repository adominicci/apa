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
});

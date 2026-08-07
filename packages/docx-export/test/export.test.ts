import { Packer } from "docx";
import { strFromU8, unzipSync } from "fflate";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Reference } from "@tesina/engine";
import { exportDocx, type ExportImage, type PMJson } from "../src/index.ts";
import { sampleEssayInput as sampleInput } from "../src/sample.ts";

let documentXml = "";
let stylesXml = "";
let numberingXml = "";
let headerXml = "";

function paragraphContaining(text: string): string {
  const paragraphs = documentXml.match(/<w:p(?:>| [^>]*>)[\s\S]*?<\/w:p>/g) ??
    [];
  const paragraph = paragraphs.find((candidate) => candidate.includes(text));
  if (!paragraph) throw new Error(`Paragraph not found: ${text}`);
  return paragraph;
}

function paragraphsContaining(xml: string, text: string): string[] {
  return (xml.match(/<w:p(?:>| [^>]*>)[\s\S]*?<\/w:p>/g) ?? [])
    .filter((candidate) => candidate.includes(text));
}

function paragraphIndexContaining(xml: string, text: string): number {
  return (xml.match(/<w:p(?:>| [^>]*>)[\s\S]*?<\/w:p>/g) ?? [])
    .findIndex((candidate) => candidate.includes(text));
}

function tableCellContaining(text: string): string {
  const cells = documentXml.match(/<w:tc(?:>| [^>]*>)[\s\S]*?<\/w:tc>/g) ??
    [];
  const cell = cells.find((candidate) => candidate.includes(text));
  if (!cell) throw new Error(`Table cell not found: ${text}`);
  return cell;
}

function textRunContaining(paragraph: string, text: string): string {
  const runs = paragraph.match(/<w:r(?:>| [^>]*>)[\s\S]*?<\/w:r>/g) ?? [];
  const run = runs.find((candidate) => candidate.includes(text));
  if (!run) throw new Error(`Text run not found: ${text}`);
  return run;
}

function paragraphText(paragraph: string): string {
  return [...paragraph.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => match[1] ?? "")
    .join("");
}

function tableContaining(xml: string, text: string): string {
  const tables = xml.match(/<w:tbl(?:>| [^>]*>)[\s\S]*?<\/w:tbl>/g) ?? [];
  const table = tables.find((candidate) => candidate.includes(text));
  if (!table) throw new Error(`Table not found: ${text}`);
  return table;
}

function innermostTableContaining(xml: string, text: string): string {
  const markerIndex = xml.indexOf(text);
  if (markerIndex < 0) throw new Error(`Table marker not found: ${text}`);
  const tableStart = xml.lastIndexOf("<w:tbl>", markerIndex);
  const tableEnd = xml.indexOf("</w:tbl>", markerIndex);
  if (tableStart < 0 || tableEnd < 0) {
    throw new Error(`Table bounds not found: ${text}`);
  }
  return xml.slice(tableStart, tableEnd + "</w:tbl>".length);
}

function singleCellApaTable(title: string, cellText: string): PMJson {
  return {
    type: "apaTable",
    content: [
      {
        type: "tableTitle",
        content: [{ type: "text", text: title }],
      },
      {
        type: "table",
        content: [{
          type: "tableRow",
          content: [{
            type: "tableCell",
            content: [{
              type: "paragraph",
              content: [{ type: "text", text: cellText }],
            }],
          }],
        }],
      },
      { type: "tableNote" },
    ],
  };
}

const testPng = Uint8Array.from([
  137,
  80,
  78,
  71,
  13,
  10,
  26,
  10,
  0,
  0,
  0,
  13,
  73,
  72,
  68,
  82,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  1,
  8,
  6,
  0,
  0,
  0,
  31,
  21,
  196,
  137,
  0,
  0,
  0,
  13,
  73,
  68,
  65,
  84,
  120,
  156,
  99,
  100,
  96,
  96,
  96,
  0,
  0,
  0,
  5,
  0,
  1,
  135,
  165,
  172,
  137,
  0,
  0,
  0,
  0,
  73,
  69,
  78,
  68,
  174,
  66,
  96,
  130,
]);

function figureBlock(title: string, src: string): PMJson {
  return {
    type: "figure",
    content: [
      {
        type: "figureTitle",
        content: [{ type: "text", text: title }],
      },
      { type: "figureImage", attrs: { src } },
      { type: "figureNote" },
    ],
  };
}

function drawingExtents(xml: string): { cx: number; cy: number }[] {
  return [...xml.matchAll(/<wp:extent cx="([^"]+)" cy="([^"]+)"\/>/g)].map(
    (match) => ({ cx: Number(match[1]), cy: Number(match[2]) }),
  );
}

function testImage(width: number, height: number): ExportImage {
  return { data: testPng, type: "png", width, height };
}

function tableCell(
  content: PMJson[],
  attrs?: Record<string, unknown>,
): PMJson {
  return {
    type: "tableCell",
    ...(attrs ? { attrs } : {}),
    content,
  };
}

function apaTable(rows: PMJson[][]): PMJson {
  return {
    type: "apaTable",
    content: [
      { type: "tableTitle" },
      {
        type: "table",
        content: rows.map((content) => ({
          type: "tableRow",
          content,
        })),
      },
      { type: "tableNote" },
    ],
  };
}

function inputWithBody(
  content: PMJson[],
  images: Record<string, ExportImage>,
): ReturnType<typeof sampleInput> {
  const input = sampleInput();
  input.images = images;
  input.content = {
    type: "doc",
    content: [{ type: "sectionBody", content }],
  };
  return input;
}

const personalCommunication: Reference = {
  id: "ref-personal",
  type: "personalCommunication",
  authors: [{ kind: "person", family: "Salgado", given: "Nora" }],
  date: { year: 2026, month: 7, day: 3 },
  title: "Conversación sobre hábitos de lectura",
};

function inputCiting(refId: string) {
  const input = sampleInput();
  input.content = {
    type: "doc",
    content: [
      {
        type: "sectionBody",
        content: [{
          type: "paragraph",
          content: [{
            type: "citation",
            attrs: { items: [{ refId }], mode: "parenthetical" },
          }],
        }],
      },
      {
        type: "sectionAppendix",
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: "Appendix survives" }],
        }],
      },
    ],
  };
  return input;
}

async function documentXmlFor(
  input: ReturnType<typeof sampleInput>,
): Promise<string> {
  const files = unzipSync(await exportDocx(input));
  return strFromU8(files["word/document.xml"]!);
}

function numberingDefinitionContaining(format: string): string {
  const definitions = numberingXml.match(
    /<w:abstractNum(?:>| [^>]*>)[\s\S]*?<\/w:abstractNum>/g,
  ) ?? [];
  const definition = definitions.find((candidate) =>
    candidate.includes(`w:numFmt w:val="${format}"`)
  );
  if (!definition) throw new Error(`Numbering definition not found: ${format}`);
  return definition;
}

function numberingLevel(definition: string, level: number): string {
  const levels = definition.match(/<w:lvl(?:>| [^>]*>)[\s\S]*?<\/w:lvl>/g) ??
    [];
  const levelXml = levels.find((candidate) =>
    candidate.includes(`w:ilvl="${level}"`)
  );
  if (!levelXml) throw new Error(`Numbering level not found: ${level}`);
  return levelXml;
}

function numberingDefinitionForParagraph(paragraph: string): string {
  const numId = paragraph.match(/<w:numId w:val="([^"]+)"/)?.[1];
  if (!numId) throw new Error("Paragraph numbering ID not found");
  const instances = numberingXml.match(
    /<w:num w:numId="[^"]+">[\s\S]*?<\/w:num>/g,
  ) ?? [];
  const instance = instances.find((candidate) =>
    candidate.includes(`w:numId="${numId}"`)
  );
  if (!instance) throw new Error(`Numbering instance not found: ${numId}`);
  const abstractNumId = instance.match(
    /<w:abstractNumId w:val="([^"]+)"/,
  )?.[1];
  if (!abstractNumId) {
    throw new Error(`Abstract numbering ID not found: ${numId}`);
  }
  const definitions = numberingXml.match(
    /<w:abstractNum(?:>| [^>]*>)[\s\S]*?<\/w:abstractNum>/g,
  ) ?? [];
  const definition = definitions.find((candidate) =>
    candidate.includes(`w:abstractNumId="${abstractNumId}"`)
  );
  if (!definition) {
    throw new Error(`Numbering definition not found: ${abstractNumId}`);
  }
  return definition;
}

beforeAll(async () => {
  const bytes = await exportDocx(sampleInput());
  const files = unzipSync(bytes);
  documentXml = strFromU8(files["word/document.xml"]!);
  stylesXml = strFromU8(files["word/styles.xml"]!);
  numberingXml = strFromU8(files["word/numbering.xml"]!);
  const headerName = Object.keys(files).find((n) =>
    /^word\/header\d*\.xml$/.test(n)
  )!;
  headerXml = strFromU8(files[headerName]!);
});

describe("exportDocx (student, es)", () => {
  it("uses browser-safe ArrayBuffer packing", async () => {
    const toBuffer = vi.spyOn(Packer, "toBuffer").mockRejectedValue(
      new Error("nodebuffer is not supported by this platform"),
    );
    try {
      const bytes = await exportDocx(sampleInput());
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect([...bytes.slice(0, 4)]).toEqual([80, 75, 3, 4]);
      expect(unzipSync(bytes)["word/document.xml"]).toBeDefined();
    } finally {
      toBuffer.mockRestore();
    }
  });

  it("renders the title page with localized due date", () => {
    const titleParagraphs = paragraphsContaining(
      documentXml,
      "Hábitos de lectura en la universidad",
    );
    expect(titleParagraphs).toHaveLength(2);
    expect(titleParagraphs[1]).toContain('w:pStyle w:val="Heading1"');
    expect(titleParagraphs[1]).toContain("<w:pageBreakBefore/>");
    expect(titleParagraphs[1]).toContain("<w:b/>");
    expect(documentXml).toContain("Ana María Ruiz");
    expect(documentXml).toContain("11 de julio de 2026");
  });

  it("renders a shared-affiliation byline on one author line without superscripts", async () => {
    const input = sampleInput({ documentLanguage: "en" });
    input.titlePage.authors = ["Ana Ruiz", "Jordan Lee"];
    input.titlePage.affiliations = ["University of Puerto Rico"];
    const xml = await documentXmlFor(input);
    const byline = paragraphsContaining(xml, "Ana Ruiz").find((paragraph) =>
      paragraph.includes("Jordan Lee")
    );

    expect(byline).toContain("Ana Ruiz");
    expect(byline).toContain(" and ");
    expect(byline).toContain("Jordan Lee");
    expect(byline).not.toContain('w:vertAlign w:val="superscript"');
    expect(paragraphsContaining(xml, "University of Puerto Rico")[0])
      .not.toContain('w:vertAlign w:val="superscript"');
  });

  it("keeps personal communications in text without an empty references page", async () => {
    const input = inputCiting(personalCommunication.id);
    input.references = [personalCommunication];

    const xml = await documentXmlFor(input);

    expect(xml).toContain(
      "(N. Salgado, comunicación personal, 3 de julio de 2026)",
    );
    expect(xml).not.toContain("???");
    expect(xml).not.toContain("Referencias");
    expect(xml).toContain("Appendix survives");
  });

  it("renders one references page for mixed personal and retrievable sources", async () => {
    const input = inputCiting(personalCommunication.id);
    const retrievable = sampleInput().references.find(
      (reference) => reference.id === "ref-salgado",
    )!;
    input.references = [personalCommunication, retrievable];

    const xml = await documentXmlFor(input);

    expect(paragraphsContaining(xml, "Referencias")).toHaveLength(1);
    expect(xml).toContain("Salgado, N. (2020)");
    expect(xml).not.toContain("Conversación sobre hábitos de lectura");
  });

  it("renders numbered author-affiliation links as superscript runs", async () => {
    const input = sampleInput({ documentLanguage: "en" });
    input.titlePage.authors = ["Ana Ruiz", "Jordan Lee", "Lucía Pérez"];
    input.titlePage.affiliations = [
      "University of Puerto Rico",
      "Caribbean College",
      "University of Puerto Rico",
    ];
    const xml = await documentXmlFor(input);
    const byline = paragraphsContaining(xml, "Ana Ruiz").find((paragraph) =>
      paragraph.includes("Jordan Lee") && paragraph.includes("Lucía Pérez")
    );

    expect(byline?.match(/w:vertAlign w:val="superscript"/g)).toHaveLength(3);
    expect(paragraphsContaining(xml, "University of Puerto Rico")[0])
      .toContain('w:vertAlign w:val="superscript"');
    expect(paragraphsContaining(xml, "Caribbean College")[0]).toContain(
      'w:vertAlign w:val="superscript"',
    );
  });

  it("orders references between the body and multiple appendices", async () => {
    const input = sampleInput();
    input.content = {
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

    const xml = await documentXmlFor(input);
    const body = paragraphIndexContaining(xml, "Body order marker");
    const references = paragraphIndexContaining(xml, "Referencias");
    const appendixA = paragraphIndexContaining(xml, "First appendix marker");
    const appendixB = paragraphIndexContaining(xml, "Second appendix marker");

    expect(body).toBeGreaterThan(-1);
    expect(references).toBeGreaterThan(body);
    expect(appendixA).toBeGreaterThan(references);
    expect(appendixB).toBeGreaterThan(appendixA);
    expect(xml).toContain("Apéndice A");
    expect(xml).toContain("Apéndice B");
  });

  it.each([
    [
      "paragraph",
      { type: "paragraph", content: [{ type: "text", text: "Opening" }] },
    ],
    [
      "table",
      {
        type: "apaTable",
        content: [
          { type: "tableTitle", content: [{ type: "text", text: "Data" }] },
          {
            type: "table",
            content: [{
              type: "tableRow",
              content: [{
                type: "tableCell",
                content: [{
                  type: "paragraph",
                  content: [{ type: "text", text: "Cell" }],
                }],
              }],
            }],
          },
          { type: "tableNote" },
        ],
      },
    ],
    [
      "figure",
      {
        type: "figure",
        content: [
          {
            type: "figureTitle",
            content: [{ type: "text", text: "Distribution" }],
          },
          { type: "figureImage", attrs: { src: "missing.png" } },
          { type: "figureNote" },
        ],
      },
    ],
  ])("starts the body-title page before a leading %s", async (kind, block) => {
    const input = sampleInput({ documentLanguage: "en" });
    input.titlePage.title = `Body boundary ${kind}`;
    input.content = {
      type: "doc",
      content: [
        {
          type: "sectionAbstract",
          content: [{
            type: "paragraph",
            content: [{ type: "text", text: "Abstract text" }],
          }],
        },
        { type: "sectionBody", content: [block] },
      ],
    };

    const xml = await documentXmlFor(input);
    const titleParagraphs = paragraphsContaining(
      xml,
      `Body boundary ${kind}`,
    );

    expect(titleParagraphs).toHaveLength(2);
    expect(titleParagraphs[1]).toContain('w:pStyle w:val="Heading1"');
    expect(titleParagraphs[1]).toContain("<w:pageBreakBefore/>");
  });

  it("uses a matching authored leading H1 as the page-breaking body title", async () => {
    const input = sampleInput({ documentLanguage: "en" });
    input.titlePage.title = "Legacy Body Title";
    input.content = {
      type: "doc",
      content: [{
        type: "sectionBody",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Legacy Body Title" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Authored opening" }],
          },
        ],
      }],
    };

    const xml = await documentXmlFor(input);
    const titleParagraphs = paragraphsContaining(xml, "Legacy Body Title");

    expect(titleParagraphs).toHaveLength(2);
    expect(titleParagraphs[1]).toContain('w:pStyle w:val="Heading1"');
    expect(titleParagraphs[1]).toContain("<w:pageBreakBefore/>");
    expect(paragraphsContaining(xml, "Authored opening")).toHaveLength(1);
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
    const paragraph = paragraphContaining("RUN IN HEADING CITATION");
    const labelRun = textRunContaining(paragraph, "RUN IN HEADING CITATION");
    const citationRun = textRunContaining(paragraph, "(Salgado, 2020)");

    expect(paragraph).toContain("RUN IN HEADING CITATION");
    expect(paragraph).toContain("(Salgado, 2020)");
    expect(paragraph).toContain(". ");
    expect(labelRun).toContain("<w:b/>");
    expect(citationRun).toContain("<w:b/>");
    expect(paragraph).toContain(
      "El párrafo que sigue al encabezado nivel cuatro.",
    );
    expect(documentXml).not.toMatch(/w:pStyle w:val="Heading4"/);
  });

  it("keeps level-5 heading citations bold italic and continuation text plain", async () => {
    const input = sampleInput();
    input.content = {
      type: "doc",
      content: [{
        type: "sectionBody",
        content: [
          {
            type: "heading",
            attrs: { level: 5 },
            content: [
              { type: "text", text: "Level five citation " },
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
            content: [{ type: "text", text: "Plain continuation" }],
          },
        ],
      }],
    };
    const xml = await documentXmlFor(input);
    const paragraph = paragraphsContaining(xml, "Level five citation")[0]!;
    const citationRun = textRunContaining(paragraph, "(Salgado, 2020)");
    const continuationRun = textRunContaining(paragraph, "Plain continuation");

    expect(citationRun).toContain("<w:b/>");
    expect(citationRun).toContain("<w:i/>");
    expect(continuationRun).not.toContain("<w:b/>");
    expect(continuationRun).not.toContain("<w:i/>");
    expect(paragraph).not.toContain('w:pStyle w:val="Heading5"');
  });

  it.each([
    {
      level: 4,
      label: "Hard-break result ",
      marked: {
        type: "text",
        text: "marked.",
        marks: [{ type: "italic" }],
      },
      trailing: [{ type: "hardBreak" }],
      continuation: "Level four continuation ",
      expectedText:
        "Hard-break result (Consejo de Escritura Regional [CER], 2024) marked. Level four continuation (CER, 2024)",
      trailingXml: "<w:br/>",
    },
    {
      level: 5,
      label: "Whitespace result ",
      marked: {
        type: "text",
        text: "underlined.",
        marks: [{ type: "underline" }],
      },
      trailing: [{
        type: "text",
        text: "   ",
        marks: [{ type: "underline" }],
      }],
      continuation: "Level five continuation ",
      expectedText:
        "Whitespace result (Consejo de Escritura Regional [CER], 2024) underlined   . Level five continuation (CER, 2024)",
      trailingXml: '<w:t xml:space="preserve">   </w:t>',
    },
  ])(
    "normalizes the last meaningful text before level-$level trailing inline nodes",
    async (
      {
        level,
        label,
        marked,
        trailing,
        continuation,
        expectedText,
        trailingXml,
      },
    ) => {
      const groupReference: Reference = {
        id: "ref-trailing-regional-council",
        type: "journalArticle",
        authors: [{
          kind: "group",
          name: "Consejo de Escritura Regional",
          abbreviation: "CER",
        }],
        date: { year: 2024 },
        title: "Prácticas de escritura estudiantil",
        journal: "Revista Académica Inventada",
        volume: "4",
        pageStart: "1",
        pageEnd: "12",
      };
      const citation = {
        type: "citation",
        attrs: {
          items: [{ refId: groupReference.id }],
          mode: "parenthetical",
        },
      };
      const input = sampleInput();
      input.references = [groupReference];
      input.content = {
        type: "doc",
        content: [{
          type: "sectionBody",
          content: [
            {
              type: "heading",
              attrs: { level },
              content: [
                { type: "text", text: label },
                citation,
                { type: "text", text: " " },
                marked,
                ...trailing,
              ],
            },
            {
              type: "paragraph",
              content: [
                { type: "text", text: continuation },
                citation,
              ],
            },
          ],
        }],
      };

      const xml = await documentXmlFor(input);
      const paragraph = paragraphsContaining(xml, label.trim())[0]!;
      const markedText = marked.text.slice(0, -1);
      const markedRun = textRunContaining(paragraph, markedText);

      expect(paragraphText(paragraph)).toBe(expectedText);
      expect(markedRun).not.toContain(`${marked.text}</w:t>`);
      expect(markedRun).toContain(markedText);
      expect(paragraph).toContain(trailingXml);
      expect(paragraph).toContain("(CER, 2024)");
      if (level === 4) {
        expect(markedRun).toContain("<w:i/>");
      } else {
        const trailingRun = textRunContaining(paragraph, "   ");
        expect(markedRun).toContain('<w:u w:val="single"/>');
        expect(trailingRun).toContain('<w:u w:val="single"/>');
      }
    },
  );

  it("shares first-occurrence citation state from a table-cell list into a run-in heading", async () => {
    const groupReference: Reference = {
      id: "ref-regional-council",
      type: "journalArticle",
      authors: [{
        kind: "group",
        name: "Consejo de Escritura Regional",
        abbreviation: "CER",
      }],
      date: { year: 2024 },
      title: "Prácticas de escritura estudiantil",
      journal: "Revista Académica Inventada",
      volume: "4",
      pageStart: "1",
      pageEnd: "12",
    };
    const citation = {
      type: "citation",
      attrs: {
        items: [{ refId: groupReference.id }],
        mode: "parenthetical",
      },
    };
    const input = sampleInput();
    input.references = [groupReference];
    input.content = {
      type: "doc",
      content: [{
        type: "sectionBody",
        content: [
          {
            type: "apaTable",
            content: [
              {
                type: "tableTitle",
                content: [{ type: "text", text: "Citation order" }],
              },
              {
                type: "table",
                content: [{
                  type: "tableRow",
                  content: [{
                    type: "tableCell",
                    content: [{
                      type: "bulletList",
                      content: [{
                        type: "listItem",
                        content: [{
                          type: "paragraph",
                          content: [
                            { type: "text", text: "First citation " },
                            citation,
                          ],
                        }],
                      }],
                    }],
                  }],
                }],
              },
              { type: "tableNote" },
            ],
          },
          {
            type: "heading",
            attrs: { level: 4 },
            content: [
              { type: "text", text: "Later citation " },
              citation,
            ],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Continuation" }],
          },
        ],
      }],
    };

    const xml = await documentXmlFor(input);
    const first = paragraphsContaining(xml, "First citation")[0]!;
    const later = paragraphsContaining(xml, "Later citation")[0]!;

    expect(first).toContain(
      "(Consejo de Escritura Regional [CER], 2024)",
    );
    expect(first).toContain("<w:numPr>");
    expect(later).toContain("(CER, 2024)");
    expect(textRunContaining(later, "(CER, 2024)")).toContain("<w:b/>");
  });

  it("preserves and fits nested-quote table and figure content with shared counters", async () => {
    const groupReference: Reference = {
      id: "ref-nested-regional-council",
      type: "journalArticle",
      authors: [{
        kind: "group",
        name: "Consejo de Escritura Regional",
        abbreviation: "CER",
      }],
      date: { year: 2024 },
      title: "Prácticas de escritura estudiantil",
      journal: "Revista Académica Inventada",
      volume: "4",
      pageStart: "1",
      pageEnd: "12",
    };
    const citation = {
      type: "citation",
      attrs: {
        items: [{ refId: groupReference.id }],
        mode: "parenthetical",
      },
    };
    const input = sampleInput();
    input.references = [groupReference];
    input.content = {
      type: "doc",
      content: [{
        type: "sectionBody",
        content: [
          {
            type: "apaTable",
            content: [
              {
                type: "tableTitle",
                content: [{ type: "text", text: "Top-level table" }],
              },
              {
                type: "table",
                content: [{
                  type: "tableRow",
                  content: [{
                    type: "tableCell",
                    content: [{
                      type: "paragraph",
                      content: [{
                        type: "text",
                        text: "TOP LEVEL TABLE CELL",
                      }],
                    }],
                  }],
                }],
              },
              { type: "tableNote" },
            ],
          },
          {
            type: "figure",
            content: [
              {
                type: "figureTitle",
                content: [{ type: "text", text: "Top-level figure" }],
              },
              { type: "figureImage", attrs: { src: "missing-top.png" } },
              { type: "figureNote" },
            ],
          },
          {
            type: "blockquote",
            content: [{
              type: "blockquote",
              content: [
                {
                  type: "apaTable",
                  content: [
                    {
                      type: "tableTitle",
                      content: [
                        { type: "text", text: "NESTED QUOTE TABLE " },
                        citation,
                      ],
                    },
                    {
                      type: "table",
                      content: [{
                        type: "tableRow",
                        content: [{
                          type: "tableCell",
                          content: [{
                            type: "paragraph",
                            content: [{
                              type: "text",
                              text: "NESTED QUOTE TABLE CELL",
                            }],
                          }],
                        }],
                      }],
                    },
                    {
                      type: "tableNote",
                      content: [{
                        type: "text",
                        text: "Nested table note",
                      }],
                    },
                  ],
                },
                {
                  type: "figure",
                  content: [
                    {
                      type: "figureTitle",
                      content: [
                        { type: "text", text: "NESTED QUOTE FIGURE " },
                        citation,
                      ],
                    },
                    {
                      type: "figureImage",
                      attrs: { src: "missing-nested.png" },
                    },
                    {
                      type: "figureNote",
                      content: [{
                        type: "text",
                        text: "Nested figure note",
                      }],
                    },
                  ],
                },
              ],
            }],
          },
        ],
      }],
    };

    const xml = await documentXmlFor(input);
    const tableCaption = paragraphsContaining(xml, "Tabla 2")[0]!;
    const tableTitle = paragraphsContaining(xml, "NESTED QUOTE TABLE")[0]!;
    const tableNote = paragraphsContaining(xml, "Nested table note")[0]!;
    const topLevelTable = tableContaining(xml, "TOP LEVEL TABLE CELL");
    const table = tableContaining(xml, "NESTED QUOTE TABLE CELL");
    const figureCaption = paragraphsContaining(xml, "Figura 2")[0]!;
    const figureTitle = paragraphsContaining(xml, "NESTED QUOTE FIGURE")[0]!;
    const figureNote = paragraphsContaining(xml, "Nested figure note")[0]!;

    expect(xml).toContain("Tabla 1");
    expect(xml).toContain("Figura 1");
    expect(tableCaption).toContain('w:left="1440"');
    expect(tableTitle).toContain('w:left="1440"');
    expect(tableNote).toContain('w:left="1440"');
    expect(topLevelTable).toContain('<w:tblW w:type="pct" w:w="100%"/>');
    expect(topLevelTable).not.toContain("<w:tblInd");
    expect(table).toContain('<w:tblInd w:type="dxa" w:w="1440"/>');
    expect(table).toContain('<w:tblW w:type="dxa" w:w="7920"/>');
    expect(table).toContain("NESTED QUOTE TABLE CELL");
    expect(figureCaption).toContain('w:left="1440"');
    expect(figureTitle).toContain('w:left="1440"');
    expect(figureNote).toContain('w:left="1440"');
    expect(tableTitle).toContain(
      "(Consejo de Escritura Regional [CER], 2024)",
    );
    expect(figureTitle).toContain("(CER, 2024)");
  });

  it("keeps a table inside page bounds when quote nesting consumes its writable width", async () => {
    const input = sampleInput();
    const tableBlock = (input.content as PMJson).content
      ?.find((node) => node.type === "sectionBody")?.content
      ?.find((node) => node.type === "apaTable");
    if (!tableBlock) throw new Error("Sample table not found");
    const nestedTable = Array.from({ length: 13 }).reduce<PMJson>(
      (child) => ({ type: "blockquote", content: [child] }),
      tableBlock,
    );
    input.content = {
      type: "doc",
      content: [{ type: "sectionBody", content: [nestedTable] }],
    };

    const xml = await documentXmlFor(input);
    const table = tableContaining(xml, "Primer año");

    expect(table).toContain('<w:tblInd w:type="dxa" w:w="9358"/>');
    expect(table).toContain('<w:tblW w:type="dxa" w:w="2"/>');
  });

  it("fits a quoted inner table to its containing table cell", async () => {
    const input = sampleInput();
    input.content = {
      type: "doc",
      content: [{
        type: "sectionBody",
        content: [{
          type: "apaTable",
          content: [
            { type: "tableTitle" },
            {
              type: "table",
              content: [{
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [{
                      type: "blockquote",
                      content: [
                        singleCellApaTable(
                          "Quoted inner",
                          "QUOTED INNER CELL",
                        ),
                      ],
                    }],
                  },
                  {
                    type: "tableCell",
                    content: [
                      singleCellApaTable("Plain inner", "PLAIN INNER CELL"),
                    ],
                  },
                ],
              }],
            },
            { type: "tableNote" },
          ],
        }],
      }],
    };

    const xml = await documentXmlFor(input);
    const outerProperties = xml.match(
      /<w:tbl><w:tblPr>[\s\S]*?<\/w:tblPr>/,
    )?.[0];
    const quotedInner = innermostTableContaining(xml, "QUOTED INNER CELL");
    const plainInner = innermostTableContaining(xml, "PLAIN INNER CELL");

    expect(outerProperties).toContain(
      '<w:tblW w:type="pct" w:w="100%"/>',
    );
    expect(outerProperties).not.toContain("<w:tblInd");
    expect(quotedInner).toContain(
      '<w:tblInd w:type="dxa" w:w="720"/>',
    );
    expect(quotedInner).toContain(
      '<w:tblW w:type="dxa" w:w="3960"/>',
    );
    expect(plainInner).toContain(
      '<w:tblW w:type="pct" w:w="100%"/>',
    );
    expect(plainInner).not.toContain("<w:tblInd");
  });

  it("uses column spans and authored column proportions for inner-table width", async () => {
    const input = sampleInput();
    input.content = {
      type: "doc",
      content: [{
        type: "sectionBody",
        content: [{
          type: "apaTable",
          content: [
            { type: "tableTitle" },
            {
              type: "table",
              content: [{
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    attrs: {
                      colspan: 2,
                      rowspan: 2,
                      colwidth: [100, 200],
                    },
                    content: [{
                      type: "blockquote",
                      content: [
                        singleCellApaTable(
                          "Spanning inner",
                          "SPANNING INNER CELL",
                        ),
                      ],
                    }],
                  },
                  {
                    type: "tableCell",
                    attrs: {
                      colspan: 1,
                      rowspan: 1,
                      colwidth: [100],
                    },
                    content: [{ type: "paragraph" }],
                  },
                ],
              }, {
                type: "tableRow",
                content: [{
                  type: "tableCell",
                  attrs: {
                    colspan: 1,
                    rowspan: 1,
                    colwidth: [100],
                  },
                  content: [{
                    type: "paragraph",
                    content: [{ type: "text", text: "ROWSPAN TRAILING CELL" }],
                  }],
                }],
              }],
            },
            { type: "tableNote" },
          ],
        }],
      }],
    };

    const xml = await documentXmlFor(input);
    const outerTable = tableContaining(xml, "SPANNING INNER CELL");
    const innerTable = innermostTableContaining(xml, "SPANNING INNER CELL");

    expect(outerTable).toContain('<w:gridCol w:w="2340"/>');
    expect(outerTable).toContain('<w:gridCol w:w="4680"/>');
    expect(outerTable).toContain('<w:gridSpan w:val="2"/>');
    expect(outerTable).toContain('<w:vMerge w:val="restart"/>');
    expect(outerTable).toContain('<w:tcW w:type="dxa" w:w="7020"/>');
    expect(innerTable).toContain('<w:tblInd w:type="dxa" w:w="720"/>');
    expect(innerTable).toContain('<w:tblW w:type="dxa" w:w="6300"/>');
  });

  it("renders the keywords label in italics", () => {
    expect(documentXml).toContain("Palabras clave:");
  });

  it("renders an APA figure caption and note even without the image", () => {
    expect(documentXml).toContain("Figura 1");
    expect(documentXml).toContain("Distribución por curso");
    expect(documentXml).toContain("Elaboración propia");
  });

  it("fits a wide figure to a regular table cell and preserves its aspect ratio", async () => {
    const input = inputWithBody(
      [
        apaTable([[
          tableCell([figureBlock("CELL FIGURE", "wide.png")]),
          tableCell([{ type: "paragraph" }]),
        ]]),
      ],
      { "wide.png": testImage(500, 250) },
    );

    const xml = await documentXmlFor(input);

    // 4,680 twips / 15 twips per pixel = 312 x 156 px.
    expect(drawingExtents(xml)).toEqual([{
      cx: 2_971_800,
      cy: 1_485_900,
    }]);
  });

  it("uses a spanning cell's authored column width for its figure", async () => {
    const input = inputWithBody(
      [
        apaTable([[
          tableCell(
            [figureBlock("SPANNING FIGURE", "spanning.png")],
            { colspan: 2, colwidth: [100, 200] },
          ),
          tableCell([{ type: "paragraph" }], { colwidth: [100] }),
        ]]),
      ],
      { "spanning.png": testImage(500, 250) },
    );

    const xml = await documentXmlFor(input);

    // The 100:200:100 grid gives the spanning cell 7,020 twips, or 468 px.
    expect(drawingExtents(xml)).toEqual([{
      cx: 4_457_700,
      cy: 2_228_850,
    }]);
  });

  it("fits a quoted figure to its recursively narrowed inner-table cell", async () => {
    const nestedFigure = {
      type: "blockquote",
      content: [figureBlock("NESTED FIGURE", "nested.png")],
    };
    const innerTable = apaTable([[tableCell([nestedFigure])]]);
    const input = inputWithBody(
      [
        apaTable([[
          tableCell([{ type: "blockquote", content: [innerTable] }]),
          tableCell([{ type: "paragraph" }]),
        ]]),
      ],
      { "nested.png": testImage(500, 250) },
    );

    const xml = await documentXmlFor(input);

    // 4,680 twips, less two 720-twip quote indents, leaves 216 x 108 px.
    expect(drawingExtents(xml)).toEqual([{
      cx: 2_057_400,
      cy: 1_028_700,
    }]);
  });

  it("does not upscale a figure that already fits its table cell", async () => {
    const input = inputWithBody(
      [
        apaTable([[
          tableCell([figureBlock("SMALL FIGURE", "small.png")]),
          tableCell([{ type: "paragraph" }]),
        ]]),
      ],
      { "small.png": testImage(120, 90) },
    );

    const xml = await documentXmlFor(input);

    expect(drawingExtents(xml)).toEqual([{
      cx: 1_143_000,
      cy: 857_250,
    }]);
  });

  it("omits images with unusable dimensions without dropping their figure text", async () => {
    const input = inputWithBody(
      [
        figureBlock("ZERO WIDTH FIGURE", "zero-width.png"),
        figureBlock("BAD HEIGHT FIGURE", "bad-height.png"),
      ],
      {
        "zero-width.png": testImage(0, 250),
        "bad-height.png": testImage(250, Number.NaN),
      },
    );

    const xml = await documentXmlFor(input);

    expect(xml).toContain("ZERO WIDTH FIGURE");
    expect(xml).toContain("BAD HEIGHT FIGURE");
    expect(drawingExtents(xml)).toEqual([]);
  });

  it("embeds the figure image when bytes are supplied", async () => {
    const input = sampleInput();
    input.images = {
      "essays/assets/sample-fig.png": {
        data: testPng,
        type: "png",
        width: 120,
        height: 90,
      },
    };
    const files = unzipSync(await exportDocx(input));
    const hasImage = Object.keys(files).some((n) =>
      /^word\/media\/.+\.png$/.test(n)
    );
    expect(hasImage).toBe(true);
  });

  it("renders an APA table with number, italic title, grid, and note", () => {
    expect(documentXml).toContain("Tabla 1");
    expect(documentXml).toContain("Horas de lectura por semana");
    expect(documentXml).toContain("Primer año");
    expect(documentXml).toContain("Nota.");
    // A real table element with a bottom rule under the header row.
    expect(documentXml).toMatch(/<w:tbl>/);
    expect(documentXml).toMatch(/w:val="single"/);
  });

  it("preserves separate paragraphs, list numbering, marks, and citations inside table cells", () => {
    const headerCell = tableCellContaining("Grupo");
    const headerParagraph = paragraphsContaining(headerCell, "Grupo")[0]!;
    const cell = tableCellContaining("Primer año");
    const paragraphs = cell.match(/<w:p(?:>| [^>]*>)[\s\S]*?<\/w:p>/g) ?? [];
    const continuation = paragraphs.find((paragraph) =>
      paragraph.includes("Segundo bloque de celda")
    );
    const quoteHeading = paragraphs.find((paragraph) =>
      paragraph.includes("TABLE CELL BLOCKQUOTE HEADING")
    );
    const quoteParagraph = paragraphs.find((paragraph) =>
      paragraph.includes("Quoted cell introduction")
    );
    const listItem = paragraphs.find((paragraph) =>
      paragraph.includes("TABLE CELL BLOCKQUOTE LIST ITEM")
    );

    expect(paragraphs).toHaveLength(5);
    expect(headerParagraph).toContain('w:pStyle w:val="Normal"');
    expect(headerParagraph).toContain('w:jc w:val="center"');
    expect(headerParagraph).not.toContain('w:pStyle w:val="BodyText"');
    expect(headerParagraph).not.toContain("w:firstLine");
    for (const paragraph of paragraphs) {
      expect(paragraph).not.toContain('w:pStyle w:val="BodyText"');
      expect(paragraph).not.toContain("w:firstLine");
    }
    expect(continuation).toContain("<w:i/>");
    expect(quoteHeading).toContain('w:pStyle w:val="Heading3"');
    expect(quoteParagraph).toContain('w:pStyle w:val="Blockquote"');
    expect(listItem, "nested table-cell list item was dropped").toBeDefined();
    if (!listItem) return;
    expect(listItem).toContain("TABLE CELL BLOCKQUOTE LIST ITEM");
    expect(listItem).toContain("(Padilla, 2017)");
    expect(listItem).toContain("<w:b/>");
    expect(listItem).toContain("<w:numPr>");
    expect(listItem).toContain('w:left="2160"');
  });

  it("exports a mapped equation centered with its number at the right margin", () => {
    // "E = mc^2" has an entry in `equations` whose tree maps cleanly through
    // mathTreeToOmml: mi/mo/mi runs plus an msup superscript. Asserting the
    // walked structure (not just that *some* <m:oMath> exists) is what
    // proves the visitor actually consumes the mapper's output.
    // The paragraph must also carry `w:pStyle w:val="Normal"` — without it
    // the equation line falls back to single spacing in Word even though
    // every other body paragraph is double-spaced (Normal isn't the
    // document default; see styles.ts's empty w:pPrDefault).
    expect(documentXml).toContain(
      '<w:p><w:pPr><w:pStyle w:val="Normal"/><w:tabs>' +
        '<w:tab w:val="center" w:pos="4680"/>' +
        '<w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr>' +
        "<w:r><w:tab/></w:r><m:oMath>" +
        "<m:r><m:t>E</m:t></m:r><m:r><m:t>=</m:t></m:r>" +
        "<m:r><m:t>m</m:t></m:r>",
    );
    expect(documentXml).toContain(
      "<m:sSup><m:sSupPr/><m:e><m:r><m:t>c</m:t></m:r></m:e>" +
        "<m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>",
    );
    // The second tab pins the plain-text number to the right margin; the
    // number never goes through getTerms (it is the same in ES and EN).
    expect(documentXml).toContain(
      '</m:sSup></m:oMath><w:r><w:tab/><w:t xml:space="preserve">(1)</w:t></w:r>',
    );
  });

  it("derives equation tab stops from A4 content width", async () => {
    const input = sampleInput();
    input.settings.paperSize = "a4";
    const files = unzipSync(await exportDocx(input));
    const xml = strFromU8(files["word/document.xml"]!);
    expect(xml).toContain(
      '<w:tab w:val="center" w:pos="4513"/>' +
        '<w:tab w:val="right" w:pos="9026"/>',
    );
  });

  it("uses the structural body title to page-break before a leading equation", async () => {
    const input = sampleInput();
    input.content = {
      type: "doc",
      content: [{
        type: "sectionBody",
        content: [{ type: "apaEquation", attrs: { latex: "E = mc^2" } }],
      }],
    };
    const files = unzipSync(await exportDocx(input));
    const xml = strFromU8(files["word/document.xml"]!);
    const bodyTitle = paragraphsContaining(
      xml,
      "Hábitos de lectura en la universidad",
    )[1];
    const equation = (xml.match(/<w:p(?:>| [^>]*>)[\s\S]*?<\/w:p>/g) ?? [])
      .find((paragraph) => paragraph.includes("<w:tabs>"));

    expect(bodyTitle).toContain("<w:pageBreakBefore/>");
    expect(equation).not.toContain("<w:pageBreakBefore/>");
  });

  it("falls back to raw LaTeX for an unmapped equation without breaking the rest of the export", () => {
    // A 2x2 matrix: docx has no matrix type, so mathTreeToOmml rejects the
    // `mtable` tag (ok: false). This is the branch that rots silently if a
    // golden only ever exercises the happy path — the raw LaTeX (with its
    // "&" escaped by the XML writer) must appear as plain paragraph text,
    // immediately followed by its own running number "(2)".
    expect(documentXml).toContain(
      "\\begin{pmatrix} 1 &amp; 0 \\\\ 0 &amp; 1 \\end{pmatrix}" +
        '</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">(2)</w:t></w:r>',
    );
    // The appendix and references after it still render — one bad equation
    // must not fail the whole export.
    expect(documentXml).toContain("Apéndice");
    expect(documentXml).toContain("Referencias");
  });

  it("falls back to raw LaTeX for an equation with no entry in the equations map", () => {
    // "\sigma_x" is never added to `equations` in sample.ts, so it exercises
    // the same path a real LaTeX construct `latexToMathTree` can't handle
    // would take even though exportEssay.ts does populate the map. Missing
    // key must fall back exactly like a rejected tree: raw LaTeX text, its
    // own running number "(3)", no native OMML produced for it.
    expect(documentXml).toContain(
      "\\sigma_x</w:t></w:r>" +
        '<w:r><w:tab/><w:t xml:space="preserve">(3)</w:t></w:r>',
    );
    // Exactly one native <m:oMath> in the whole document: the mapped
    // equation produces it; neither the unsupported-tree fallback nor this
    // unmapped-key fallback may produce a second one. This exact count is
    // what prevents the fallback from silently regressing into emitting
    // bogus math.
    const oMathCount = (documentXml.match(/<m:oMath>/g) ?? []).length;
    expect(oMathCount).toBe(1);
  });

  it("renders a lettered list with a nested bullet at a deeper level", () => {
    expect(documentXml).toContain("Primer criterio");
    expect(documentXml).toContain("Matiz anidado");
    // Lettered list uses the lower-letter numbering reference.
    expect(numberingXml).toMatch(/w:numFmt w:val="lowerLetter"/);
    // The nested bullet sits one level deeper than its parent item.
    expect(documentXml).toMatch(/w:ilvl w:val="1"/);
  });

  it("keeps list continuation and special blocks inside one logical item", () => {
    const marker = paragraphContaining("Primer criterio");
    const continuation = paragraphContaining(
      "Continuación del primer criterio",
    );
    const nested = paragraphContaining("Matiz anidado");
    const tableCaption = paragraphContaining("Tabla 2");
    const afterList = paragraphContaining("Párrafo posterior a la lista");
    const bulletMarker = paragraphContaining("Matiz anidado");
    const bulletContinuation = paragraphContaining("Continuación del matiz");
    const bulletNumbering = numberingDefinitionContaining("bullet");
    const markerBulletNumbering = numberingDefinitionForParagraph(bulletMarker);
    const topLevelBullet = numberingLevel(markerBulletNumbering, 0);
    const nestedBullet = numberingLevel(markerBulletNumbering, 1);
    const thirdLevelBullet = numberingLevel(markerBulletNumbering, 2);

    expect(marker).toContain("<w:numPr>");
    expect(continuation).not.toContain("<w:numPr>");
    expect(continuation).toContain('w:left="1440"');
    expect(nested).toContain('w:ilvl w:val="1"');
    expect(tableCaption).not.toContain("<w:numPr>");
    expect(afterList).toContain('w:pStyle w:val="BodyText"');
    expect(afterList).not.toContain("<w:numPr>");
    expect(bulletMarker).toContain("<w:numPr>");
    expect(bulletMarker).toContain('w:ilvl w:val="1"');
    expect(bulletContinuation).not.toContain("<w:numPr>");
    expect(bulletContinuation).toContain('w:left="2160"');
    expect(bulletNumbering).toContain('w:left="1440"');
    expect(bulletNumbering).toContain('w:left="2160"');
    expect(bulletNumbering).toContain('w:lvlText w:val="●"');
    expect(bulletNumbering).toContain('w:lvlText w:val="○"');
    expect(bulletNumbering).toContain('w:lvlText w:val="■"');
    expect(markerBulletNumbering).toContain('w:numFmt w:val="bullet"');
    expect(topLevelBullet).toContain('w:left="1440"');
    expect(nestedBullet).toContain('w:left="2160"');
    expect(topLevelBullet).toContain('w:lvlText w:val="●"');
    expect(nestedBullet).toContain('w:lvlText w:val="○"');
    expect(thirdLevelBullet).toContain('w:lvlText w:val="■"');
  });

  it("cascades ordered-list markers by depth (decimal → letter → roman)", () => {
    // The numbered reference defines all three formats down its levels so
    // nested items switch marker instead of repeating "1.".
    expect(numberingXml).toMatch(/w:numFmt w:val="decimal"/);
    expect(numberingXml).toMatch(/w:numFmt w:val="lowerLetter"/);
    expect(numberingXml).toMatch(/w:numFmt w:val="lowerRoman"/);
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

describe("exportDocx font choice", () => {
  it("defaults to Times New Roman at 12 pt (size 24 half-points)", () => {
    // Uses the module-level sample export (times-new-roman-12).
    expect(stylesXml).toContain(`w:ascii="Times New Roman"`);
    expect(stylesXml).toMatch(/w:sz w:val="24"/);
  });

  it("applies a chosen APA font family and point size to the styles", async () => {
    const bytes = await exportDocx(sampleInput({ font: "georgia-11" }));
    const styles = strFromU8(unzipSync(bytes)["word/styles.xml"]!);
    expect(styles).toContain(`w:ascii="Georgia"`);
    expect(styles).toMatch(/w:sz w:val="22"/); // 11 pt
    expect(styles).not.toContain("Times New Roman");
  });

  it("maps Computer Modern to CMU Serif at 10 pt (size 20)", async () => {
    const bytes = await exportDocx(sampleInput({ font: "computer-modern-10" }));
    const styles = strFromU8(unzipSync(bytes)["word/styles.xml"]!);
    expect(styles).toContain(`w:ascii="CMU Serif"`);
    expect(styles).toMatch(/w:sz w:val="20"/); // 10 pt
  });

  it("applies Aptos at 12 pt (size 24)", async () => {
    const bytes = await exportDocx(sampleInput({ font: "aptos-12" }));
    const styles = strFromU8(unzipSync(bytes)["word/styles.xml"]!);
    expect(styles).toContain(`w:ascii="Aptos"`);
    expect(styles).toMatch(/w:sz w:val="24"/); // 12 pt
    expect(styles).not.toContain("Times New Roman");
  });
});

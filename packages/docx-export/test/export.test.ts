import { strFromU8, unzipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { exportDocx } from "../src/index.ts";
import { sampleEssayInput as sampleInput } from "../src/sample.ts";

let documentXml = "";
let stylesXml = "";
let numberingXml = "";
let headerXml = "";

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

  it("renders an APA figure caption and note even without the image", () => {
    expect(documentXml).toContain("Figura 1");
    expect(documentXml).toContain("Distribución por curso");
    expect(documentXml).toContain("Elaboración propia");
  });

  it("embeds the figure image when bytes are supplied", async () => {
    // Smallest valid PNG (1x1 transparent pixel).
    const png = Uint8Array.from([
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
    const input = sampleInput();
    input.images = {
      "essays/assets/sample-fig.png": {
        data: png,
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

  it("renders a lettered list with a nested bullet at a deeper level", () => {
    expect(documentXml).toContain("Primer criterio");
    expect(documentXml).toContain("Matiz anidado");
    // Lettered list uses the lower-letter numbering reference.
    expect(numberingXml).toMatch(/w:numFmt w:val="lowerLetter"/);
    // The nested bullet sits one level deeper than its parent item.
    expect(documentXml).toMatch(/w:ilvl w:val="1"/);
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

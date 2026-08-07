import { Packer } from "docx";
import { strFromU8, unzipSync } from "fflate";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { exportDocx } from "../src/index.ts";
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

  it("starts a body-leading equation on a new page", async () => {
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
    expect(xml).toContain(
      '<w:p><w:pPr><w:pStyle w:val="Normal"/><w:pageBreakBefore/><w:tabs>',
    );
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
    expect(markerBulletNumbering).toContain('w:numFmt w:val="bullet"');
    expect(topLevelBullet).toContain('w:left="1440"');
    expect(nestedBullet).toContain('w:left="2160"');
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

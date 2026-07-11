import { strFromU8, unzipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { exportSpikeDocx } from "../src/index.ts";

let files: Record<string, Uint8Array>;
let documentXml: string;
let stylesXml: string;

beforeAll(async () => {
  const bytes = await exportSpikeDocx();
  files = unzipSync(bytes);
  documentXml = strFromU8(files["word/document.xml"]!);
  stylesXml = strFromU8(files["word/styles.xml"]!);
});

describe("spike DOCX structure", () => {
  it("is a valid OOXML package with the expected parts", () => {
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        "word/document.xml",
        "word/styles.xml",
        "word/footnotes.xml",
        "[Content_Types].xml",
      ]),
    );
  });

  it("sets US Letter size and 1-inch margins in twips", () => {
    expect(documentXml).toMatch(/w:pgSz[^/]*w:w="12240"[^/]*w:h="15840"/);
    expect(documentXml).toMatch(
      /w:pgMar[^/]*w:top="1440"[^/]*w:right="1440"[^/]*w:bottom="1440"[^/]*w:left="1440"/,
    );
  });

  it("defines double spacing with no extra paragraph spacing on Normal", () => {
    expect(stylesXml).toMatch(
      /w:line="480"/,
    );
    expect(stylesXml).toMatch(/w:lineRule="auto"/);
  });

  it("defines the half-inch first-line indent on BodyText", () => {
    expect(stylesXml).toMatch(/w:firstLine="720"/);
  });

  it("defines the hanging indent for reference entries", () => {
    expect(stylesXml).toMatch(/w:hanging="720"/);
    expect(stylesXml).toMatch(/w:left="720"/);
  });

  it("emits a PAGE field in the header", () => {
    const headerEntry = Object.keys(files).find((name) =>
      /^word\/header\d*\.xml$/.test(name)
    );
    expect(headerEntry).toBeDefined();
    const headerXml = strFromU8(files[headerEntry!]!);
    expect(headerXml).toContain("PAGE");
    expect(headerXml).toContain("TITULILLO EN MAYÚSCULAS");
  });

  it("references the footnote from the body", () => {
    expect(documentXml).toMatch(/w:footnoteReference/);
    const footnotesXml = strFromU8(files["word/footnotes.xml"]!);
    expect(footnotesXml).toContain("nota al pie de prueba");
  });

  it("uses real heading styles so Word's navigation pane works", () => {
    expect(documentXml).toMatch(/w:pStyle w:val="Heading1"/);
    expect(stylesXml).toMatch(/w:styleId="Heading1"/);
  });

  it("marks the references heading to start on a new page", () => {
    expect(documentXml).toMatch(/w:pageBreakBefore/);
  });

  it("keeps italics inside reference entries", () => {
    expect(documentXml).toContain("El gran libro de las pruebas");
    expect(documentXml).toMatch(/w:i\b/);
  });
});

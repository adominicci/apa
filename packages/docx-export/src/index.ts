export { buildSpikeDocument, exportSpikeDocx } from "./spike.ts";
export { buildDocContext, type DocContext } from "./runs.ts";
export type { PMJson } from "./input.ts";
export type {
  ExportImage,
  ExportInput,
  ExportSettings,
  ExportTitlePage,
  FontChoice,
  MathNode,
  PaperSize,
  PaperVariant,
} from "./input.ts";
export { type MathResult, mathTreeToOmml, toDocxMath } from "./math.ts";

import {
  AlignmentType,
  Document,
  Header,
  Packer,
  PageNumber,
  Paragraph,
  TabStopPosition,
  TabStopType,
  TextRun,
} from "docx";
import type { ExportInput, PMJson } from "./input.ts";
import { buildNumbering, buildStyles, ONE_INCH, PAGE_SIZE } from "./styles.ts";
import { buildDocContext } from "./runs.ts";
import { titlePageParagraphs } from "./title-page.ts";
import { visitDocument } from "./pm-visitor.ts";
import { referencesParagraphs } from "./references.ts";

/**
 * APA header: page number top right on every page from the title page on;
 * the professional variant adds the uppercased running head on the left
 * (falling back to the essay title when none was provided).
 */
function buildHeader(input: ExportInput): Header {
  const pageNumber = new TextRun({ children: [PageNumber.CURRENT] });
  if (input.settings.variant === "professional") {
    const head = (input.settings.runningHead ?? input.titlePage.title)
      .toUpperCase()
      .slice(0, 50);
    return new Header({
      children: [
        new Paragraph({
          style: "Normal",
          tabStops: [
            { type: TabStopType.RIGHT, position: TabStopPosition.MAX },
          ],
          children: [
            new TextRun(head),
            new TextRun({ children: ["\t"] }),
            pageNumber,
          ],
        }),
      ],
    });
  }
  return new Header({
    children: [
      new Paragraph({
        style: "Normal",
        alignment: AlignmentType.RIGHT,
        children: [pageNumber],
      }),
    ],
  });
}

/** The whole essay → a .docx file, ready to open in Word. */
export async function exportDocx(input: ExportInput): Promise<Uint8Array> {
  const content = input.content as PMJson;
  const locale = input.settings.documentLanguage;
  const ctx = buildDocContext(
    content,
    input.references,
    locale,
    input.images ?? {},
    input.equations ?? {},
  );

  const doc = new Document({
    styles: buildStyles(input.settings.font),
    numbering: buildNumbering(),
    sections: [
      {
        properties: {
          page: {
            size: PAGE_SIZE[input.settings.paperSize],
            margin: {
              top: ONE_INCH,
              right: ONE_INCH,
              bottom: ONE_INCH,
              left: ONE_INCH,
            },
          },
        },
        headers: { default: buildHeader(input) },
        children: [
          ...titlePageParagraphs(input),
          ...visitDocument(
            content,
            ctx,
            PAGE_SIZE[input.settings.paperSize].width - 2 * ONE_INCH,
          ),
          ...referencesParagraphs(input.references, locale),
        ],
      },
    ],
  });

  const arrayBuffer = await Packer.toArrayBuffer(doc);
  return new Uint8Array(arrayBuffer);
}

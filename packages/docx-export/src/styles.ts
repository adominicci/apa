import { AlignmentType, LevelFormat, LineRuleType } from "docx";
import type { FontChoice, PaperSize } from "./input.ts";

export const HALF_INCH = 720; // twips
export const ONE_INCH = 1440;
export const DOUBLE_SPACING = 480; // 240 = single

export const FONT_MAP: Record<FontChoice, { name: string; size: number }> = {
  "times-new-roman-12": { name: "Times New Roman", size: 24 },
  "calibri-11": { name: "Calibri", size: 22 },
  "arial-11": { name: "Arial", size: 22 },
};

export const PAGE_SIZE: Record<PaperSize, { width: number; height: number }> = {
  "us-letter": { width: 12240, height: 15840 },
  a4: { width: 11906, height: 16838 },
};

const doubleSpaced = {
  spacing: {
    line: DOUBLE_SPACING,
    lineRule: LineRuleType.AUTO,
    before: 0,
    after: 0,
  },
};

/**
 * Named paragraph styles (real style IDs so Word's navigation pane works),
 * double-spaced with zero extra paragraph spacing throughout — the exact
 * mapping verified against Word in the M0 spike.
 */
export function buildStyles(font: FontChoice) {
  const run = FONT_MAP[font];
  return {
    default: { document: { run } },
    paragraphStyles: [
      {
        id: "Normal",
        name: "Normal",
        quickFormat: true,
        run,
        paragraph: doubleSpaced,
      },
      {
        id: "BodyText",
        name: "Body Text",
        basedOn: "Normal",
        quickFormat: true,
        paragraph: { ...doubleSpaced, indent: { firstLine: HALF_INCH } },
      },
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "BodyText",
        quickFormat: true,
        run: { ...run, bold: true },
        paragraph: { ...doubleSpaced, alignment: AlignmentType.CENTER },
      },
      {
        id: "Heading2",
        name: "Heading 2",
        basedOn: "Normal",
        next: "BodyText",
        quickFormat: true,
        run: { ...run, bold: true },
        paragraph: doubleSpaced,
      },
      {
        id: "Heading3",
        name: "Heading 3",
        basedOn: "Normal",
        next: "BodyText",
        quickFormat: true,
        run: { ...run, bold: true, italics: true },
        paragraph: doubleSpaced,
      },
      {
        id: "Blockquote",
        name: "Block Quote",
        basedOn: "Normal",
        quickFormat: true,
        paragraph: { ...doubleSpaced, indent: { left: HALF_INCH } },
      },
      {
        id: "ReferenceEntry",
        name: "Reference Entry",
        basedOn: "Normal",
        quickFormat: true,
        paragraph: {
          ...doubleSpaced,
          indent: { left: HALF_INCH, hanging: HALF_INCH },
        },
      },
    ],
  };
}

export const ORDERED_LIST_REF = "tesina-ordered";

export function buildNumbering() {
  return {
    config: [
      {
        reference: ORDERED_LIST_REF,
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.START,
            style: {
              paragraph: {
                indent: { left: ONE_INCH, hanging: 360 },
              },
            },
          },
        ],
      },
    ],
  };
}

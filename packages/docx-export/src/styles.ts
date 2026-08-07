import { AlignmentType, LevelFormat, LineRuleType } from "docx";
import type { FontChoice, PaperSize } from "./input.ts";

export const HALF_INCH = 720; // twips
export const ONE_INCH = 1440;
export const DOUBLE_SPACING = 480; // 240 = single

// size is in half-points (docx unit): 12pt = 24, 11pt = 22, 10pt = 20.
export const FONT_MAP: Record<FontChoice, { name: string; size: number }> = {
  "times-new-roman-12": { name: "Times New Roman", size: 24 },
  "georgia-11": { name: "Georgia", size: 22 },
  "computer-modern-10": { name: "CMU Serif", size: 20 },
  "aptos-12": { name: "Aptos", size: 24 },
  "calibri-11": { name: "Calibri", size: 22 },
  "arial-11": { name: "Arial", size: 22 },
  "lucida-sans-unicode-10": { name: "Lucida Sans Unicode", size: 20 },
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
  // docx's run option for the typeface is `font` (emits <w:rFonts w:ascii>);
  // FONT_MAP stores it neutrally as `name`, so translate here — otherwise the
  // family is silently dropped and only the size survives.
  const meta = FONT_MAP[font];
  const run = { font: meta.name, size: meta.size };
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
export const LOWER_ALPHA_REF = "tesina-lower-alpha";
export const BULLET_LIST_REF = "tesina-bullet";

/**
 * Ordered-list marker cascade by nesting depth: number → letter → roman,
 * repeating. Nested items therefore switch format (1. → a. → i.) instead of
 * repeating "1.", matching common word processors. `startOffset` shifts the
 * cycle so a lettered list starts at letters (offset 1).
 */
const FORMAT_CYCLE = [
  LevelFormat.DECIMAL,
  LevelFormat.LOWER_LETTER,
  LevelFormat.LOWER_ROMAN,
] as const;

export function listTextIndent(depth: number): number {
  return ONE_INCH + depth * HALF_INCH;
}

/** Nine indent levels so nested lists (sink/liftListItem) render correctly. */
function numberingLevels(startOffset: number) {
  return Array.from({ length: 9 }, (_, level) => ({
    level,
    format: FORMAT_CYCLE[(level + startOffset) % 3],
    // Each level shows only its own counter (APA nested lists aren't legal
    // "1.a.i" style), so the template references this level's number.
    text: `%${level + 1}.`,
    alignment: AlignmentType.START,
    style: {
      paragraph: {
        indent: { left: listTextIndent(level), hanging: 360 },
      },
    },
  }));
}

function bulletLevels() {
  return Array.from({ length: 9 }, (_, level) => ({
    level,
    format: LevelFormat.BULLET,
    text: "•",
    alignment: AlignmentType.START,
    style: {
      paragraph: {
        indent: { left: listTextIndent(level), hanging: 360 },
      },
    },
  }));
}

export function buildNumbering() {
  return {
    config: [
      {
        reference: ORDERED_LIST_REF,
        levels: numberingLevels(0),
      },
      {
        reference: LOWER_ALPHA_REF,
        levels: numberingLevels(1),
      },
      {
        reference: BULLET_LIST_REF,
        levels: bulletLevels(),
      },
    ],
  };
}

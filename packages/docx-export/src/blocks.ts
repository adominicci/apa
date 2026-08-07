import {
  AlignmentType,
  BorderStyle,
  ImageRun,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { getTerms } from "@tesina/engine";
import type { PMJson } from "./input.ts";
import { type DocContext, inlineToTextRuns } from "./runs.ts";

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "auto" };
const RULE = { style: BorderStyle.SINGLE, size: 4, color: "000000" };

function paragraphIndent(
  leftIndent: number,
): { indent?: { left: number } } {
  return leftIndent > 0 ? { indent: { left: leftIndent } } : {};
}

/**
 * Builds an APA table (APA 7.8–7.21): "Table N" bold, italic title, a grid
 * ruled only above the table, under the header row, and at the bottom, then
 * an italic "Note." line. Numbering is a running counter (never stored).
 */
export function apaTableBlocks(
  block: PMJson,
  ctx: DocContext,
  citationCounter: { next: number },
  tableCounter: { n: number },
  renderCellBlocks: (
    blocks: readonly PMJson[],
  ) => readonly (Paragraph | Table)[],
  leftIndent = 0,
): (Paragraph | Table)[] {
  tableCounter.n += 1;
  const t = getTerms(ctx.locale);
  const children = block.content ?? [];
  const titleNode = children.find((c) => c.type === "tableTitle");
  const tableNode = children.find((c) => c.type === "table");
  const noteNode = children.find((c) => c.type === "tableNote");

  const out: (Paragraph | Table)[] = [];

  out.push(
    new Paragraph({
      style: "Normal",
      ...paragraphIndent(leftIndent),
      children: [
        new TextRun({
          text: `${t.headings.table} ${tableCounter.n}`,
          bold: true,
        }),
      ],
    }),
  );
  out.push(
    new Paragraph({
      style: "Normal",
      ...paragraphIndent(leftIndent),
      children: titleNode
        ? inlineToTextRuns(titleNode.content ?? [], ctx, citationCounter, {
          italics: true,
        })
        : [],
    }),
  );

  const rows = tableNode?.content ?? [];
  out.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      ...(leftIndent > 0
        ? { indent: { size: leftIndent, type: WidthType.DXA } }
        : {}),
      borders: {
        top: RULE,
        bottom: RULE,
        left: NO_BORDER,
        right: NO_BORDER,
        insideHorizontal: NO_BORDER,
        insideVertical: NO_BORDER,
      },
      rows: rows.map((rowNode) => {
        const isHeaderRow = (rowNode.content ?? []).every(
          (c) => c.type === "tableHeader",
        );
        return new TableRow({
          tableHeader: isHeaderRow,
          children: (rowNode.content ?? []).map((cellNode) => {
            const cellBlocks = renderCellBlocks(cellNode.content ?? []);
            return new TableCell({
              children: cellBlocks.length > 0
                ? cellBlocks
                : [new Paragraph({ style: "Normal" })],
              // The header row draws the rule beneath it (APA 7.8).
              borders: cellNode.type === "tableHeader"
                ? {
                  bottom: RULE,
                  top: NO_BORDER,
                  left: NO_BORDER,
                  right: NO_BORDER,
                }
                : {
                  top: NO_BORDER,
                  bottom: NO_BORDER,
                  left: NO_BORDER,
                  right: NO_BORDER,
                },
            });
          }),
        });
      }),
    }),
  );

  const noteRuns = noteNode
    ? inlineToTextRuns(noteNode.content ?? [], ctx, citationCounter)
    : [];
  if (noteRuns.length > 0) {
    out.push(
      new Paragraph({
        style: "Normal",
        ...paragraphIndent(leftIndent),
        children: [
          new TextRun({ text: `${t.headings.note} `, italics: true }),
          ...noteRuns,
        ],
      }),
    );
  }

  return out;
}

/**
 * Builds an APA figure (APA 7.22): "Figure N" bold, italic title, the image
 * centered, then an italic "Note." line. Image bytes arrive pre-read and
 * pre-measured on the context (the exporter never touches the filesystem).
 */
export function apaFigureBlocks(
  block: PMJson,
  ctx: DocContext,
  citationCounter: { next: number },
  figureCounter: { n: number },
  leftIndent = 0,
): Paragraph[] {
  figureCounter.n += 1;
  const t = getTerms(ctx.locale);
  const children = block.content ?? [];
  const titleNode = children.find((c) => c.type === "figureTitle");
  const imageNode = children.find((c) => c.type === "figureImage");
  const noteNode = children.find((c) => c.type === "figureNote");

  const out: Paragraph[] = [];
  out.push(
    new Paragraph({
      style: "Normal",
      ...paragraphIndent(leftIndent),
      children: [
        new TextRun({
          text: `${t.headings.figure} ${figureCounter.n}`,
          bold: true,
        }),
      ],
    }),
  );
  out.push(
    new Paragraph({
      style: "Normal",
      ...paragraphIndent(leftIndent),
      children: titleNode
        ? inlineToTextRuns(titleNode.content ?? [], ctx, citationCounter, {
          italics: true,
        })
        : [],
    }),
  );

  const src = imageNode?.attrs?.["src"] as string | undefined;
  const image = src ? ctx.images[src] : undefined;
  if (image) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        ...paragraphIndent(leftIndent),
        children: [
          new ImageRun({
            data: image.data,
            type: image.type,
            transformation: { width: image.width, height: image.height },
          }),
        ],
      }),
    );
  }

  const noteRuns = noteNode
    ? inlineToTextRuns(noteNode.content ?? [], ctx, citationCounter)
    : [];
  if (noteRuns.length > 0) {
    out.push(
      new Paragraph({
        style: "Normal",
        ...paragraphIndent(leftIndent),
        children: [
          new TextRun({ text: `${t.headings.note} `, italics: true }),
          ...noteRuns,
        ],
      }),
    );
  }

  return out;
}

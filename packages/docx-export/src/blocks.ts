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
const MIN_TABLE_WIDTH = 1; // twip; prevents zero/negative widths in deep quotes

interface CellPlacement {
  node: PMJson;
  startColumn: number;
  columnSpan: number;
  rowSpan: number;
}

function paragraphIndent(
  leftIndent: number,
): { indent?: { left: number } } {
  return leftIndent > 0 ? { indent: { left: leftIndent } } : {};
}

/**
 * Word resolves percentage table widths against the full writable page even
 * when `tblInd` is present. Indented tables therefore need an exact remaining
 * width in twips; top-level tables keep their existing responsive 100% width.
 */
function tableLayout(
  contentWidth: number,
  leftIndent: number,
  minimumWidth: number,
) {
  const boundedContentWidth = Math.max(contentWidth, minimumWidth);
  if (leftIndent <= 0) {
    return {
      properties: { width: { size: 100, type: WidthType.PERCENTAGE } },
      resolvedWidth: boundedContentWidth,
    };
  }

  const boundedLeftIndent = Math.min(
    leftIndent,
    boundedContentWidth - minimumWidth,
  );
  return {
    properties: {
      width: {
        size: boundedContentWidth - boundedLeftIndent,
        type: WidthType.DXA,
      },
      ...(boundedLeftIndent > 0
        ? { indent: { size: boundedLeftIndent, type: WidthType.DXA } }
        : {}),
    },
    resolvedWidth: boundedContentWidth - boundedLeftIndent,
  };
}

function positiveSpan(node: PMJson, attribute: "colspan" | "rowspan") {
  const value = Number(node.attrs?.[attribute] ?? 1);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

/** Maps ProseMirror cells onto logical grid columns, including active spans. */
function placeCells(rows: readonly PMJson[]) {
  const occupiedUntil: number[] = [];
  const placements = rows.map((row, rowIndex) => {
    const rowPlacements: CellPlacement[] = [];
    let column = 0;
    for (const node of row.content ?? []) {
      const columnSpan = positiveSpan(node, "colspan");
      const rowSpan = positiveSpan(node, "rowspan");
      while (true) {
        while ((occupiedUntil[column] ?? 0) > rowIndex) column += 1;
        const occupiedOffset = Array.from(
          { length: columnSpan },
          (_, offset) => offset,
        ).find((offset) => (occupiedUntil[column + offset] ?? 0) > rowIndex);
        if (occupiedOffset === undefined) break;
        column += occupiedOffset + 1;
      }
      rowPlacements.push({ node, startColumn: column, columnSpan, rowSpan });
      for (let offset = 0; offset < columnSpan; offset++) {
        occupiedUntil[column + offset] = Math.max(
          occupiedUntil[column + offset] ?? 0,
          rowIndex + rowSpan,
        );
      }
      column += columnSpan;
    }
    return rowPlacements;
  });
  const columnCount = Math.max(
    MIN_TABLE_WIDTH,
    occupiedUntil.length,
    ...placements.flatMap((row) =>
      row.map((cell) => cell.startColumn + cell.columnSpan)
    ),
  );
  return { placements, columnCount };
}

function columnWeights(
  placements: readonly (readonly CellPlacement[])[],
  columnCount: number,
): number[] {
  const authored: (number | undefined)[] = Array(columnCount).fill(undefined);
  for (const row of placements) {
    for (const cell of row) {
      const widths = cell.node.attrs?.["colwidth"];
      if (!Array.isArray(widths) || widths.length < cell.columnSpan) continue;
      for (let offset = 0; offset < cell.columnSpan; offset++) {
        const width = Number(widths[offset]);
        if (Number.isFinite(width) && width > 0) {
          authored[cell.startColumn + offset] ??= width;
        }
      }
    }
  }
  // A partial `colwidth` set cannot define the whole grid reliably. Equal
  // weights preserve docx's native default until every logical column has an
  // authored proportion.
  return authored.every((width) => width !== undefined)
    ? authored as number[]
    : Array(columnCount).fill(1);
}

/** Allocates integer twips while preserving proportions and a 1-twip floor. */
function allocateColumnWidths(totalWidth: number, weights: readonly number[]) {
  const remaining = totalWidth - weights.length;
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const allocations = weights.map((weight, index) => {
    const exactExtra = remaining * weight / totalWeight;
    return {
      index,
      width: MIN_TABLE_WIDTH + Math.floor(exactExtra),
      remainder: exactExtra - Math.floor(exactExtra),
    };
  });
  let unallocated = totalWidth - allocations.reduce(
    (sum, allocation) => sum + allocation.width,
    0,
  );
  for (
    const allocation of [...allocations].sort((a, b) =>
      b.remainder - a.remainder || a.index - b.index
    )
  ) {
    if (unallocated <= 0) break;
    allocations[allocation.index]!.width += 1;
    unallocated -= 1;
  }
  return allocations.map((allocation) => allocation.width);
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
    isHeader: boolean,
    contentWidth: number,
  ) => readonly (Paragraph | Table)[],
  contentWidth: number,
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
  const grid = placeCells(rows);
  const layout = tableLayout(contentWidth, leftIndent, grid.columnCount);
  const columnWidths = allocateColumnWidths(
    layout.resolvedWidth,
    columnWeights(grid.placements, grid.columnCount),
  );
  out.push(
    new Table({
      ...layout.properties,
      columnWidths,
      borders: {
        top: RULE,
        bottom: RULE,
        left: NO_BORDER,
        right: NO_BORDER,
        insideHorizontal: NO_BORDER,
        insideVertical: NO_BORDER,
      },
      rows: rows.map((rowNode, rowIndex) => {
        const isHeaderRow = (rowNode.content ?? []).every(
          (c) => c.type === "tableHeader",
        );
        return new TableRow({
          tableHeader: isHeaderRow,
          children: (rowNode.content ?? []).map((cellNode, cellIndex) => {
            const placement = grid.placements[rowIndex]![cellIndex]!;
            const isHeader = cellNode.type === "tableHeader";
            const cellContentWidth = columnWidths
              .slice(
                placement.startColumn,
                placement.startColumn + placement.columnSpan,
              )
              .reduce((sum, width) => sum + width, 0);
            const cellBlocks = renderCellBlocks(
              cellNode.content ?? [],
              isHeader,
              cellContentWidth,
            );
            return new TableCell({
              width: { size: cellContentWidth, type: WidthType.DXA },
              ...(placement.columnSpan > 1
                ? { columnSpan: placement.columnSpan }
                : {}),
              ...(placement.rowSpan > 1 ? { rowSpan: placement.rowSpan } : {}),
              children: cellBlocks.length > 0
                ? cellBlocks
                : [new Paragraph({ style: "Normal" })],
              // The header row draws the rule beneath it (APA 7.8).
              borders: isHeader
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

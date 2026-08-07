import {
  AlignmentType,
  Paragraph,
  Tab,
  Table,
  TabStopType,
  TextRun,
} from "docx";
import { getTerms } from "@tesina/engine";
import type { PMJson } from "./input.ts";
import { hasAuthoredBodyTitle } from "./body-title.ts";
import { type DocContext, inlineToTextRuns } from "./runs.ts";
import {
  BULLET_LIST_REF,
  HALF_INCH,
  listTextIndent,
  LOWER_ALPHA_REF,
  ORDERED_LIST_REF,
} from "./styles.ts";
import { apaFigureBlocks, apaTableBlocks } from "./blocks.ts";
import { mathTreeToOmml, toDocxMath } from "./math.ts";

interface VisitState {
  ctx: DocContext;
  citationCounter: { next: number };
  orderedListInstance: number;
  tableCounter: { n: number };
  figureCounter: { n: number };
  equationCounter: { n: number };
  contentWidth: number;
}

interface VisitOptions {
  /** Style for the first block when it is a paragraph (abstract: "Normal"). */
  firstParagraphStyle?: string;
  /** Page break on the first emitted paragraph (legacy authored body title). */
  firstPageBreak?: boolean;
  /** Default paragraph style for a recursive context such as a block quote. */
  paragraphStyle?: string;
  /** Accumulated left indent applied while walking nested block quotes. */
  blockquoteIndent?: number;
  /** Writable width of the current page or table-cell content container. */
  contentWidth?: number;
  /** Explicit alignment for every paragraph in a table-cell context. */
  paragraphAlignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
}

/**
 * Removes the optional authored period from a run-in heading's last meaningful
 * text node. Trailing whitespace-only text and hard breaks remain intact; the
 * scan skips only those schema-valid nodes and stops at any other inline atom.
 */
function normalizedRunInContent(inline: readonly PMJson[]): PMJson[] {
  const normalized = [...inline];
  for (let i = normalized.length - 1; i >= 0; i--) {
    const node = normalized[i]!;
    if (node.type === "hardBreak") continue;
    if (node.type !== "text" || typeof node.text !== "string") break;
    if (node.text.trim() === "") continue;
    normalized[i] = {
      ...node,
      text: node.text.replace(/\.(\s*)$/, "$1"),
    };
    break;
  }
  return normalized;
}

/**
 * Converts a section's blocks to docx paragraphs. Every block's inline
 * content is converted exactly once so the citation counter stays in sync
 * with document order (first-occurrence group abbreviations depend on it).
 * APA levels 4–5 are run-in headings: bold (level 5 bold italic) text ending
 * in a period, merged into the following paragraph (plan §5.1).
 */
export function visitBlocks(
  blocks: readonly PMJson[],
  state: VisitState,
  options: VisitOptions = {},
): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  let emittedFirst = false;

  const emit = (
    style: string,
    children: TextRun[],
    extra: Record<string, unknown> = {},
  ) => {
    const first = !emittedFirst;
    emittedFirst = true;
    const explicitIndent = extra["indent"] as
      | Record<string, unknown>
      | undefined;
    const alignedExtra = options.paragraphAlignment
      ? { alignment: options.paragraphAlignment, ...extra }
      : extra;
    const contextualExtra = options.blockquoteIndent
      ? {
        ...alignedExtra,
        indent: {
          ...explicitIndent,
          left: (typeof explicitIndent?.["left"] === "number"
            ? explicitIndent["left"]
            : 0) + options.blockquoteIndent,
        },
      }
      : alignedExtra;
    out.push(
      new Paragraph({
        style,
        children,
        ...(first && options.firstPageBreak ? { pageBreakBefore: true } : {}),
        ...contextualExtra,
      }),
    );
  };

  /**
   * Emits a list (and its nested lists) as paragraphs. `depth` maps to the
   * docx numbering/bullet level so sink/liftListItem nesting survives and the
   * numbering reference's per-level formats cascade (1. → a. → i.). The
   * outermost ordered list's `listStyle` picks the reference (decimal- or
   * letter-start); nested ordered lists inherit it so the cascade is
   * continuous. Each ordered list gets a fresh instance so its counter
   * restarts at that level.
   */
  const visitList = (
    listBlock: PMJson,
    depth: number,
    inheritedRef?: string,
  ) => {
    const isOrdered = listBlock.type === "orderedList";
    const reference = inheritedRef ??
      (listBlock.attrs?.["listStyle"] === "lower-alpha"
        ? LOWER_ALPHA_REF
        : ORDERED_LIST_REF);
    let instance = 0;
    if (isOrdered) {
      state.orderedListInstance += 1;
      instance = state.orderedListInstance;
    }
    for (const item of listBlock.content ?? []) {
      let markerEmitted = false;
      for (const child of item.content ?? []) {
        if (child.type === "bulletList" || child.type === "orderedList") {
          visitList(child, depth + 1, isOrdered ? reference : inheritedRef);
        } else if (child.type === "paragraph") {
          const markerProps = isOrdered
            ? { numbering: { reference, level: depth, instance } }
            : { numbering: { reference: BULLET_LIST_REF, level: depth } };
          emit(
            "Normal",
            inlineToTextRuns(
              child.content ?? [],
              state.ctx,
              state.citationCounter,
            ),
            markerEmitted
              ? { indent: { left: listTextIndent(depth) } }
              : options.blockquoteIndent
              ? {
                ...markerProps,
                indent: { left: listTextIndent(depth), hanging: 360 },
              }
              : markerProps,
          );
          markerEmitted = true;
        } else {
          const specialBlocks = visitBlocks([child], state, options);
          if (specialBlocks.length > 0) {
            emittedFirst = true;
            out.push(...specialBlocks);
          }
        }
      }
    }
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    switch (block.type) {
      case "paragraph": {
        const style = !emittedFirst && options.firstParagraphStyle
          ? options.firstParagraphStyle
          : options.paragraphStyle ?? "BodyText";
        emit(
          style,
          inlineToTextRuns(
            block.content ?? [],
            state.ctx,
            state.citationCounter,
          ),
        );
        break;
      }
      case "heading": {
        const level = Number(block.attrs?.["level"] ?? 1);
        if (level >= 4) {
          const runInStyle = level === 5
            ? { bold: true, italics: true }
            : { bold: true };
          const headingRuns = inlineToTextRuns(
            normalizedRunInContent(block.content ?? []),
            state.ctx,
            state.citationCounter,
            runInStyle,
          );
          const punctuationRun = new TextRun({
            text: ". ",
            ...runInStyle,
          });
          const next = blocks[i + 1];
          if (next?.type === "paragraph") {
            i += 1;
            emit(options.paragraphStyle ?? "BodyText", [
              ...headingRuns,
              punctuationRun,
              ...inlineToTextRuns(
                next.content ?? [],
                state.ctx,
                state.citationCounter,
              ),
            ]);
          } else {
            emit(options.paragraphStyle ?? "BodyText", [
              ...headingRuns,
              punctuationRun,
            ]);
          }
        } else {
          emit(
            `Heading${level}`,
            inlineToTextRuns(
              block.content ?? [],
              state.ctx,
              state.citationCounter,
            ),
          );
        }
        break;
      }
      case "blockquote": {
        const quoteBlocks = visitBlocks(block.content ?? [], state, {
          paragraphStyle: "Blockquote",
          blockquoteIndent: (options.blockquoteIndent ?? 0) + HALF_INCH,
          paragraphAlignment: options.paragraphAlignment,
          contentWidth: options.contentWidth,
        });
        if (quoteBlocks.length > 0) {
          emittedFirst = true;
          out.push(...quoteBlocks);
        }
        break;
      }
      case "bulletList":
      case "orderedList": {
        visitList(block, 0);
        break;
      }
      case "apaTable": {
        emittedFirst = true;
        out.push(
          ...apaTableBlocks(
            block,
            state.ctx,
            state.citationCounter,
            state.tableCounter,
            (cellBlocks, isHeader, contentWidth) =>
              visitBlocks(cellBlocks, state, {
                paragraphStyle: "Normal",
                paragraphAlignment: isHeader
                  ? AlignmentType.CENTER
                  : AlignmentType.LEFT,
                contentWidth,
              }),
            options.contentWidth ?? state.contentWidth,
            options.blockquoteIndent,
          ),
        );
        break;
      }
      case "figure": {
        emittedFirst = true;
        out.push(
          ...apaFigureBlocks(
            block,
            state.ctx,
            state.citationCounter,
            state.figureCounter,
            options.contentWidth ?? state.contentWidth,
            options.blockquoteIndent,
          ),
        );
        break;
      }
      case "apaEquation": {
        // Numbered "(1)" in both document languages — never through
        // getTerms, mirroring the preview (renderEssayHtml.ts).
        emittedFirst = true;
        state.equationCounter.n += 1;
        const latex = (block.attrs?.["latex"] as string | undefined) ?? "";
        const tree = state.ctx.equations[latex];
        const mathResult = tree ? mathTreeToOmml(tree) : undefined;
        // Fallback is the point of this block: an unmapped tree (no map
        // entry, or mathTreeToOmml rejecting the shape) must still export
        // as its raw LaTeX text — never throw and take the rest of the
        // document down with it.
        const equationChildren = mathResult?.ok
          ? [toDocxMath(mathResult.children)]
          : [new TextRun(latex)];
        out.push(
          new Paragraph({
            style: "Normal",
            tabStops: [
              {
                type: TabStopType.CENTER,
                position: state.contentWidth / 2,
              },
              { type: TabStopType.RIGHT, position: state.contentWidth },
            ],
            children: [
              new TextRun({ children: [new Tab()] }),
              ...equationChildren,
              new TextRun({
                children: [new Tab(), `(${state.equationCounter.n})`],
              }),
            ],
          }),
        );
        break;
      }
      case "keywordsLine": {
        const t = getTerms(state.ctx.locale);
        emit(options.paragraphStyle ?? "BodyText", [
          new TextRun({ text: `${t.headings.keywords} `, italics: true }),
          ...inlineToTextRuns(
            block.content ?? [],
            state.ctx,
            state.citationCounter,
          ),
        ]);
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/**
 * Visits every authored section once with one shared render state, while
 * separating abstract/body output from appendices so the caller can place the
 * derived references page between them.
 */
export function visitDocument(
  content: PMJson,
  ctx: DocContext,
  contentWidth: number,
  bodyTitle: string,
): {
  beforeReferences: (Paragraph | Table)[];
  appendices: (Paragraph | Table)[];
} {
  const t = getTerms(ctx.locale);
  const state: VisitState = {
    ctx,
    citationCounter: { next: 0 },
    orderedListInstance: 0,
    tableCounter: { n: 0 },
    figureCounter: { n: 0 },
    equationCounter: { n: 0 },
    contentWidth,
  };
  const sections = content.content ?? [];
  const appendixCount = sections.filter(
    (s) => s.type === "sectionAppendix",
  ).length;
  let appendixIndex = 0;
  const beforeReferences: (Paragraph | Table)[] = [];
  const appendices: (Paragraph | Table)[] = [];

  for (const section of sections) {
    if (section.type === "sectionAbstract") {
      beforeReferences.push(
        new Paragraph({
          style: "Heading1",
          children: [new TextRun(t.headings.abstract)],
          pageBreakBefore: true,
        }),
      );
      beforeReferences.push(
        ...visitBlocks(section.content ?? [], state, {
          firstParagraphStyle: "Normal",
        }),
      );
    } else if (section.type === "sectionBody") {
      const authoredBodyTitle = hasAuthoredBodyTitle(section, bodyTitle);
      if (!authoredBodyTitle) {
        beforeReferences.push(
          new Paragraph({
            style: "Heading1",
            pageBreakBefore: true,
            children: [new TextRun({ text: bodyTitle, bold: true })],
          }),
        );
      }
      beforeReferences.push(
        ...visitBlocks(
          section.content ?? [],
          state,
          authoredBodyTitle ? { firstPageBreak: true } : {},
        ),
      );
    } else if (section.type === "sectionAppendix") {
      appendixIndex += 1;
      const letter = appendixCount > 1
        ? ` ${String.fromCharCode(64 + appendixIndex)}`
        : "";
      appendices.push(
        new Paragraph({
          style: "Heading1",
          children: [new TextRun(`${t.headings.appendix}${letter}`)],
          pageBreakBefore: true,
        }),
      );
      appendices.push(...visitBlocks(section.content ?? [], state));
    }
  }
  return { beforeReferences, appendices };
}

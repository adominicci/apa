import { AlignmentType, Paragraph, Table, TextRun } from "docx";
import { getTerms } from "@tesina/engine";
import type { PMJson } from "./input.ts";
import { type DocContext, inlineText, inlineToTextRuns } from "./runs.ts";
import { LOWER_ALPHA_REF, ORDERED_LIST_REF } from "./styles.ts";
import { apaFigureBlocks, apaTableBlocks } from "./blocks.ts";
import { mathTreeToOmml, toDocxMath } from "./math.ts";

interface VisitState {
  ctx: DocContext;
  citationCounter: { next: number };
  orderedListInstance: number;
  tableCounter: { n: number };
  figureCounter: { n: number };
  equationCounter: { n: number };
}

interface VisitOptions {
  /** Style for the first block when it is a paragraph (abstract: "Normal"). */
  firstParagraphStyle?: string;
  /** Page break on the first emitted paragraph (body section). */
  firstPageBreak?: boolean;
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
    out.push(
      new Paragraph({
        style,
        children,
        ...(first && options.firstPageBreak ? { pageBreakBefore: true } : {}),
        ...extra,
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
      for (const child of item.content ?? []) {
        if (child.type === "bulletList" || child.type === "orderedList") {
          visitList(child, depth + 1, isOrdered ? reference : inheritedRef);
        } else {
          emit(
            "Normal",
            inlineToTextRuns(
              child.content ?? [],
              state.ctx,
              state.citationCounter,
            ),
            isOrdered
              ? { numbering: { reference, level: depth, instance } }
              : { bullet: { level: depth } },
          );
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
          : "BodyText";
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
          const headingText = inlineText(block.content ?? []).replace(
            /\.?\s*$/,
            "",
          );
          // Advance the counter for any citations inside the heading even
          // though run-in headings render as plain bold text.
          inlineToTextRuns(
            block.content ?? [],
            state.ctx,
            state.citationCounter,
          );
          const headingRun = new TextRun({
            text: `${headingText}. `,
            bold: true,
            ...(level === 5 ? { italics: true } : {}),
          });
          const next = blocks[i + 1];
          if (next?.type === "paragraph") {
            i += 1;
            emit("BodyText", [
              headingRun,
              ...inlineToTextRuns(
                next.content ?? [],
                state.ctx,
                state.citationCounter,
              ),
            ]);
          } else {
            emit("BodyText", [headingRun]);
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
        for (const child of block.content ?? []) {
          emit(
            "Blockquote",
            inlineToTextRuns(
              child.content ?? [],
              state.ctx,
              state.citationCounter,
            ),
          );
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
            alignment: AlignmentType.CENTER,
            children: [
              ...equationChildren,
              new TextRun(` (${state.equationCounter.n})`),
            ],
          }),
        );
        break;
      }
      case "keywordsLine": {
        const t = getTerms(state.ctx.locale);
        emit("BodyText", [
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
 * Walks Tesina's sectioned doc in order: abstract (own page, localized
 * heading, first paragraph unindented per APA 2.9), body (own page),
 * appendices (own page each; letters only when there are two or more,
 * APA 2.14).
 */
export function visitDocument(
  content: PMJson,
  ctx: DocContext,
): (Paragraph | Table)[] {
  const t = getTerms(ctx.locale);
  const state: VisitState = {
    ctx,
    citationCounter: { next: 0 },
    orderedListInstance: 0,
    tableCounter: { n: 0 },
    figureCounter: { n: 0 },
    equationCounter: { n: 0 },
  };
  const sections = content.content ?? [];
  const appendixCount = sections.filter(
    (s) => s.type === "sectionAppendix",
  ).length;
  let appendixIndex = 0;
  const out: (Paragraph | Table)[] = [];

  for (const section of sections) {
    if (section.type === "sectionAbstract") {
      out.push(
        new Paragraph({
          style: "Heading1",
          children: [new TextRun(t.headings.abstract)],
          pageBreakBefore: true,
        }),
      );
      out.push(
        ...visitBlocks(section.content ?? [], state, {
          firstParagraphStyle: "Normal",
        }),
      );
    } else if (section.type === "sectionBody") {
      out.push(
        ...visitBlocks(section.content ?? [], state, {
          firstPageBreak: true,
        }),
      );
    } else if (section.type === "sectionAppendix") {
      appendixIndex += 1;
      const letter = appendixCount > 1
        ? ` ${String.fromCharCode(64 + appendixIndex)}`
        : "";
      out.push(
        new Paragraph({
          style: "Heading1",
          children: [new TextRun(`${t.headings.appendix}${letter}`)],
          pageBreakBefore: true,
        }),
      );
      out.push(...visitBlocks(section.content ?? [], state));
    }
  }
  return out;
}

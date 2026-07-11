import { TextRun } from "docx";
import {
  buildCitationContext,
  type CitationAttrs,
  type CitationContext,
  type DocLocale,
  formatCitation,
  type Reference,
  type RichRun,
} from "@tesina/engine";
import type { PMJson } from "./input.ts";

export interface DocContext {
  refsById: ReadonlyMap<string, Reference>;
  locale: DocLocale;
  citationCtx: CitationContext;
  /** Order index of the first citation mentioning each refId. */
  firstOccurrenceIndex: ReadonlyMap<string, number>;
}

function collectCitationAttrs(node: PMJson, out: CitationAttrs[]): void {
  if (node.type === "citation" && node.attrs) {
    out.push(node.attrs as unknown as CitationAttrs);
  }
  for (const child of node.content ?? []) collectCitationAttrs(child, out);
}

/**
 * One pre-pass over the whole doc so citations export with the same
 * disambiguation and group-abbreviation behavior the editor shows.
 */
export function buildDocContext(
  content: PMJson,
  references: readonly Reference[],
  locale: DocLocale,
): DocContext {
  const refsById = new Map(references.map((r) => [r.id, r]));
  const citations: CitationAttrs[] = [];
  collectCitationAttrs(content, citations);
  const firstOccurrenceIndex = new Map<string, number>();
  citations.forEach((attrs, index) => {
    for (const item of attrs.items) {
      if (!firstOccurrenceIndex.has(item.refId)) {
        firstOccurrenceIndex.set(item.refId, index);
      }
    }
  });
  return {
    refsById,
    locale,
    citationCtx: buildCitationContext(citations, refsById, locale),
    firstOccurrenceIndex,
  };
}

export function richRunsToTextRuns(
  runs: readonly RichRun[],
  extra: { bold?: boolean } = {},
): TextRun[] {
  return runs.map(
    (run) =>
      new TextRun({
        text: run.text,
        ...(run.italic ? { italics: true } : {}),
        ...(extra.bold ? { bold: true } : {}),
      }),
  );
}

interface MarkFlags {
  bold?: boolean;
  italics?: boolean;
  underline?: object;
}

function markFlags(marks: PMJson["marks"]): MarkFlags {
  const flags: MarkFlags = {};
  for (const mark of marks ?? []) {
    if (mark.type === "bold") flags.bold = true;
    if (mark.type === "italic") flags.italics = true;
    if (mark.type === "underline") flags.underline = {};
  }
  return flags;
}

/** Plain text of a block's inline content — no counter side effects. */
export function inlineText(inline: readonly PMJson[]): string {
  return inline
    .map((n) => (n.type === "text" ? n.text ?? "" : ""))
    .join("");
}

/**
 * Inline content of one block → TextRuns. Citation atoms render through the
 * engine so the exported text always matches the editor chips; the counter
 * tracks document order for first-occurrence group abbreviations and must
 * advance exactly once per citation node — callers convert each block once.
 */
export function inlineToTextRuns(
  inline: readonly PMJson[],
  ctx: DocContext,
  counter: { next: number },
  overrides: { bold?: boolean; italics?: boolean } = {},
): TextRun[] {
  const out: TextRun[] = [];
  for (const node of inline) {
    if (node.type === "text" && typeof node.text === "string") {
      out.push(
        new TextRun({
          text: node.text,
          ...markFlags(node.marks),
          ...overrides,
        }),
      );
    } else if (node.type === "citation" && node.attrs) {
      const attrs = node.attrs as unknown as CitationAttrs;
      const index = counter.next;
      counter.next += 1;
      const firstOccurrenceRefIds = new Set(
        attrs.items
          .map((item) => item.refId)
          .filter((refId) => ctx.firstOccurrenceIndex.get(refId) === index),
      );
      const runs = formatCitation(
        attrs,
        ctx.citationCtx,
        ctx.refsById,
        ctx.locale,
        { firstOccurrenceRefIds },
      );
      out.push(...richRunsToTextRuns(runs));
    } else if (node.type === "hardBreak") {
      out.push(new TextRun({ break: 1 }));
    }
  }
  return out;
}

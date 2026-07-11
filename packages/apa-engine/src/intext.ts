import type { Reference } from "./model/reference.ts";
import type {
  CitationAttrs,
  CitationItem,
  CitationLocator,
} from "./model/citation.ts";
import type { DocLocale, LocaleTerms } from "./locale/terms.ts";
import { getTerms } from "./locale/index.ts";
import type { RichRun } from "./richtext.ts";
import { mergeRuns } from "./richtext.ts";
import { citationYear } from "./dates.ts";
import { formatAuthorsInText, inTextName } from "./names.ts";
import { type CitationContext, contextFor } from "./disambiguate.ts";
import { compareReferences } from "./sort.ts";

export interface FormatCitationOptions {
  /**
   * Reference ids whose group-author abbreviation should be introduced here
   * ("Full Name [ABBR]"). The editor computes this per node instance; when
   * absent, group authors always render their full name (safe default).
   */
  firstOccurrenceRefIds?: ReadonlySet<string>;
}

/** Placeholder for citations pointing at a deleted library reference. */
const MISSING_REF: RichRun = { text: "???" };

function locatorText(locator: CitationLocator, t: LocaleTerms): string {
  switch (locator.type) {
    case "page":
      return `${t.page} ${locator.value}`;
    case "pages":
      return `${t.pages} ${locator.value}`;
    case "paragraph":
      return `${t.paragraph} ${locator.value}`;
    case "timestamp":
      return locator.value;
  }
}

/** First words of the title stand in for a missing author (APA 8.14). */
function shortTitleRuns(ref: Reference): RichRun[] {
  const words = ref.title.trim().split(/\s+/);
  const short = words.slice(0, 4).join(" ").replace(/[.,;:]+$/, "");
  const standalone = ref.type === "book" || ref.type === "website";
  return standalone
    ? [{ text: short, italic: true }]
    : [{ text: `“${short}”` }];
}

interface AuthorPart {
  runs: RichRun[];
  /** For narrative group-author first use: "Name (ABBR, 2020)". */
  abbreviationForYearParens?: string;
}

function authorPart(
  ref: Reference,
  mode: CitationAttrs["mode"],
  ctx: CitationContext | undefined,
  t: LocaleTerms,
  opts?: FormatCitationOptions,
): AuthorPart {
  const { minAuthors, useInitials } = contextFor(ctx, ref.id);
  const authors = ref.authors;

  if (authors.length === 0) return { runs: shortTitleRuns(ref) };

  const only = authors[0]!;
  if (authors.length === 1 && only.kind === "group") {
    // Without occurrence info the abbreviation machinery stays off — always
    // spelling the name out is verbose but never wrong.
    if (!only.abbreviation || !opts?.firstOccurrenceRefIds) {
      return { runs: [{ text: only.name }] };
    }
    if (!opts.firstOccurrenceRefIds.has(ref.id)) {
      return { runs: [{ text: only.abbreviation }] };
    }
    return mode === "parenthetical"
      ? { runs: [{ text: `${only.name} [${only.abbreviation}]` }] }
      : {
        runs: [{ text: only.name }],
        abbreviationForYearParens: only.abbreviation,
      };
  }

  const andWord = mode === "narrative" ? t.andNarrative : t.andParenthetical;
  const shown = authors.length <= 2
    ? authors.length
    : Math.min(minAuthors, authors.length);

  if (shown >= authors.length) {
    return {
      runs: [{ text: formatAuthorsInText(authors, useInitials, andWord, t) }],
    };
  }

  const names = authors
    .slice(0, shown)
    .map((a) => inTextName(a, useInitials));
  // Comma before "et al." only when two or more names are spelled out.
  const separator = shown > 1 ? ", " : " ";
  return {
    runs: [{ text: `${names.join(", ")}${separator}${t.etAl}` }],
  };
}

/**
 * Personal communications cite initials-first name + term + full date and
 * never join the reference list (APA 8.9): "(N. Salgado, comunicación
 * personal, 3 de julio de 2026)".
 */
function personalCommunicationRuns(
  ref: Reference,
  mode: CitationAttrs["mode"],
  t: LocaleTerms,
): RichRun[] {
  const first = ref.authors[0];
  const name = first ? inTextName(first, true) : "";
  const dateText = ref.date.year !== undefined
    ? t.formatLongDate(ref.date)
    : t.noDate;
  if (mode === "narrative") {
    return [{ text: `${name} (${t.personalCommunication}, ${dateText})` }];
  }
  return [{ text: `${name}, ${t.personalCommunication}, ${dateText}` }];
}

function itemRuns(
  item: CitationItem,
  ref: Reference | undefined,
  mode: CitationAttrs["mode"],
  ctx: CitationContext | undefined,
  t: LocaleTerms,
  opts?: FormatCitationOptions,
): RichRun[] {
  if (!ref) return [MISSING_REF];
  if (ref.type === "personalCommunication") {
    return personalCommunicationRuns(ref, mode, t);
  }

  const { yearSuffix } = contextFor(ctx, ref.id);
  const year = citationYear(ref.date, t, yearSuffix);
  const tail: string[] = [];
  if (item.locator) tail.push(locatorText(item.locator, t));
  if (item.suffix) tail.push(item.suffix);

  if (mode === "narrative") {
    const inner = [year, ...tail].join(", ");
    if (item.suppressAuthor) return [{ text: `(${inner})` }];
    const author = authorPart(ref, mode, ctx, t, opts);
    const parens = author.abbreviationForYearParens
      ? `(${author.abbreviationForYearParens}, ${inner})`
      : `(${inner})`;
    const runs: RichRun[] = [];
    if (item.prefix) runs.push({ text: `${item.prefix} ` });
    runs.push(...author.runs, { text: ` ${parens}` });
    return runs;
  }

  const runs: RichRun[] = [];
  if (item.prefix) runs.push({ text: `${item.prefix} ` });
  if (!item.suppressAuthor) {
    runs.push(...authorPart(ref, mode, ctx, t, opts).runs);
    runs.push({ text: ", " });
  }
  runs.push({ text: [year, ...tail].join(", ") });
  return runs;
}

/**
 * Render one citation node. Parenthetical multi-work citations re-sort into
 * reference-list order and join with semicolons (APA 8.12); narrative
 * citations render their first item (the UI enforces single-item narrative).
 */
export function formatCitation(
  attrs: CitationAttrs,
  ctx: CitationContext | undefined,
  refsById: ReadonlyMap<string, Reference>,
  locale: DocLocale,
  opts?: FormatCitationOptions,
): RichRun[] {
  const t = getTerms(locale);

  if (attrs.mode === "narrative") {
    const item = attrs.items[0];
    if (!item) return [MISSING_REF];
    return mergeRuns(
      itemRuns(item, refsById.get(item.refId), "narrative", ctx, t, opts),
    );
  }

  const resolved = attrs.items.map((item) => ({
    item,
    ref: refsById.get(item.refId),
  }));
  resolved.sort((a, b) => {
    if (!a.ref && !b.ref) return 0;
    if (!a.ref) return 1;
    if (!b.ref) return -1;
    return compareReferences(a.ref, b.ref, locale);
  });

  const runs: RichRun[] = [{ text: "(" }];
  resolved.forEach(({ item, ref }, i) => {
    if (i > 0) runs.push({ text: "; " });
    runs.push(...itemRuns(item, ref, "parenthetical", ctx, t, opts));
  });
  runs.push({ text: ")" });
  return mergeRuns(runs);
}

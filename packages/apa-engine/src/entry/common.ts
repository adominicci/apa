import type { RichRun } from "../richtext.ts";
import { mergeRuns } from "../richtext.ts";
import type { Contributor, Reference } from "../model/reference.ts";
import type { LocaleTerms } from "../locale/terms.ts";
import { referenceDate } from "../dates.ts";
import { formatAuthorsForReferences, invertedName } from "../names.ts";

/** En dash for page and year ranges. */
export const EN_DASH = "–";

export interface EntryContext {
  yearSuffix?: string;
}

export function endsWithTerminalPunct(text: string): boolean {
  return /[.!?]["”']?\s*$/.test(text);
}

/** Append a period to the block unless it already ends in . ! or ? */
export function closeBlock(runs: RichRun[]): RichRun[] {
  if (runs.length === 0) return runs;
  const last = runs[runs.length - 1]!;
  if (endsWithTerminalPunct(last.text)) return runs;
  return [...runs, { text: "." }];
}

/** Join non-empty blocks with a single space. */
export function assemble(blocks: ReadonlyArray<RichRun[]>): RichRun[] {
  const out: RichRun[] = [];
  for (const block of blocks) {
    if (block.length === 0) continue;
    if (out.length > 0) out.push({ text: " " });
    out.push(...block);
  }
  return mergeRuns(out);
}

/**
 * Author position (APA 9.7–9.11). Edited books whose `authors` is empty put
 * the editors here with "(Ed.)"/"(Eds.)"; with no contributors at all the
 * block is empty and the caller moves the title into first position.
 */
export function authorsBlock(
  authors: readonly Contributor[],
  t: LocaleTerms,
  editorsAsAuthors?: readonly Contributor[],
): RichRun[] {
  if (authors.length > 0) {
    return closeBlock([{ text: formatAuthorsForReferences(authors, t) }]);
  }
  if (editorsAsAuthors && editorsAsAuthors.length > 0) {
    const names = formatAuthorsForReferences(editorsAsAuthors, t);
    const label = editorsAsAuthors.length > 1 ? t.eds : t.ed;
    return closeBlock([{ text: `${names} (${label})` }]);
  }
  return [];
}

export function dateBlock(
  ref: Reference,
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  return [{ text: `(${referenceDate(ref.date, t, ctx?.yearSuffix)}).` }];
}

/** Titles of works that live inside a larger whole: plain text (APA 9.19). */
export function plainTitleBlock(title: string): RichRun[] {
  return closeBlock([{ text: title }]);
}

/**
 * Titles of standalone works: italic, with an optional plain parenthetical
 * ("(2nd ed., Vol. 3)") that stays outside the italics (APA 9.20).
 */
export function italicTitleBlock(
  title: string,
  parenthetical?: string,
): RichRun[] {
  const runs: RichRun[] = [{ text: title, italic: true }];
  if (parenthetical) runs.push({ text: ` (${parenthetical})` });
  return closeBlock(runs);
}

/** "45–67", "45", or undefined. */
export function pageRange(
  start?: string,
  end?: string,
): string | undefined {
  if (start && end) return `${start}${EN_DASH}${end}`;
  return start || undefined;
}

const DOI_PREFIX = /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:)\s*/i;

/**
 * DOI wins over URL (APA 9.34); rendered as a doi.org link with NO trailing
 * period so students never copy a broken link.
 */
export function linkBlock(ref: Reference): RichRun[] {
  if (ref.doi) {
    const bare = ref.doi.trim().replace(DOI_PREFIX, "");
    return [{ text: `https://doi.org/${bare}` }];
  }
  if (ref.url) return [{ text: ref.url.trim() }];
  return [];
}

/** Free-text escape hatch, closed with a period, before the link block. */
export function extraBlock(ref: Reference): RichRun[] {
  return ref.extra ? closeBlock([{ text: ref.extra }]) : [];
}

/**
 * Edition/volume parenthetical content for books and chapters:
 * "2" → "2nd ed." / "2.ª ed."; non-numeric editions ("Rev.") pass through to
 * "Rev. ed."; volumes render as "Vol. N". Joined with ", ".
 */
export function editionVolumeParts(
  t: LocaleTerms,
  edition?: string,
  volume?: string,
): string[] {
  const parts: string[] = [];
  if (edition) {
    const numeric = Number.parseInt(edition, 10);
    const ordinalText = Number.isNaN(numeric) ? edition : t.ordinal(numeric);
    parts.push(t.edition(ordinalText));
  }
  if (volume) parts.push(`${t.volumeAbbrev} ${volume}`);
  return parts;
}

/** Key identifying an author list for suffix grouping and et-al collisions. */
export function authorsKey(authors: readonly Contributor[]): string {
  return authors.map((a) => invertedName(a).toLowerCase()).join(";");
}

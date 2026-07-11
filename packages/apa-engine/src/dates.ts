import type { APADate } from "./model/reference.ts";
import type { LocaleTerms } from "./locale/terms.ts";

/**
 * Content of the reference-list date parenthesis (caller adds the parens):
 * "2020", "2020, May 3" / "2020, 3 de mayo", "n.d." / "s. f.", "in press" /
 * "en prensa". A date with no year and no flags is treated as undated.
 * Disambiguation suffixes attach to the year ("2020a, May 3") and hyphenate
 * onto textual dates ("n.d.-a", "in press-a").
 */
export function referenceDate(
  d: APADate,
  t: LocaleTerms,
  yearSuffix?: string,
): string {
  if (d.inPress) {
    return yearSuffix ? `${t.inPress}-${yearSuffix}` : t.inPress;
  }
  if (d.noDate || d.year === undefined) {
    return yearSuffix ? `${t.noDate}-${yearSuffix}` : t.noDate;
  }
  const full = t.formatDate(d);
  if (!yearSuffix) return full;
  return full.replace(String(d.year), `${d.year}${yearSuffix}`);
}

/** Year-only form used by in-text citations, plus disambiguation suffix. */
export function citationYear(
  d: APADate,
  t: LocaleTerms,
  yearSuffix?: string,
): string {
  if (d.inPress) {
    return yearSuffix ? `${t.inPress}-${yearSuffix}` : t.inPress;
  }
  if (d.noDate || d.year === undefined) {
    // Suffixed undated works hyphenate: "n.d.-a" / "s. f.-a" (APA 8.19).
    return yearSuffix ? `${t.noDate}-${yearSuffix}` : t.noDate;
  }
  return yearSuffix ? `${d.year}${yearSuffix}` : String(d.year);
}

/** Sort key: undated first, then years ascending, in-press last (APA 9.47). */
export function dateSortKey(d: APADate): number {
  if (d.inPress) return Number.MAX_SAFE_INTEGER;
  if (d.noDate || d.year === undefined) return Number.MIN_SAFE_INTEGER;
  return d.year;
}

import type { Reference } from "./model/reference.ts";
import type { DocLocale } from "./locale/terms.ts";
import { getTerms } from "./locale/index.ts";
import { invertedName } from "./names.ts";
import { dateSortKey } from "./dates.ts";

const collators = new Map<string, Intl.Collator>();

/**
 * Base sensitivity groups case and accent variants together while the "es"
 * collator still treats ñ as its own letter after n, which is exactly the
 * alphabetization Hispanic reference lists expect.
 */
export function getCollator(locale: DocLocale): Intl.Collator {
  const tag = getTerms(locale).collatorLocale;
  let collator = collators.get(tag);
  if (!collator) {
    collator = new Intl.Collator(tag, { sensitivity: "base" });
    collators.set(tag, collator);
  }
  return collator;
}

/** Title key for no-author works: leading article dropped (APA 9.49). */
export function titleSortKey(title: string, locale: DocLocale): string {
  const t = getTerms(locale);
  const trimmed = title.trim();
  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace > 0) {
    const firstWord = trimmed.slice(0, firstSpace).toLowerCase();
    if (t.leadingArticles.includes(firstWord)) {
      return trimmed.slice(firstSpace + 1);
    }
  }
  return trimmed;
}

function leadKey(ref: Reference, locale: DocLocale): string {
  const first = ref.authors[0];
  if (!first) return titleSortKey(ref.title, locale);
  return invertedName(first);
}

/**
 * APA 9.44–9.49 ordering:
 * 1. Alphabetically by first author surname (or title when authorless),
 *    letter by letter with "nothing precedes something".
 * 2. Same first author: a one-author work precedes multi-author works, and
 *    multi-author works compare on the subsequent authors.
 * 3. Identical author lists: chronologically (undated, years, in press).
 * 4. Same authors and year: by title — this order drives the a/b/c suffixes.
 */
export function compareReferences(
  a: Reference,
  b: Reference,
  locale: DocLocale,
): number {
  const collator = getCollator(locale);

  const byLead = collator.compare(leadKey(a, locale), leadKey(b, locale));
  if (byLead !== 0) return byLead;

  const max = Math.max(a.authors.length, b.authors.length);
  for (let i = 1; i < max; i++) {
    const nameA = a.authors[i];
    const nameB = b.authors[i];
    if (!nameA && !nameB) break;
    if (!nameA) return -1; // nothing precedes something
    if (!nameB) return 1;
    const byName = collator.compare(invertedName(nameA), invertedName(nameB));
    if (byName !== 0) return byName;
  }

  const byDate = dateSortKey(a.date) - dateSortKey(b.date);
  if (byDate !== 0) return byDate;

  return collator.compare(
    titleSortKey(a.title, locale),
    titleSortKey(b.title, locale),
  );
}

export function sortReferences(
  refs: readonly Reference[],
  locale: DocLocale,
): Reference[] {
  return [...refs].sort((a, b) => compareReferences(a, b, locale));
}

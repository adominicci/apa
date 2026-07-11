import type { Reference } from "./model/reference.ts";
import type { CitationAttrs } from "./model/citation.ts";
import type { DocLocale } from "./locale/terms.ts";
import { assignYearSuffixes } from "./reference-list.ts";
import { initialsOf, inTextName } from "./names.ts";
import { getCollator } from "./sort.ts";

export interface PerRefContext {
  yearSuffix?: string;
  /** How many author names to spell out before "et al." (APA 8.18). */
  minAuthors: number;
  /** Same surname, different first authors → initials in text (APA 8.20). */
  useInitials: boolean;
}

export interface CitationContext {
  perRef: ReadonlyMap<string, PerRefContext>;
}

const EMPTY_CONTEXT: PerRefContext = {
  minAuthors: 1,
  useInitials: false,
};

export function contextFor(
  ctx: CitationContext | undefined,
  refId: string,
): PerRefContext {
  return ctx?.perRef.get(refId) ?? EMPTY_CONTEXT;
}

function dateKey(ref: Reference): string {
  if (ref.date.inPress) return "in-press";
  if (ref.date.noDate || ref.date.year === undefined) return "no-date";
  return String(ref.date.year);
}

/**
 * Whole-document pass producing everything in-text citations need to be
 * unambiguous. Pure and cheap (essay-scale inputs); the editor recomputes it
 * on every transaction and memoizes by identity.
 */
export function buildCitationContext(
  citationsInDocOrder: readonly CitationAttrs[],
  refsById: ReadonlyMap<string, Reference>,
  locale: DocLocale,
): CitationContext {
  const cited: Reference[] = [];
  const seen = new Set<string>();
  for (const citation of citationsInDocOrder) {
    for (const item of citation.items) {
      if (seen.has(item.refId)) continue;
      const ref = refsById.get(item.refId);
      if (!ref) continue;
      seen.add(item.refId);
      cited.push(ref);
    }
  }

  const yearSuffixes = assignYearSuffixes(cited, locale);
  const perRef = new Map<string, PerRefContext>();
  for (const ref of cited) {
    perRef.set(ref.id, {
      yearSuffix: yearSuffixes.get(ref.id),
      minAuthors: 1,
      useInitials: false,
    });
  }

  resolveEtAlCollisions(cited, perRef, locale);
  markSameSurnameFirstAuthors(cited, perRef, locale);

  return { perRef };
}

function surnames(ref: Reference): string[] {
  return ref.authors.map((a) => inTextName(a, false));
}

/**
 * APA 8.18: if two different works shorten to the same "(First et al.,
 * year)", spell out as many authors as needed to tell them apart. "et al."
 * must stand in for at least two names, so an expansion that would leave a
 * single omitted author writes the full list instead.
 */
function resolveEtAlCollisions(
  cited: readonly Reference[],
  perRef: Map<string, PerRefContext>,
  locale: DocLocale,
): void {
  const collator = getCollator(locale);
  const groups = new Map<string, Reference[]>();
  for (const ref of cited) {
    if (ref.authors.length < 3) continue;
    const first = surnames(ref)[0] ?? "";
    const suffix = perRef.get(ref.id)?.yearSuffix ?? "";
    const key = `${first.toLowerCase()}|${dateKey(ref)}${suffix}`;
    const group = groups.get(key);
    if (group) group.push(ref);
    else groups.set(key, [ref]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Same author list already got year suffixes; only differing lists
    // remain ambiguous and need expansion.
    const distinct = group.filter((ref, i) =>
      group.findIndex((other) =>
        surnamesEqual(surnames(other), surnames(ref), collator)
      ) === i
    );
    if (distinct.length < 2) continue;

    let k = 1;
    const maxLen = Math.max(...distinct.map((r) => r.authors.length));
    while (k < maxLen) {
      k += 1;
      const prefixes = distinct.map((r) =>
        surnames(r).slice(0, k).join(";").toLowerCase()
      );
      if (new Set(prefixes).size === prefixes.length) break;
    }
    for (const ref of group) {
      const total = ref.authors.length;
      const entry = perRef.get(ref.id);
      if (!entry) continue;
      // "et al." must replace at least two authors.
      entry.minAuthors = k >= total - 1 ? total : k;
    }
  }
}

function surnamesEqual(
  a: readonly string[],
  b: readonly string[],
  collator: Intl.Collator,
): boolean {
  return a.length === b.length &&
    a.every((name, i) => collator.compare(name, b[i]!) === 0);
}

/**
 * APA 8.20: different first authors sharing a surname get initials in every
 * in-text citation of their works, even when years differ.
 */
function markSameSurnameFirstAuthors(
  cited: readonly Reference[],
  perRef: Map<string, PerRefContext>,
  locale: DocLocale,
): void {
  const collator = getCollator(locale);
  const byLead = new Map<string, { initials: string; refIds: string[] }[]>();

  for (const ref of cited) {
    const first = ref.authors[0];
    if (!first || first.kind !== "person") continue;
    const key = first.family.toLowerCase();
    const initials = first.given ? initialsOf(first.given) : "";
    const entries = byLead.get(key) ?? [];
    const existing = entries.find(
      (e) => collator.compare(e.initials, initials) === 0,
    );
    if (existing) existing.refIds.push(ref.id);
    else entries.push({ initials, refIds: [ref.id] });
    byLead.set(key, entries);
  }

  for (const entries of byLead.values()) {
    const withInitials = entries.filter((e) => e.initials !== "");
    if (withInitials.length < 2) continue;
    for (const entry of entries) {
      for (const refId of entry.refIds) {
        const ctx = perRef.get(refId);
        if (ctx) ctx.useInitials = true;
      }
    }
  }
}

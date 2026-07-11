import type { Reference } from "./model/reference.ts";
import type { DocLocale } from "./locale/terms.ts";
import { getTerms } from "./locale/index.ts";
import type { RichRun } from "./richtext.ts";
import { compareReferences, sortReferences } from "./sort.ts";
import { authorsKey } from "./entry/common.ts";
import { journalArticleEntry } from "./entry/journalArticle.ts";
import { bookEntry } from "./entry/book.ts";
import { bookChapterEntry } from "./entry/bookChapter.ts";
import { websiteEntry } from "./entry/website.ts";
import { reportEntry, thesisEntry } from "./entry/report.ts";
import {
  conferencePaperEntry,
  newspaperArticleEntry,
  referenceEntryEntry,
} from "./entry/periodical.ts";
import {
  podcastEpisodeEntry,
  socialMediaEntry,
  softwareEntry,
  videoEntry,
} from "./entry/media.ts";

export interface RefListContext {
  /** a/b/c suffixes keyed by reference id (APA 9.47: same authors + year). */
  yearSuffixes: ReadonlyMap<string, string>;
}

function dateKey(ref: Reference): string {
  if (ref.date.inPress) return "in-press";
  if (ref.date.noDate || ref.date.year === undefined) return "no-date";
  return String(ref.date.year);
}

/**
 * Works by the identical author list in the identical year get letter
 * suffixes in reference-list order (which, within such a group, is title
 * order — that is what compareReferences ties on). Authorless works group
 * by title instead so two same-year anonymous reports don't collide.
 */
export function assignYearSuffixes(
  refs: readonly Reference[],
  locale: DocLocale,
): Map<string, string> {
  const groups = new Map<string, Reference[]>();
  for (const ref of refs) {
    const identity = ref.authors.length > 0
      ? authorsKey(ref.authors)
      : `title:${ref.title.trim().toLowerCase()}`;
    const key = `${identity}|${dateKey(ref)}`;
    const group = groups.get(key);
    if (group) group.push(ref);
    else groups.set(key, [ref]);
  }

  const suffixes = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => compareReferences(a, b, locale));
    ordered.forEach((ref, i) => {
      suffixes.set(ref.id, String.fromCharCode(97 + i)); // a, b, c…
    });
  }
  return suffixes;
}

export function formatReferenceEntry(
  ref: Reference,
  locale: DocLocale,
  ctx?: RefListContext,
): RichRun[] {
  const t = getTerms(locale);
  const entryCtx = { yearSuffix: ctx?.yearSuffixes.get(ref.id) };
  switch (ref.type) {
    case "journalArticle":
      return journalArticleEntry(ref, t, entryCtx);
    case "book":
      return bookEntry(ref, t, entryCtx);
    case "bookChapter":
      return bookChapterEntry(ref, t, entryCtx);
    case "website":
      return websiteEntry(ref, t, entryCtx);
    case "report":
      return reportEntry(ref, t, entryCtx);
    case "thesis":
      return thesisEntry(ref, t, entryCtx);
    case "conferencePaper":
      return conferencePaperEntry(ref, t, entryCtx);
    case "newspaperArticle":
      return newspaperArticleEntry(ref, t, entryCtx);
    case "referenceEntry":
      return referenceEntryEntry(ref, t, entryCtx);
    case "video":
      return videoEntry(ref, t, entryCtx);
    case "podcastEpisode":
      return podcastEpisodeEntry(ref, t, entryCtx);
    case "socialMedia":
      return socialMediaEntry(ref, t, entryCtx);
    case "software":
      return softwareEntry(ref, t, entryCtx);
    case "personalCommunication":
      return [];
  }
}

export interface ReferenceListResult {
  entries: { refId: string; runs: RichRun[] }[];
  ctx: RefListContext;
}

/** Sorted, suffixed, formatted — the entire references section in one call. */
export function buildReferenceList(
  refs: readonly Reference[],
  locale: DocLocale,
): ReferenceListResult {
  const unique = new Map<string, Reference>();
  for (const ref of refs) {
    // Personal communications are cited in text only (APA 8.9).
    if (ref.type === "personalCommunication") continue;
    unique.set(ref.id, ref);
  }
  const sorted = sortReferences([...unique.values()], locale);
  const ctx: RefListContext = {
    yearSuffixes: assignYearSuffixes(sorted, locale),
  };
  return {
    entries: sorted.map((ref) => ({
      refId: ref.id,
      runs: formatReferenceEntry(ref, locale, ctx),
    })),
    ctx,
  };
}

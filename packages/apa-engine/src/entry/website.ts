import type { Website } from "../model/reference.ts";
import type { LocaleTerms } from "../locale/terms.ts";
import type { RichRun } from "../richtext.ts";
import {
  assemble,
  authorsBlock,
  closeBlock,
  dateBlock,
  type EntryContext,
  extraBlock,
  italicTitleBlock,
  linkBlock,
} from "./common.ts";

/**
 * Pattern (APA 10.16): Author, A. (2020, May 3). *Title of the page*. Site
 * Name. https://… — the site name is omitted when it repeats a group
 * author, and unstable pages add "Retrieved <long date>, from" before the
 * URL ("Recuperado el <fecha> de" in Spanish).
 */
export function websiteEntry(
  ref: Website,
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  const groupAuthor = ref.authors.find(
    (a): a is Extract<typeof a, { kind: "group" }> => a.kind === "group",
  );
  const siteRepeatsAuthor = ref.siteName !== undefined &&
    groupAuthor !== undefined &&
    ref.siteName.trim().toLowerCase() === groupAuthor.name.trim().toLowerCase();
  const site = ref.siteName && !siteRepeatsAuthor
    ? closeBlock([{ text: ref.siteName }])
    : [];

  let link = linkBlock(ref);
  if (ref.retrievedDate && link.length > 0) {
    const longDate = t.formatLongDate(ref.retrievedDate);
    link = [{ text: `${t.retrieved(longDate)} ` }, ...link];
  }

  const author = authorsBlock(ref.authors, t);
  const title = italicTitleBlock(ref.title);
  const blocks = author.length > 0
    ? [author, dateBlock(ref, t, ctx), title, site]
    : [title, dateBlock(ref, t, ctx), site];

  return assemble([...blocks, extraBlock(ref), link]);
}

import type {
  PodcastEpisode,
  SocialMedia,
  Software,
  Video,
} from "../model/reference.ts";
import type { Contributor } from "../model/reference.ts";
import type { LocaleTerms } from "../locale/terms.ts";
import type { RichRun } from "../richtext.ts";
import { referenceDate } from "../dates.ts";
import { formatAuthorsForReferences } from "../names.ts";
import {
  assemble,
  closeBlock,
  type EntryContext,
  extraBlock,
  linkBlock,
} from "./common.ts";

function dateBlock(
  ref: { date: Video["date"] },
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  return [{ text: `(${referenceDate(ref.date, t, ctx?.yearSuffix)}).` }];
}

/**
 * Author position with an optional bracketed screen name (APA 10.12):
 * "Pérez, J. [Canal de Historia]." — or the bare username when there is no
 * real name.
 */
function authorsWithUsername(
  authors: readonly Contributor[],
  username: string | undefined,
  t: LocaleTerms,
): RichRun[] {
  if (authors.length === 0) {
    return username ? closeBlock([{ text: username }]) : [];
  }
  let names = formatAuthorsForReferences(authors, t);
  if (username && authors.length === 1) {
    names = `${names} [${username}]`;
  }
  return closeBlock([{ text: names }]);
}

/**
 * Pattern (APA 10.12): Author [username]. (2021, March 2). *Title of the
 * video* [Video]. Platform. URL
 */
export function videoEntry(
  ref: Video,
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  const title = closeBlock([
    { text: ref.title, italic: true },
    { text: ` [${t.brackets.video}]` },
  ]);
  const platform = closeBlock([{ text: ref.platform }]);
  const author = authorsWithUsername(ref.authors, ref.username, t);
  const blocks = author.length > 0
    ? [author, dateBlock(ref, t, ctx), title, platform]
    : [title, dateBlock(ref, t, ctx), platform];
  return assemble([...blocks, extraBlock(ref), linkBlock(ref)]);
}

/**
 * Pattern (APA 10.13): Host, H. (Host). (2022, May 4). Episode title
 * (No. 12) [Audio podcast episode]. In *Show title*. Platform. URL
 */
export function podcastEpisodeEntry(
  ref: PodcastEpisode,
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  const author = ref.authors.length > 0
    ? closeBlock([{
      text: `${formatAuthorsForReferences(ref.authors, t)} (${
        t.hostRole(ref.authors.length)
      })`,
    }])
    : [];

  const title: RichRun[] = [{ text: ref.title }];
  if (ref.episodeNumber) {
    title.push({ text: ` (${t.episodeNumber(ref.episodeNumber)})` });
  }
  title.push({ text: ` [${t.brackets.podcastEpisode}]` });

  const source: RichRun[] = [{ text: `${t.in} ` }, {
    text: ref.showTitle,
    italic: true,
  }, { text: "." }];
  if (ref.platform) source.push({ text: ` ${ref.platform}.` });

  const blocks = author.length > 0
    ? [author, dateBlock(ref, t, ctx), closeBlock(title), closeBlock(source)]
    : [closeBlock(title), dateBlock(ref, t, ctx), closeBlock(source)];
  return assemble([...blocks, extraBlock(ref), linkBlock(ref)]);
}

/**
 * Pattern (APA 10.15): Author [@handle]. (2024, January 5). *Post text up
 * to twenty words* [Tuit]. Platform. URL — the bracket label is typed by
 * the user in the document's language.
 */
export function socialMediaEntry(
  ref: SocialMedia,
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  const title = closeBlock([
    { text: ref.title, italic: true },
    { text: ` [${ref.contentType}]` },
  ]);
  const platform = closeBlock([{ text: ref.platform }]);
  const author = authorsWithUsername(ref.authors, ref.username, t);
  const blocks = author.length > 0
    ? [author, dateBlock(ref, t, ctx), title, platform]
    : [title, dateBlock(ref, t, ctx), platform];
  return assemble([...blocks, extraBlock(ref), linkBlock(ref)]);
}

/**
 * Pattern (APA 10.10): Author/Org. (2023). *Title* (Version 2.1)
 * [Computer software]. Publisher. URL
 */
export function softwareEntry(
  ref: Software,
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  const bracket = ref.kind === "dataset"
    ? t.brackets.dataset
    : t.brackets.software;
  const title: RichRun[] = [{ text: ref.title, italic: true }];
  if (ref.version) {
    title.push({ text: ` (${t.versionLabel(ref.version)})` });
  }
  title.push({ text: ` [${bracket}]` });

  const publisher = ref.publisher ? closeBlock([{ text: ref.publisher }]) : [];
  const author = ref.authors.length > 0
    ? closeBlock([{ text: formatAuthorsForReferences(ref.authors, t) }])
    : [];
  const blocks = author.length > 0
    ? [author, dateBlock(ref, t, ctx), closeBlock(title), publisher]
    : [closeBlock(title), dateBlock(ref, t, ctx), publisher];
  return assemble([...blocks, extraBlock(ref), linkBlock(ref)]);
}

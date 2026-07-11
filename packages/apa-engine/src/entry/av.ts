import type { Artwork, Film, Music, TVEpisode } from "../model/reference.ts";
import type { LocaleTerms } from "../locale/terms.ts";
import type { RichRun } from "../richtext.ts";
import { appendYearRange, referenceDate } from "../dates.ts";
import {
  formatAuthorsForReferences,
  formatContributorsInline,
} from "../names.ts";
import {
  assemble,
  authorsBlock,
  closeBlock,
  dateBlock,
  type EntryContext,
  extraBlock,
  linkBlock,
} from "./common.ts";

/** "Names (Role)." — the credited author block films and episodes share. */
function creditedAuthors(
  ref: { authors: Film["authors"] },
  role: string,
  t: LocaleTerms,
): RichRun[] {
  if (ref.authors.length === 0) return [];
  return closeBlock([
    { text: `${formatAuthorsForReferences(ref.authors, t)} (${role})` },
  ]);
}

/**
 * Pattern (APA 10.12): Director, D. (Director). (2019). *Title of the film*
 * [Film]. Production Company. — TV series credit executive producers and may
 * span years: "(2015–2019)" / "(2015–present)".
 */
export function filmEntry(
  ref: Film,
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  const role = t.avRole(
    ref.kind === "tvSeries" ? "execProducer" : "director",
    ref.authors.length,
  );
  const dateText = appendYearRange(
    referenceDate(ref.date, t, ctx?.yearSuffix),
    ref.date,
    t,
    ref.yearEnd,
    ref.ongoing,
  );
  const date: RichRun[] = [{ text: `(${dateText}).` }];
  const bracket = ref.kind === "tvSeries"
    ? t.brackets.tvSeries
    : t.brackets.film;
  const title = closeBlock([
    { text: ref.title, italic: true },
    { text: ` [${bracket}]` },
  ]);
  const company = ref.productionCompany
    ? closeBlock([{ text: ref.productionCompany }])
    : [];

  const author = creditedAuthors(ref, role, t);
  const blocks = author.length > 0
    ? [author, date, title, company]
    : [title, date, company];
  return assemble([...blocks, extraBlock(ref), linkBlock(ref)]);
}

/**
 * Pattern (APA 10.12): Writer, W. (Writer & Director). (2020, May 4).
 * Episode title (Season 2, Episode 5) [TV series episode]. In E. Productor
 * (Executive Producer), *Series title*. Network.
 */
export function tvEpisodeEntry(
  ref: TVEpisode,
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  const role = t.avRole(ref.credit ?? "writerDirector", ref.authors.length);

  const title: RichRun[] = [{ text: ref.title }];
  const seasonEpisode = t.seasonEpisode(ref.season, ref.episode);
  if (seasonEpisode) title.push({ text: ` (${seasonEpisode})` });
  title.push({ text: ` [${t.brackets.tvSeriesEpisode}]` });

  const source: RichRun[] = [{ text: `${t.in} ` }];
  if (ref.executiveProducers && ref.executiveProducers.length > 0) {
    const producers = formatContributorsInline(ref.executiveProducers, t);
    const producerRole = t.avRole(
      "execProducer",
      ref.executiveProducers.length,
    );
    source.push({ text: `${producers} (${producerRole}), ` });
  }
  source.push({ text: ref.seriesTitle, italic: true }, { text: "." });

  const company = ref.productionCompany
    ? closeBlock([{ text: ref.productionCompany }])
    : [];

  const author = creditedAuthors(ref, role, t);
  const blocks = author.length > 0
    ? [author, dateBlock(ref, t, ctx), closeBlock(title), source, company]
    : [closeBlock(title), dateBlock(ref, t, ctx), source, company];
  return assemble([...blocks, extraBlock(ref), linkBlock(ref)]);
}

/**
 * Pattern (APA 10.13): Artist, A. (2021). *Album title* [Album]. Label. —
 * songs on an album keep a plain title and point at it: Song title [Song].
 * On *Album title*. Label.
 */
export function musicEntry(
  ref: Music,
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  const bracket = ref.kind === "album" ? t.brackets.album : t.brackets.song;
  const onAlbum = ref.kind === "song" && ref.albumTitle;

  const title = onAlbum
    ? closeBlock([{ text: ref.title }, { text: ` [${bracket}]` }])
    : closeBlock([
      { text: ref.title, italic: true },
      { text: ` [${bracket}]` },
    ]);
  const source = onAlbum
    ? closeBlock([{ text: `${t.onAlbum} ` }, {
      text: ref.albumTitle!,
      italic: true,
    }])
    : [];
  const label = ref.label ? closeBlock([{ text: ref.label }]) : [];

  const author = authorsBlock(ref.authors, t);
  const blocks = author.length > 0
    ? [author, dateBlock(ref, t, ctx), title, source, label]
    : [title, dateBlock(ref, t, ctx), source, label];
  return assemble([...blocks, extraBlock(ref), linkBlock(ref)]);
}

/**
 * Pattern (APA 10.14): Artist, A. (1997). *Title of the work* [Painting].
 * Museum, City, Country. URL — also covers photos, maps, infographics, and
 * stock images, whose "venue" is the hosting site.
 */
export function artworkEntry(
  ref: Artwork,
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  const title: RichRun[] = [{ text: ref.title, italic: true }];
  if (ref.medium) title.push({ text: ` [${ref.medium}]` });

  const venueText = ref.venue
    ? ref.location ? `${ref.venue}, ${ref.location}` : ref.venue
    : undefined;
  const venue = venueText ? closeBlock([{ text: venueText }]) : [];

  const author = authorsBlock(ref.authors, t);
  const blocks = author.length > 0
    ? [author, dateBlock(ref, t, ctx), closeBlock(title), venue]
    : [closeBlock(title), dateBlock(ref, t, ctx), venue];
  return assemble([...blocks, extraBlock(ref), linkBlock(ref)]);
}

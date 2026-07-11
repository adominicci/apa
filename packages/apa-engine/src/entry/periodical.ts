import type {
  ConferencePaper,
  NewspaperArticle,
  ReferenceEntry,
} from "../model/reference.ts";
import type { LocaleTerms } from "../locale/terms.ts";
import type { RichRun } from "../richtext.ts";
import { referenceDate } from "../dates.ts";
import {
  assemble,
  authorsBlock,
  closeBlock,
  editionVolumeParts,
  type EntryContext,
  extraBlock,
  italicTitleBlock,
  linkBlock,
  pageRange,
  plainTitleBlock,
} from "./common.ts";

/**
 * Pattern (APA 10.5): Author, A. (2023, September 5–8). *Title of the
 * contribution* [Paper presentation]. Conference Name, City, Country.
 */
export function conferencePaperEntry(
  ref: ConferencePaper,
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  const dateText = ref.dayEnd !== undefined && ref.date.day !== undefined &&
      ref.date.year !== undefined
    ? t.formatDateRange(ref.date, ref.dayEnd)
    : referenceDate(ref.date, t, ctx?.yearSuffix);
  const date: RichRun[] = [{ text: `(${dateText}).` }];

  const title = closeBlock([
    { text: ref.title, italic: true },
    { text: ` [${t.brackets.paperPresentation}]` },
  ]);
  const venue = closeBlock([
    {
      text: ref.location
        ? `${ref.conferenceName}, ${ref.location}`
        : ref.conferenceName,
    },
  ]);

  const author = authorsBlock(ref.authors, t);
  const blocks = author.length > 0
    ? [author, date, title, venue]
    : [title, date, venue];
  return assemble([...blocks, extraBlock(ref), linkBlock(ref)]);
}

/**
 * Pattern (APA 10.1 ex. 15–16): Author, A. (2020, July 3). Title of the
 * article. *Publication Name*. URL — magazines add volume/issue/pages like
 * a journal.
 */
export function newspaperArticleEntry(
  ref: NewspaperArticle,
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  const source: RichRun[] = [];
  if (ref.volume) {
    source.push({ text: `${ref.publication}, ${ref.volume}`, italic: true });
    if (ref.issue) source.push({ text: `(${ref.issue})` });
  } else {
    source.push({ text: ref.publication, italic: true });
  }
  const pages = pageRange(ref.pageStart, ref.pageEnd);
  if (pages) source.push({ text: `, ${pages}` });
  source.push({ text: "." });

  const author = authorsBlock(ref.authors, t);
  const title = plainTitleBlock(ref.title);
  const date = dateBlockWithSuffix(ref, t, ctx);
  const blocks = author.length > 0
    ? [author, date, title, source]
    : [title, date, source];
  return assemble([...blocks, extraBlock(ref), linkBlock(ref)]);
}

function dateBlockWithSuffix(
  ref: { date: ConferencePaper["date"] },
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  return [{ text: `(${referenceDate(ref.date, t, ctx?.yearSuffix)}).` }];
}

/**
 * Pattern (APA 10.3 ex. 47–48): Org. (2023). Entry title. In *Title of the
 * work* (7th ed.). Publisher. Retrieved <date>, from URL — publisher omitted
 * when it repeats a group author; retrieval date only for unstable works.
 */
export function referenceEntryEntry(
  ref: ReferenceEntry,
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  const groupAuthor = ref.authors.find(
    (a): a is Extract<typeof a, { kind: "group" }> => a.kind === "group",
  );
  const publisherRepeats = ref.publisher !== undefined &&
    groupAuthor !== undefined &&
    ref.publisher.trim().toLowerCase() ===
      groupAuthor.name.trim().toLowerCase();

  const source: RichRun[] = [{ text: `${t.in} ` }, {
    text: ref.workTitle,
    italic: true,
  }];
  const parenParts = editionVolumeParts(t, ref.edition, undefined);
  if (parenParts.length > 0) {
    source.push({ text: ` (${parenParts.join(", ")})` });
  }
  source.push({ text: "." });
  if (ref.publisher && !publisherRepeats) {
    source.push({ text: ` ${ref.publisher}.` });
  }

  let link = linkBlock(ref);
  if (ref.retrievedDate && link.length > 0) {
    link = [
      { text: `${t.retrieved(t.formatLongDate(ref.retrievedDate))} ` },
      ...link,
    ];
  }

  const author = authorsBlock(ref.authors, t);
  const title = plainTitleBlock(ref.title);
  const date = dateBlockWithSuffix(ref, t, ctx);
  const blocks = author.length > 0
    ? [author, date, title, closeBlock(source)]
    : [italicTitleBlock(ref.title), date, closeBlock(source)];
  return assemble([...blocks, extraBlock(ref), link]);
}

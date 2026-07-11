import type { JournalArticle } from "../model/reference.ts";
import type { LocaleTerms } from "../locale/terms.ts";
import type { RichRun } from "../richtext.ts";
import {
  assemble,
  authorsBlock,
  dateBlock,
  type EntryContext,
  extraBlock,
  linkBlock,
  pageRange,
  plainTitleBlock,
} from "./common.ts";

/**
 * Pattern (APA 10.1): Author, A. (2020). Title of the article. *Journal
 * Name, 12*(3), 45–67. https://doi.org/…  — journal and volume italic
 * including the comma between them; issue and pages plain; article numbers
 * replace pages for online-only journals.
 */
export function journalArticleEntry(
  ref: JournalArticle,
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  const source: RichRun[] = [];
  if (ref.volume) {
    source.push({ text: `${ref.journal}, ${ref.volume}`, italic: true });
  } else {
    source.push({ text: ref.journal, italic: true });
  }
  if (ref.issue) source.push({ text: `(${ref.issue})` });

  const pages = pageRange(ref.pageStart, ref.pageEnd);
  if (pages) {
    source.push({ text: `, ${pages}` });
  } else if (ref.articleNumber) {
    source.push({ text: `, ${t.articleNumber(ref.articleNumber)}` });
  }
  source.push({ text: "." });

  const author = authorsBlock(ref.authors, t);
  const title = plainTitleBlock(ref.title);
  const blocks = author.length > 0
    ? [author, dateBlock(ref, t, ctx), title, source]
    : [title, dateBlock(ref, t, ctx), source];

  return assemble([...blocks, extraBlock(ref), linkBlock(ref)]);
}

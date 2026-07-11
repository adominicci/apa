import type { BookChapter } from "../model/reference.ts";
import type { LocaleTerms } from "../locale/terms.ts";
import type { RichRun } from "../richtext.ts";
import { formatContributorsInline } from "../names.ts";
import {
  assemble,
  authorsBlock,
  closeBlock,
  dateBlock,
  editionVolumeParts,
  type EntryContext,
  extraBlock,
  linkBlock,
  pageRange,
  plainTitleBlock,
} from "./common.ts";

/**
 * Pattern (APA 10.3): Author, A. (2020). Title of the chapter. In E. Editor
 * & F. Editor (Eds.), *Title of the book* (2nd ed., pp. 33–41). Publisher.
 * Editor names run initials-first; Spanish swaps "In" for "En" and applies
 * the "y/e" conjunction rule.
 */
export function bookChapterEntry(
  ref: BookChapter,
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  const parenParts = editionVolumeParts(t, ref.edition, ref.volume);
  const pages = pageRange(ref.pageStart, ref.pageEnd);
  if (pages) {
    const label = pages.includes("–") ? t.pages : t.page;
    parenParts.push(`${label} ${pages}`);
  }

  const source: RichRun[] = [{ text: `${t.in} ` }];
  if (ref.editors.length > 0) {
    const label = ref.editors.length > 1 ? t.eds : t.ed;
    source.push({
      text: `${formatContributorsInline(ref.editors, t)} (${label}), `,
    });
  }
  source.push({ text: ref.bookTitle, italic: true });
  if (parenParts.length > 0) {
    source.push({ text: ` (${parenParts.join(", ")})` });
  }
  source.push({ text: "." });
  if (ref.publisher) source.push({ text: ` ${ref.publisher}.` });

  const author = authorsBlock(ref.authors, t);
  const title = plainTitleBlock(ref.title);
  const blocks = author.length > 0
    ? [author, dateBlock(ref, t, ctx), title, closeBlock(source)]
    : [title, dateBlock(ref, t, ctx), closeBlock(source)];

  return assemble([...blocks, extraBlock(ref), linkBlock(ref)]);
}

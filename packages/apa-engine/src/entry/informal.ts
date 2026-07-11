import type { Preprint, UnpublishedWork } from "../model/reference.ts";
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
 * Pattern (APA 10.8): Author, A. (2023). *Title of the manuscript*
 * (EJ876543). Repository. https://doi.org/… — covers preprint servers and
 * document databases like ERIC; the accession ID stays plain.
 */
export function preprintEntry(
  ref: Preprint,
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  const title = italicTitleBlock(ref.title, ref.itemNumber);
  const repository = ref.repository.trim() !== ""
    ? closeBlock([{ text: ref.repository }])
    : [];

  const author = authorsBlock(ref.authors, t);
  const blocks = author.length > 0
    ? [author, dateBlock(ref, t, ctx), title, repository]
    : [title, dateBlock(ref, t, ctx), repository];
  return assemble([...blocks, extraBlock(ref), linkBlock(ref)]);
}

/**
 * Pattern (APA 10.8): Author, A. (2024). *Title of the manuscript*
 * [Unpublished manuscript]. Department, University. — submitted manuscripts
 * name no institution because the target journal is never cited.
 */
export function unpublishedWorkEntry(
  ref: UnpublishedWork,
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  const title = closeBlock([
    { text: ref.title, italic: true },
    { text: ` [${t.unpublishedStatus(ref.status)}]` },
  ]);
  const institution = ref.institution
    ? closeBlock([{ text: ref.institution }])
    : [];

  const author = authorsBlock(ref.authors, t);
  const blocks = author.length > 0
    ? [author, dateBlock(ref, t, ctx), title, institution]
    : [title, dateBlock(ref, t, ctx), institution];
  return assemble([...blocks, extraBlock(ref), linkBlock(ref)]);
}

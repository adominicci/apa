import type { Book } from "../model/reference.ts";
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
  italicTitleBlock,
  linkBlock,
} from "./common.ts";

/**
 * Pattern (APA 10.2): Author, A. (2020). *Title of the work* (2nd ed.,
 * Vol. 3). Publisher. — translators join the parenthetical separated by a
 * semicolon; republished works end with "(Original work published YYYY)"
 * and no trailing period.
 */
export function bookEntry(
  ref: Book,
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  const parentheticalParts: string[] = [];
  if (ref.translators && ref.translators.length > 0) {
    parentheticalParts.push(
      `${formatContributorsInline(ref.translators, t)}, ${t.translatorAbbrev}`,
    );
  }
  const editionVol = editionVolumeParts(t, ref.edition, ref.volume);
  if (editionVol.length > 0) parentheticalParts.push(editionVol.join(", "));
  const parenthetical = parentheticalParts.length > 0
    ? parentheticalParts.join("; ")
    : undefined;

  const author = authorsBlock(ref.authors, t, ref.editors);
  const title = italicTitleBlock(ref.title, parenthetical);
  const publisher = ref.publisher ? closeBlock([{ text: ref.publisher }]) : [];
  const original: RichRun[] = ref.originalYear !== undefined
    ? [{ text: `(${t.originalWorkPublished(ref.originalYear)})` }]
    : [];

  const blocks = author.length > 0
    ? [author, dateBlock(ref, t, ctx), title, publisher]
    : [title, dateBlock(ref, t, ctx), publisher];

  return assemble([...blocks, extraBlock(ref), linkBlock(ref), original]);
}

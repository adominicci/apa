import type { Report } from "../model/reference.ts";
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
  plainTitleBlock,
} from "./common.ts";

/**
 * Pattern (APA 10.4): Organization. (2021). *Title of the report*
 * (Report No. 123). Institution. https://… — the institution is omitted
 * when it repeats a group author, mirroring the website site-name rule.
 */
export function reportEntry(
  ref: Report,
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  const groupAuthor = ref.authors.find(
    (a): a is Extract<typeof a, { kind: "group" }> => a.kind === "group",
  );
  const institutionRepeatsAuthor = ref.institution !== undefined &&
    groupAuthor !== undefined &&
    ref.institution.trim().toLowerCase() ===
      groupAuthor.name.trim().toLowerCase();
  const institution = ref.institution && !institutionRepeatsAuthor
    ? closeBlock([{ text: ref.institution }])
    : [];

  const parenthetical = ref.reportNumber
    ? t.reportNumber(ref.reportNumber)
    : undefined;

  const author = authorsBlock(ref.authors, t);
  const title = italicTitleBlock(ref.title, parenthetical);
  const blocks = author.length > 0
    ? [author, dateBlock(ref, t, ctx), title, institution]
    : [title, dateBlock(ref, t, ctx), institution];

  return assemble([...blocks, extraBlock(ref), linkBlock(ref)]);
}

/**
 * Pattern (APA 10.6): Author, A. (2020). Title of the thesis [Doctoral
 * dissertation, Institution]. Archive. https://… — unpublished theses swap
 * the bracket wording and cite the institution as the source instead.
 * Thesis titles are italic; the bracket stays outside the italics.
 */
export function thesisEntry(
  ref: import("../model/reference.ts").Thesis,
  t: LocaleTerms,
  ctx?: EntryContext,
): RichRun[] {
  const descriptor = t.thesisDescriptor(
    ref.thesisType,
    ref.unpublished === true,
  );
  const bracket = ref.unpublished
    ? `[${descriptor}]`
    : `[${descriptor}, ${ref.institution}]`;

  const title: RichRun[] = closeBlock([
    { text: ref.title, italic: true },
    { text: ` ${bracket}` },
  ]);

  const source = ref.unpublished
    ? closeBlock([{ text: ref.institution }])
    : ref.archive
    ? closeBlock([{ text: ref.archive }])
    : [];

  const author = authorsBlock(ref.authors, t);
  const blocks = author.length > 0
    ? [author, dateBlock(ref, t, ctx), title, source]
    : [plainTitleBlock(ref.title), dateBlock(ref, t, ctx), source];

  return assemble([...blocks, extraBlock(ref), linkBlock(ref)]);
}

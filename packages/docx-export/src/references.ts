import { Paragraph, TextRun } from "docx";
import {
  buildReferenceList,
  type DocLocale,
  getTerms,
  type Reference,
} from "@tesina/engine";
import { richRunsToTextRuns } from "./runs.ts";

/**
 * The references section: localized heading on its own page, entries from
 * the engine (APA-sorted, year-suffixed) with the ReferenceEntry hanging
 * indent style. Returns [] when there is nothing to list.
 */
export function referencesParagraphs(
  references: readonly Reference[],
  locale: DocLocale,
): Paragraph[] {
  if (references.length === 0) return [];
  const t = getTerms(locale);
  const { entries } = buildReferenceList(references, locale);
  return [
    new Paragraph({
      style: "Heading1",
      children: [new TextRun(t.headings.references)],
      pageBreakBefore: true,
    }),
    ...entries.map(
      (entry) =>
        new Paragraph({
          style: "ReferenceEntry",
          children: richRunsToTextRuns(entry.runs),
        }),
    ),
  ];
}

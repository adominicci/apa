import type { APADate } from "../model/reference.ts";

export type DocLocale = "en" | "es";

/**
 * Every string that can appear inside a formatted document goes through this
 * table — formatters contain zero locale conditionals, so adding a third
 * language is one new file. The three `and*` fields are separate on purpose:
 * Spanish-language institutional guides disagree about "&" vs "y" in
 * parenthetical citations and reference lists, so each position stays
 * independently overridable.
 */
export interface LocaleTerms {
  /** Narrative citations: "García and López (2020)" / "García y López (2020)". */
  andNarrative: string;
  /** Parenthetical citations: "(García & López, 2020)" / "(García y López, 2020)". */
  andParenthetical: string;
  /** Reference-list author lists: "…, & López, M." / "… y López, M." */
  andReferences: string;
  /** English keeps the comma before "&"; Spanish drops it before "y". */
  serialCommaBeforeAnd: boolean;
  /**
   * Grammar adjustment of the and-word against the word that follows it.
   * Spanish turns "y" into "e" before names starting with i/hi ("Fuentes e
   * Ibarra"); English returns the and-word unchanged.
   */
  andBefore: (andWord: string, followingText: string) => string;
  etAl: string;
  noDate: string;
  inPress: string;
  /** "In" / "En" — edited-book chapter connector. */
  in: string;
  ed: string;
  eds: string;
  translatorAbbrev: string;
  volumeAbbrev: string;
  page: string;
  pages: string;
  paragraph: string;
  edition: (ordinalText: string) => string;
  ordinal: (n: number) => string;
  articleNumber: (n: string) => string;
  reportNumber: (n: string) => string;
  /** "[Doctoral dissertation, X]" / "[Tesis doctoral, X]" bracket content. */
  thesisDescriptor: (
    type: "doctoral" | "masters",
    unpublished: boolean,
  ) => string;
  originalWorkPublished: (year: number) => string;
  retrieved: (longDate: string) => string;
  monthNames: readonly string[];
  /** Reference-list date: "2020, May 3" / "2020, 3 de mayo". */
  formatDate: (d: APADate) => string;
  /** Prose date: "May 3, 2020" / "3 de mayo de 2020" (retrievals, title page). */
  formatLongDate: (d: APADate) => string;
  headings: {
    references: string;
    abstract: string;
    keywords: string;
    appendix: string;
    table: string;
    figure: string;
    note: string;
    authorNote: string;
  };
  /** BCP 47 tag driving Intl.Collator for reference-list alphabetization. */
  collatorLocale: string;
  /** Leading articles ignored when sorting no-author works by title. */
  leadingArticles: readonly string[];
}

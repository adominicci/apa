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
  /** "Illus." / "Il." — inline illustrator credit in book parentheticals. */
  illustratorAbbrev: string;
  /** "On" / "En" — connects a song to its album (APA 10.13). */
  onAlbum: string;
  /** "present" / "presente" — open end of a TV-series year range. */
  present: string;
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
  /** Bracketed medium descriptors (APA 9.21). */
  brackets: {
    paperPresentation: string;
    video: string;
    podcastEpisode: string;
    /** Whole podcast show, without an episode. */
    podcastShow: string;
    software: string;
    dataset: string;
    film: string;
    tvSeries: string;
    tvSeriesEpisode: string;
    album: string;
    song: string;
  };
  /**
   * Localized suggestions for user-editable bracket descriptors (APA 9.21).
   * The catalog prefills form fields with these; the chosen text is then
   * stored on the reference itself, like socialMedia.contentType.
   */
  descriptors: {
    brochure: string;
    factSheet: string;
    pressRelease: string;
    whitePaper: string;
    standard: string;
    posterPresentation: string;
    conferenceSession: string;
    keynote: string;
    slides: string;
    lectureNotes: string;
    mooc: string;
    webinar: string;
    radioBroadcast: string;
    transcript: string;
    forumPost: string;
    llm: string;
    mobileApp: string;
    clipArt: string;
    stockImage: string;
    infographic: string;
    map: string;
    photograph: string;
    painting: string;
    musicalScore: string;
  };
  /** "(Director)" / "(Executive Producers)" credit after AV author lists. */
  avRole: (
    role: "director" | "execProducer" | "writer" | "writerDirector",
    count: number,
  ) => string;
  /** "Season 2, Episode 5" parenthetical content; either part optional. */
  seasonEpisode: (season?: string, episode?: string) => string;
  /** Bracket content for manuscripts outside formal publication (APA 10.8). */
  unpublishedStatus: (
    status: "unpublished" | "inPreparation" | "submitted",
  ) => string;
  /** "(Host)." / "(Anfitrión)." role after podcast hosts. */
  hostRole: (count: number) => string;
  versionLabel: (v: string) => string;
  episodeNumber: (n: string) => string;
  personalCommunication: string;
  /** Conference date range: "2023, September 5–8" / "2023, 5–8 de septiembre". */
  formatDateRange: (d: APADate, dayEnd: number) => string;
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

/**
 * Bespoke reference model (deliberately not CSL-JSON): Tesina implements
 * exactly one citation style, so the model is flat and mirrors the entry
 * forms in the UI one field at a time. M1 covers the four most common
 * source types; the rest of the union lands in M3.
 */

export type Contributor =
  | {
    kind: "person";
    /** Surname(s), e.g. "García" or "Pérez Rodríguez". */
    family: string;
    /** Given name(s) or initials as typed: "José María", "J. M.". */
    given?: string;
    /** Generational suffix rendered after the initials: "Jr.", "III". */
    suffix?: string;
  }
  | {
    kind: "group";
    /** Full official name, spelled out in the reference list. */
    name: string;
    /** Optional abbreviation introduced in brackets on first citation. */
    abbreviation?: string;
  };

export interface APADate {
  year?: number;
  /** 1–12 */
  month?: number;
  day?: number;
  /** Renders as "n.d." / "s. f."; wins over year. */
  noDate?: boolean;
  /** Renders as "in press" / "en prensa"; wins over year and noDate. */
  inPress?: boolean;
}

interface ReferenceBase {
  /** Stable UUID; citations point at this. */
  id: string;
  authors: Contributor[];
  date: APADate;
  /** Stored exactly as the user typed it; sentence case is their call. */
  title: string;
  /** Bare DOI ("10.1234/abc"); rendered as https://doi.org/… and preferred over url. */
  doi?: string;
  url?: string;
  /**
   * Only for sources designed to change over time (APA 9.16); adds
   * "Retrieved <date>, from" / "Recuperado el <date> de".
   */
  retrievedDate?: APADate;
  /** Escape hatch appended verbatim before the DOI/URL block. */
  extra?: string;
}

export interface JournalArticle extends ReferenceBase {
  type: "journalArticle";
  journal: string;
  volume?: string;
  issue?: string;
  pageStart?: string;
  pageEnd?: string;
  /** E.g. "e0193972" — used by online-only journals instead of pages. */
  articleNumber?: string;
}

export interface Book extends ReferenceBase {
  type: "book";
  /** "2" → "2nd ed." / "2.ª ed."; non-numeric text is used verbatim. */
  edition?: string;
  volume?: string;
  publisher?: string;
  /** For edited whole books when `authors` is empty: editors take the author position. */
  editors?: Contributor[];
  translators?: Contributor[];
  /** Adds "(Original work published YYYY)" / "(Obra original publicada en YYYY)". */
  originalYear?: number;
}

export interface BookChapter extends ReferenceBase {
  type: "bookChapter";
  editors: Contributor[];
  bookTitle: string;
  edition?: string;
  volume?: string;
  pageStart?: string;
  pageEnd?: string;
  publisher?: string;
}

export interface Website extends ReferenceBase {
  type: "website";
  /** Omitted from the entry when identical to a group author (APA 10.16). */
  siteName?: string;
}

export interface Report extends ReferenceBase {
  type: "report";
  /** Publishing institution; omitted when identical to a group author. */
  institution?: string;
  /** E.g. "123" → "(Report No. 123)" / "(Informe n.º 123)". */
  reportNumber?: string;
}

export interface Thesis extends ReferenceBase {
  type: "thesis";
  thesisType: "doctoral" | "masters";
  institution: string;
  /** Unpublished theses cite the institution as source (APA 10.6). */
  unpublished?: boolean;
  /** Repository or database holding the published thesis. */
  archive?: string;
}

export interface ConferencePaper extends ReferenceBase {
  type: "conferencePaper";
  conferenceName: string;
  /** "Ciudad, País". */
  location?: string;
  /** Last day when the conference spans several days in the same month. */
  dayEnd?: number;
}

/** Newspapers and magazines share the pattern (APA 10.1 examples 15–16). */
export interface NewspaperArticle extends ReferenceBase {
  type: "newspaperArticle";
  publication: string;
  volume?: string;
  issue?: string;
  pageStart?: string;
  pageEnd?: string;
}

/** Dictionary or encyclopedia entry (APA 10.3 examples 47–48). */
export interface ReferenceEntry extends ReferenceBase {
  type: "referenceEntry";
  /** The dictionary/encyclopedia itself (italic). */
  workTitle: string;
  edition?: string;
  /** Omitted when identical to a group author. */
  publisher?: string;
}

export interface Video extends ReferenceBase {
  type: "video";
  /** Channel or screen name, bracketed after a real name (APA 10.12). */
  username?: string;
  platform: string;
}

export interface PodcastEpisode extends ReferenceBase {
  type: "podcastEpisode";
  episodeNumber?: string;
  /** The show (italic, after "In"/"En"). */
  showTitle: string;
  platform?: string;
}

export interface SocialMedia extends ReferenceBase {
  type: "socialMedia";
  /** Handle bracketed after the name: "[@usuaria]". */
  username?: string;
  platform: string;
  /** Free bracket label typed in the document language: "Tuit", "Post". */
  contentType: string;
}

export interface Software extends ReferenceBase {
  type: "software";
  kind: "software" | "dataset";
  version?: string;
  publisher?: string;
}

/** Cited in text only; never appears in the reference list (APA 8.9). */
export interface PersonalCommunication extends ReferenceBase {
  type: "personalCommunication";
  medium?: string;
}

export type Reference =
  | JournalArticle
  | Book
  | BookChapter
  | Website
  | Report
  | Thesis
  | ConferencePaper
  | NewspaperArticle
  | ReferenceEntry
  | Video
  | PodcastEpisode
  | SocialMedia
  | Software
  | PersonalCommunication;

export type ReferenceType = Reference["type"];

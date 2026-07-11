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
  /** Illustrated/children's books: joins the parenthetical as "N. Vidal, Illus." */
  illustrators?: Contributor[];
  /** Free bracket after the title, typed in the document language: "Partitura". */
  descriptor?: string;
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

/**
 * Reports and the rest of APA's gray literature: brochures, fact sheets,
 * press releases, white papers, standards, ethics codes. The bracket
 * descriptor and the verbatim number cover the whole family (APA 10.4).
 */
export interface Report extends ReferenceBase {
  type: "report";
  /** Publishing institution; omitted when identical to a group author. */
  institution?: string;
  /** E.g. "123" → "(Report No. 123)" / "(Informe n.º 123)". */
  reportNumber?: string;
  /** Verbatim parenthetical for self-labelled numbers: "ISO 14001:2015". */
  standardNumber?: string;
  /** Free bracket after the title, typed in the document language: "Folleto". */
  descriptor?: string;
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
  /**
   * Overrides the "[Paper presentation]" bracket for posters, sessions,
   * keynotes…; typed in the document language.
   */
  contributionType?: string;
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

/**
 * Streaming video and everything sharing its shape (APA 10.12): the
 * descriptor override turns it into a webinar, MOOC, TED talk, slide deck,
 * lecture notes, radio broadcast, or transcript entry.
 */
export interface Video extends ReferenceBase {
  type: "video";
  /** Channel or screen name, bracketed after a real name (APA 10.12). */
  username?: string;
  platform: string;
  /** Overrides the "[Video]" bracket; typed in the document language. */
  descriptor?: string;
}

export interface PodcastEpisode extends ReferenceBase {
  type: "podcastEpisode";
  /** "show" cites the whole podcast: italic title + "[Audio podcast]". */
  kind?: "episode" | "show";
  episodeNumber?: string;
  /** The show (italic, after "In"/"En"); required for episodes. */
  showTitle?: string;
  platform?: string;
  /** Whole shows spanning years: "(2019–2024)" / "(2019–present)". */
  yearEnd?: number;
  ongoing?: boolean;
}

export interface SocialMedia extends ReferenceBase {
  type: "socialMedia";
  /** Handle bracketed after the name: "[@usuaria]". */
  username?: string;
  platform: string;
  /** Free bracket label typed in the document language: "Tuit", "Post". */
  contentType: string;
}

/**
 * Software, data sets, mobile apps, toolboxes, and AI models (APA 10.10):
 * the descriptor override yields "[Mobile app]", "[Large language model]"…
 */
export interface Software extends ReferenceBase {
  type: "software";
  kind: "software" | "dataset";
  version?: string;
  publisher?: string;
  /** Overrides the kind bracket; typed in the document language. */
  descriptor?: string;
}

/** Films and whole TV series (APA 10.12): authors carry the credit role. */
export interface Film extends ReferenceBase {
  type: "film";
  kind: "film" | "tvSeries";
  /** Authors are credited "(Director)" for films, "(Executive Producers)" for series. */
  productionCompany?: string;
  /** Series spanning years: "(2015–2019)" / "(2015–present)". */
  yearEnd?: number;
  ongoing?: boolean;
}

/** One TV series episode (APA 10.12); authors carry the writing/directing credit. */
export interface TVEpisode extends ReferenceBase {
  type: "tvEpisode";
  /** Credit shown after the author list; defaults to writer & director. */
  credit?: "writer" | "director" | "writerDirector";
  season?: string;
  episode?: string;
  /** The series (italic, after "In"/"En"). */
  seriesTitle: string;
  executiveProducers?: Contributor[];
  /** Production company or network. */
  productionCompany?: string;
}

/** Albums and songs (APA 10.13). */
export interface Music extends ReferenceBase {
  type: "music";
  kind: "album" | "song";
  /** Songs on an album: plain title + "On *Album*" / "En *Álbum*". */
  albumTitle?: string;
  /** Record label. */
  label?: string;
}

/** Artworks and standalone images: paintings, photos, maps, clip art (APA 10.14). */
export interface Artwork extends ReferenceBase {
  type: "artwork";
  /** Bracket descriptor typed in the document language: "Pintura", "Mapa". */
  medium?: string;
  /** Museum, collection, or hosting site. */
  venue?: string;
  /** "Ciudad, País". */
  location?: string;
}

/** Preprints and repository documents: PsyArXiv, ERIC… (APA 10.8). */
export interface Preprint extends ReferenceBase {
  type: "preprint";
  repository: string;
  /** Accession ID rendered plain after the title: "(EJ876543)". */
  itemNumber?: string;
}

/** Manuscripts outside formal publication (APA 10.8). */
export interface UnpublishedWork extends ReferenceBase {
  type: "unpublishedWork";
  status: "unpublished" | "inPreparation" | "submitted";
  /** "Departamento, Universidad"; omit for submitted manuscripts (APA 10.8). */
  institution?: string;
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
  | Film
  | TVEpisode
  | Music
  | Artwork
  | Preprint
  | UnpublishedWork
  | PersonalCommunication;

export type ReferenceType = Reference["type"];

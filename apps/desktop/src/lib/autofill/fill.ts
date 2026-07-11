import type { Reference, ReferenceType } from "@tesina/engine";

/** Field values the reference form can be prefilled with — superset of all types. */
export interface QuickFields {
  type: ReferenceType;
  authorsText: string;
  editorsText: string;
  year: string;
  month: string;
  day: string;
  noDate: boolean;
  title: string;
  journal: string;
  volume: string;
  issue: string;
  pages: string;
  publisher: string;
  bookTitle: string;
  siteName: string;
  institution: string;
  reportNumber: string;
  thesisType: "doctoral" | "masters";
  unpublished: boolean;
  archive: string;
  conferenceName: string;
  location: string;
  dayEnd: string;
  publication: string;
  workTitle: string;
  edition: string;
  username: string;
  platform: string;
  episodeNumber: string;
  showTitle: string;
  contentType: string;
  softwareKind: "software" | "dataset";
  version: string;
  url: string;
  doi: string;
}

export function emptyQuickFields(): QuickFields {
  return {
    type: "journalArticle",
    authorsText: "",
    editorsText: "",
    year: "",
    month: "",
    day: "",
    noDate: false,
    title: "",
    journal: "",
    volume: "",
    issue: "",
    pages: "",
    publisher: "",
    bookTitle: "",
    siteName: "",
    institution: "",
    reportNumber: "",
    thesisType: "doctoral",
    unpublished: false,
    archive: "",
    conferenceName: "",
    location: "",
    dayEnd: "",
    publication: "",
    workTitle: "",
    edition: "",
    username: "",
    platform: "",
    episodeNumber: "",
    showTitle: "",
    contentType: "",
    softwareKind: "software",
    version: "",
    url: "",
    doi: "",
  };
}

function contributorsToText(
  list: readonly Reference["authors"][number][],
): string {
  return list
    .map((a) =>
      a.kind === "group"
        ? a.name
        : a.given
        ? `${a.family}, ${a.given}`
        : a.family
    )
    .join("\n");
}

function pagesText(start?: string, end?: string): string {
  if (!start) return "";
  return end ? `${start}–${end}` : start;
}

/** Maps a reference onto the form for review before saving. */
export function refToQuickFields(ref: Reference): QuickFields {
  const base = emptyQuickFields();
  base.type = ref.type;
  base.authorsText = contributorsToText(ref.authors);
  base.year = ref.date.year !== undefined ? String(ref.date.year) : "";
  base.month = ref.date.month !== undefined ? String(ref.date.month) : "";
  base.day = ref.date.day !== undefined ? String(ref.date.day) : "";
  base.noDate = ref.date.noDate === true;
  base.title = ref.title;
  base.url = ref.url ?? "";
  base.doi = ref.doi ?? "";

  switch (ref.type) {
    case "journalArticle":
      base.journal = ref.journal;
      base.volume = ref.volume ?? "";
      base.issue = ref.issue ?? "";
      base.pages = pagesText(ref.pageStart, ref.pageEnd);
      break;
    case "book":
      base.publisher = ref.publisher ?? "";
      base.edition = ref.edition ?? "";
      break;
    case "bookChapter":
      base.editorsText = contributorsToText(ref.editors);
      base.bookTitle = ref.bookTitle;
      base.edition = ref.edition ?? "";
      base.pages = pagesText(ref.pageStart, ref.pageEnd);
      base.publisher = ref.publisher ?? "";
      break;
    case "website":
      base.siteName = ref.siteName ?? "";
      break;
    case "report":
      base.institution = ref.institution ?? "";
      base.reportNumber = ref.reportNumber ?? "";
      break;
    case "thesis":
      base.institution = ref.institution;
      base.thesisType = ref.thesisType;
      base.unpublished = ref.unpublished === true;
      base.archive = ref.archive ?? "";
      break;
    case "conferencePaper":
      base.conferenceName = ref.conferenceName;
      base.location = ref.location ?? "";
      base.dayEnd = ref.dayEnd !== undefined ? String(ref.dayEnd) : "";
      break;
    case "newspaperArticle":
      base.publication = ref.publication;
      base.volume = ref.volume ?? "";
      base.issue = ref.issue ?? "";
      base.pages = pagesText(ref.pageStart, ref.pageEnd);
      break;
    case "referenceEntry":
      base.workTitle = ref.workTitle;
      base.edition = ref.edition ?? "";
      base.publisher = ref.publisher ?? "";
      break;
    case "video":
      base.username = ref.username ?? "";
      base.platform = ref.platform;
      break;
    case "podcastEpisode":
      base.episodeNumber = ref.episodeNumber ?? "";
      base.showTitle = ref.showTitle;
      base.platform = ref.platform ?? "";
      break;
    case "socialMedia":
      base.username = ref.username ?? "";
      base.platform = ref.platform;
      base.contentType = ref.contentType;
      break;
    case "software":
      base.softwareKind = ref.kind;
      base.version = ref.version ?? "";
      base.publisher = ref.publisher ?? "";
      break;
    case "personalCommunication":
      break;
  }
  return base;
}

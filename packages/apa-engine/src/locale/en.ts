import type { APADate } from "../model/reference.ts";
import type { LocaleTerms } from "./terms.ts";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function formatDate(d: APADate): string {
  if (d.year === undefined) return "";
  if (d.month === undefined) return String(d.year);
  const month = MONTHS[d.month - 1] ?? "";
  if (d.day === undefined) return `${d.year}, ${month}`;
  return `${d.year}, ${month} ${d.day}`;
}

function formatLongDate(d: APADate): string {
  if (d.year === undefined) return "";
  if (d.month === undefined) return String(d.year);
  const month = MONTHS[d.month - 1] ?? "";
  if (d.day === undefined) return `${month} ${d.year}`;
  return `${month} ${d.day}, ${d.year}`;
}

export const en: LocaleTerms = {
  andNarrative: "and",
  andParenthetical: "&",
  andReferences: "&",
  serialCommaBeforeAnd: true,
  andBefore: (andWord) => andWord,
  etAl: "et al.",
  noDate: "n.d.",
  inPress: "in press",
  in: "In",
  ed: "Ed.",
  eds: "Eds.",
  translatorAbbrev: "Trans.",
  illustratorAbbrev: "Illus.",
  onAlbum: "On",
  present: "present",
  volumeAbbrev: "Vol.",
  page: "p.",
  pages: "pp.",
  paragraph: "para.",
  edition: (ordinalText) => `${ordinalText} ed.`,
  ordinal,
  articleNumber: (n) => `Article ${n}`,
  reportNumber: (n) => `Report No. ${n}`,
  brackets: {
    paperPresentation: "Paper presentation",
    video: "Video",
    podcastEpisode: "Audio podcast episode",
    podcastShow: "Audio podcast",
    software: "Computer software",
    dataset: "Data set",
    film: "Film",
    tvSeries: "TV series",
    tvSeriesEpisode: "TV series episode",
    album: "Album",
    song: "Song",
  },
  descriptors: {
    brochure: "Brochure",
    factSheet: "Fact sheet",
    pressRelease: "Press release",
    whitePaper: "White paper",
    standard: "Standard",
    posterPresentation: "Poster presentation",
    conferenceSession: "Conference session",
    keynote: "Keynote address",
    slides: "PowerPoint slides",
    lectureNotes: "Lecture notes",
    mooc: "MOOC",
    webinar: "Webinar",
    radioBroadcast: "Radio broadcast",
    transcript: "Transcript",
    forumPost: "Online forum post",
    llm: "Large language model",
    mobileApp: "Mobile app",
    clipArt: "Clip art",
    stockImage: "Stock image",
    infographic: "Infographic",
    map: "Map",
    photograph: "Photograph",
    painting: "Painting",
    musicalScore: "Musical score",
  },
  avRole: (role, count) => {
    switch (role) {
      case "director":
        return count > 1 ? "Directors" : "Director";
      case "execProducer":
        return count > 1 ? "Executive Producers" : "Executive Producer";
      case "writer":
        return count > 1 ? "Writers" : "Writer";
      case "writerDirector":
        return count > 1 ? "Writers & Directors" : "Writer & Director";
    }
  },
  seasonEpisode: (season, episode) => {
    const parts: string[] = [];
    if (season) parts.push(`Season ${season}`);
    if (episode) parts.push(`Episode ${episode}`);
    return parts.join(", ");
  },
  unpublishedStatus: (status) => {
    switch (status) {
      case "unpublished":
        return "Unpublished manuscript";
      case "inPreparation":
        return "Manuscript in preparation";
      case "submitted":
        return "Manuscript submitted for publication";
    }
  },
  hostRole: (count) => (count > 1 ? "Hosts" : "Host"),
  versionLabel: (v) => `Version ${v}`,
  episodeNumber: (n) => `No. ${n}`,
  personalCommunication: "personal communication",
  formatDateRange: (d, dayEnd) => {
    const month = MONTHS[(d.month ?? 1) - 1] ?? "";
    return `${d.year}, ${month} ${d.day}–${dayEnd}`;
  },
  thesisDescriptor: (type, unpublished) => {
    const base = type === "doctoral"
      ? "Doctoral dissertation"
      : "Master's thesis";
    return unpublished ? `Unpublished ${base.toLowerCase()}` : base;
  },
  originalWorkPublished: (year) => `Original work published ${year}`,
  retrieved: (longDate) => `Retrieved ${longDate}, from`,
  monthNames: MONTHS,
  formatDate,
  formatLongDate,
  headings: {
    references: "References",
    abstract: "Abstract",
    keywords: "Keywords:",
    appendix: "Appendix",
    table: "Table",
    figure: "Figure",
    note: "Note.",
    authorNote: "Author Note",
  },
  collatorLocale: "en",
  leadingArticles: ["a", "an", "the"],
};

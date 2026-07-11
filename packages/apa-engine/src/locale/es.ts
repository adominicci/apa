import type { APADate } from "../model/reference.ts";
import type { LocaleTerms } from "./terms.ts";

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

function formatDate(d: APADate): string {
  if (d.year === undefined) return "";
  if (d.month === undefined) return String(d.year);
  const month = MONTHS[d.month - 1] ?? "";
  if (d.day === undefined) return `${d.year}, ${month}`;
  return `${d.year}, ${d.day} de ${month}`;
}

function formatLongDate(d: APADate): string {
  if (d.year === undefined) return "";
  if (d.month === undefined) return String(d.year);
  const month = MONTHS[d.month - 1] ?? "";
  if (d.day === undefined) return `${month} de ${d.year}`;
  return `${d.day} de ${month} de ${d.year}`;
}

/**
 * Spanish APA conventions as taught across Hispanic academia ("normas APA"):
 * "y" replaces "&" everywhere, no comma before the final "y", "s. f." for
 * undated works (with space, per RAE abbreviation rules), "párr." for
 * paragraph locators. Institutions that insist on "&" can override the
 * `and*` fields per document in a later milestone.
 */
export const es: LocaleTerms = {
  andNarrative: "y",
  andParenthetical: "y",
  andReferences: "y",
  serialCommaBeforeAnd: false,
  // RAE: "y" becomes "e" before /i/ sounds — "e Ibarra", "e Hidalgo" — but
  // not before diphthongs like "Hierro". Only "y" is adjusted so an
  // institutional "&" override is left untouched.
  andBefore: (andWord, followingText) => {
    if (andWord !== "y") return andWord;
    const next = followingText.trim().toLowerCase();
    if (/^hi[aeou]/.test(next)) return "y";
    return /^(i|í|hi)/.test(next) ? "e" : "y";
  },
  etAl: "et al.",
  noDate: "s. f.",
  inPress: "en prensa",
  in: "En",
  ed: "Ed.",
  eds: "Eds.",
  translatorAbbrev: "Trad.",
  illustratorAbbrev: "Il.",
  onAlbum: "En",
  present: "presente",
  volumeAbbrev: "Vol.",
  page: "p.",
  pages: "pp.",
  paragraph: "párr.",
  edition: (ordinalText) => `${ordinalText} ed.`,
  ordinal: (n) => `${n}.ª`,
  articleNumber: (n) => `Artículo ${n}`,
  reportNumber: (n) => `Informe n.º ${n}`,
  brackets: {
    paperPresentation: "Ponencia",
    video: "Video",
    podcastEpisode: "Episodio de podcast",
    podcastShow: "Podcast",
    software: "Software",
    dataset: "Conjunto de datos",
    film: "Película",
    tvSeries: "Serie de televisión",
    tvSeriesEpisode: "Episodio de serie de televisión",
    album: "Álbum",
    song: "Canción",
  },
  descriptors: {
    brochure: "Folleto",
    factSheet: "Hoja informativa",
    pressRelease: "Comunicado de prensa",
    whitePaper: "Libro blanco",
    standard: "Norma",
    posterPresentation: "Póster",
    conferenceSession: "Sesión de congreso",
    keynote: "Conferencia magistral",
    slides: "Diapositivas de PowerPoint",
    lectureNotes: "Apuntes de clase",
    mooc: "MOOC",
    webinar: "Seminario web",
    radioBroadcast: "Emisión de radio",
    transcript: "Transcripción",
    forumPost: "Publicación en foro en línea",
    llm: "Modelo de lenguaje de gran tamaño",
    mobileApp: "Aplicación móvil",
    clipArt: "Imagen prediseñada",
    stockImage: "Imagen de archivo",
    infographic: "Infografía",
    map: "Mapa",
    photograph: "Fotografía",
    painting: "Pintura",
    musicalScore: "Partitura",
  },
  avRole: (role, count) => {
    switch (role) {
      case "director":
        return count > 1 ? "Directores" : "Director";
      case "execProducer":
        return count > 1 ? "Productores ejecutivos" : "Productor ejecutivo";
      case "writer":
        return count > 1 ? "Guionistas" : "Guionista";
      case "writerDirector":
        return count > 1 ? "Guionistas y directores" : "Guionista y director";
    }
  },
  seasonEpisode: (season, episode) => {
    const parts: string[] = [];
    if (season) parts.push(`Temporada ${season}`);
    if (episode) parts.push(`Episodio ${episode}`);
    return parts.join(", ");
  },
  unpublishedStatus: (status) => {
    switch (status) {
      case "unpublished":
        return "Manuscrito no publicado";
      case "inPreparation":
        return "Manuscrito en preparación";
      case "submitted":
        return "Manuscrito enviado para publicación";
    }
  },
  hostRole: (count) => (count > 1 ? "Anfitriones" : "Anfitrión"),
  versionLabel: (v) => `Versión ${v}`,
  episodeNumber: (n) => `N.º ${n}`,
  personalCommunication: "comunicación personal",
  formatDateRange: (d, dayEnd) => {
    const month = MONTHS[(d.month ?? 1) - 1] ?? "";
    return `${d.year}, ${d.day}–${dayEnd} de ${month}`;
  },
  thesisDescriptor: (type, unpublished) => {
    const base = type === "doctoral" ? "Tesis doctoral" : "Tesis de maestría";
    return unpublished ? `${base} inédita` : base;
  },
  originalWorkPublished: (year) => `Obra original publicada en ${year}`,
  retrieved: (longDate) => `Recuperado el ${longDate} de`,
  monthNames: MONTHS,
  formatDate,
  formatLongDate,
  headings: {
    references: "Referencias",
    abstract: "Resumen",
    keywords: "Palabras clave:",
    appendix: "Apéndice",
    table: "Tabla",
    figure: "Figura",
    note: "Nota.",
    authorNote: "Nota del autor",
  },
  collatorLocale: "es",
  leadingArticles: [
    "el",
    "la",
    "los",
    "las",
    "un",
    "una",
    "unos",
    "unas",
    "a",
    "an",
    "the",
  ],
};

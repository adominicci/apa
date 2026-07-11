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
  volumeAbbrev: "Vol.",
  page: "p.",
  pages: "pp.",
  paragraph: "párr.",
  edition: (ordinalText) => `${ordinalText} ed.`,
  ordinal: (n) => `${n}.ª`,
  articleNumber: (n) => `Artículo ${n}`,
  reportNumber: (n) => `Informe n.º ${n}`,
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

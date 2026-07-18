/**
 * Maps one parsed BibTeX/biblatex entry onto Tesina's reference model,
 * mirroring the autofill mappers (see autofill/crossref.ts): a pure function
 * that always returns a `Reference` plus any warnings the review UI surfaces.
 * The parser (`@retorquere/bibtex-parser`) already turns LaTeX into Unicode and
 * normalizes months; we only bridge its shapes to ours.
 */
import type { APADate, Contributor, Reference } from "@tesina/engine";
import type { Creator, Entry, FieldValue } from "@retorquere/bibtex-parser";

/** Non-fatal notes about an imported entry, translated in the review modal. */
export type BibWarning =
  | { code: "mappedAs"; from: string }
  | { code: "noTitle" }
  | { code: "noAuthors" }
  | { code: "noYear" }
  | { code: "badDate"; raw: string };

export interface MappedEntry {
  ref: Reference;
  warnings: BibWarning[];
}

/** The base every `Reference` shares, spread into the type-specific object. */
type RefBase = Pick<
  Reference,
  "id" | "authors" | "date" | "title" | "doi" | "url" | "retrievedDate"
>;

/**
 * Strip the HTML-ish markup the parser emits for \textit, \textbf, nocase…
 * and fold to NFC — the parser yields decomposed accents (e.g. "García" as
 * i + combining acute), and the rest of the app stores precomposed Unicode.
 */
export function stripMarkup(value: string): string {
  return value.replace(/<[^>]*>/g, "").normalize("NFC");
}

/** Bare DOI for storage: drop the resolver prefix, keep the case as given. */
export function stripDoiPrefix(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim();
}

/** Case-folded DOI for duplicate matching (DOIs are case-insensitive). */
export function normalizeDoi(raw: string): string {
  return stripDoiPrefix(raw).toLowerCase();
}

/** "12--34" / "12-34" / "12–34" → start+end; a lone locator → start only. */
export function splitBibPages(
  pages: string,
): { pageStart?: string; pageEnd?: string } {
  const parts = pages
    .trim()
    .split(/\s*(?:-{1,2}|[–—])\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { pageStart: parts[0] };
  return { pageStart: parts[0], pageEnd: parts[parts.length - 1] };
}

/** "2nd"/"2.ª ed." → "2"; non-numeric text stays verbatim (model renders it). */
export function parseEdition(raw: string): string {
  const match = raw.trim().match(/^(\d+)/);
  return match ? match[1] : raw.trim();
}

/** One parsed name → a Tesina contributor (`name` means corporate/literal). */
export function creatorToContributor(creator: Creator): Contributor {
  if (creator.name) {
    return { kind: "group", name: stripMarkup(creator.name).trim() };
  }
  const family = stripMarkup(
    [creator.prefix, creator.lastName].filter(Boolean).join(" "),
  ).trim();
  const given = creator.firstName ? stripMarkup(creator.firstName).trim() : "";
  const suffix = creator.suffix ? stripMarkup(creator.suffix).trim() : "";
  if (!family) return { kind: "group", name: given };
  return {
    kind: "person",
    family,
    ...(given ? { given } : {}),
    ...(suffix ? { suffix } : {}),
  };
}

/** Read a scalar field; join biblatex list fields (publisher, institution…). */
function str(value: FieldValue | undefined): string | undefined {
  if (typeof value === "string") return value.normalize("NFC");
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return (value as string[]).map((v) => v.normalize("NFC")).join("; ");
  }
  return undefined;
}

/** Read a creator field into contributors, skipping anything malformed. */
function creators(value: FieldValue | undefined): Contributor[] {
  if (!Array.isArray(value)) return [];
  const out: Contributor[] = [];
  for (const item of value) {
    if (typeof item === "string") continue;
    out.push(creatorToContributor(item));
  }
  return out;
}

/** Parse a "YYYY", "YYYY-MM", or "YYYY-MM-DD" prefix into an APADate. */
function parseYmd(value: string | undefined): APADate | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
  if (!match) return undefined;
  const date: APADate = { year: Number(match[1]) };
  if (match[2]) date.month = Number(match[2]);
  if (match[3]) date.day = Number(match[3]);
  return date;
}

function parseBibDate(
  fields: Entry["fields"],
  warnings: BibWarning[],
): APADate {
  const pubstate = (str(fields.pubstate) ?? "").toLowerCase();
  if (/in\s?press|forthcoming/.test(pubstate)) return { inPress: true };

  // biblatex `date` wins when present; else fall back to year/month/day.
  const fromDate = parseYmd(str(fields.date));
  let year = fromDate?.year;
  let month = fromDate?.month;
  let day = fromDate?.day;

  const yearField = str(fields.year);
  if (year === undefined && yearField) {
    const trimmed = yearField.trim();
    if (/^\d{1,4}$/.test(trimmed)) {
      year = Number(trimmed);
    } else {
      const embedded = trimmed.match(/\d{4}/);
      if (embedded) {
        year = Number(embedded[0]);
      } else {
        warnings.push({ code: "badDate", raw: yearField });
        return { noDate: true };
      }
    }
  }

  const monthField = str(fields.month);
  if (
    month === undefined && monthField && /^\d{1,2}$/.test(monthField.trim())
  ) {
    month = Number(monthField.trim());
  }
  const dayField = str(fields.day);
  if (day === undefined && dayField && /^\d{1,2}$/.test(dayField.trim())) {
    day = Number(dayField.trim());
  }

  if (year === undefined) {
    warnings.push({ code: "noYear" });
    return { noDate: true };
  }
  const date: APADate = { year };
  if (month !== undefined && month >= 1 && month <= 12) date.month = month;
  if (day !== undefined && day >= 1 && day <= 31) date.day = day;
  return date;
}

/** @misc and unmapped types: url → website, otherwise report (always warns for unknown types). */
function fallback(
  base: RefBase,
  fields: Entry["fields"],
  from: string,
  warnings: BibWarning[],
  alwaysWarn: boolean,
): Reference {
  let url = base.url;
  if (!url) {
    const howpublished = str(fields.howpublished) ?? "";
    const match = howpublished.match(/https?:\/\/\S+/i);
    if (match) url = match[0];
  }
  const siteName = str(fields.organization) ?? str(fields.publisher);
  if (url) {
    if (alwaysWarn) warnings.push({ code: "mappedAs", from });
    return { ...base, url, type: "website", ...(siteName ? { siteName } : {}) };
  }
  warnings.push({ code: "mappedAs", from });
  const institution = str(fields.institution) ?? str(fields.organization) ??
    str(fields.publisher);
  return {
    ...base,
    type: "report",
    ...(institution ? { institution } : {}),
  };
}

function thesisLevel(
  raw: string | undefined,
): "doctoral" | "masters" | "unknown" {
  const value = (raw ?? "").toLowerCase();
  if (/master|máster|maestr|\bmsc\b|\bma\b|m\.a\.|m\.phil/.test(value)) {
    return "masters";
  }
  if (/phd|ph\.?d|doctor|dphil/.test(value)) return "doctoral";
  return "unknown";
}

function buildTyped(
  type: string,
  base: RefBase,
  fields: Entry["fields"],
  warnings: BibWarning[],
): Reference {
  const edition = str(fields.edition);
  const pages = splitBibPages(str(fields.pages) ?? "");

  switch (type.toLowerCase()) {
    case "article":
      return {
        ...base,
        type: "journalArticle",
        journal: stripMarkup(
          str(fields.journaltitle) ?? str(fields.journal) ?? "",
        ).trim(),
        ...(str(fields.volume) ? { volume: str(fields.volume) } : {}),
        ...(str(fields.number) ? { issue: str(fields.number) } : {}),
        ...(str(fields.eid) ? { articleNumber: str(fields.eid) } : {}),
        ...pages,
      };

    case "book":
    case "mvbook":
    case "booklet":
    case "collection":
    case "mvcollection":
    case "proceedings":
    case "reference": {
      const editors = base.authors.length === 0 ? creators(fields.editor) : [];
      const translators = creators(fields.translator);
      return {
        ...base,
        type: "book",
        ...(str(fields.publisher) ? { publisher: str(fields.publisher) } : {}),
        ...(edition ? { edition: parseEdition(edition) } : {}),
        ...(str(fields.volume) ? { volume: str(fields.volume) } : {}),
        ...(editors.length ? { editors } : {}),
        ...(translators.length ? { translators } : {}),
      };
    }

    case "incollection":
    case "inbook":
    case "bookinbook":
    case "suppbook":
      return {
        ...base,
        type: "bookChapter",
        editors: creators(fields.editor),
        bookTitle: stripMarkup(str(fields.booktitle) ?? "").trim(),
        ...(edition ? { edition: parseEdition(edition) } : {}),
        ...(str(fields.volume) ? { volume: str(fields.volume) } : {}),
        ...(str(fields.publisher) ? { publisher: str(fields.publisher) } : {}),
        ...pages,
      };

    case "inreference":
      return {
        ...base,
        type: "referenceEntry",
        workTitle: stripMarkup(str(fields.booktitle) ?? "").trim(),
        ...(edition ? { edition: parseEdition(edition) } : {}),
        ...(str(fields.publisher) ? { publisher: str(fields.publisher) } : {}),
      };

    case "inproceedings":
    case "conference": {
      const location = str(fields.venue) ?? str(fields.location) ??
        str(fields.address);
      return {
        ...base,
        type: "conferencePaper",
        conferenceName: stripMarkup(
          str(fields.eventtitle) ?? str(fields.booktitle) ?? "",
        ).trim(),
        ...(location ? { location } : {}),
      };
    }

    case "phdthesis":
      return {
        ...base,
        type: "thesis",
        thesisType: "doctoral",
        institution: str(fields.school) ?? str(fields.institution) ?? "",
      };
    case "mastersthesis":
      return {
        ...base,
        type: "thesis",
        thesisType: "masters",
        institution: str(fields.school) ?? str(fields.institution) ?? "",
      };
    case "thesis": {
      const level = thesisLevel(str(fields.type));
      if (level === "unknown" && str(fields.type)) {
        warnings.push({ code: "mappedAs", from: "thesis" });
      }
      return {
        ...base,
        type: "thesis",
        thesisType: level === "masters" ? "masters" : "doctoral",
        institution: str(fields.institution) ?? str(fields.school) ?? "",
      };
    }

    case "techreport":
    case "report":
    case "manual": {
      const institution = str(fields.institution) ?? str(fields.organization) ??
        str(fields.publisher);
      return {
        ...base,
        type: "report",
        ...(institution ? { institution } : {}),
        ...(str(fields.number) ? { reportNumber: str(fields.number) } : {}),
      };
    }
    case "standard": {
      const institution = str(fields.institution) ?? str(fields.organization) ??
        str(fields.publisher);
      return {
        ...base,
        type: "report",
        ...(institution ? { institution } : {}),
        ...(str(fields.number) ? { standardNumber: str(fields.number) } : {}),
      };
    }
    case "patent": {
      const withHolder = base.authors.length === 0
        ? { ...base, authors: creators(fields.holder) }
        : base;
      warnings.push({ code: "mappedAs", from: "patent" });
      return {
        ...withHolder,
        type: "report",
        ...(str(fields.number) ? { reportNumber: str(fields.number) } : {}),
      };
    }

    case "unpublished": {
      const pubstate = (str(fields.pubstate) ?? "").toLowerCase();
      const status = /submit/.test(pubstate)
        ? "submitted"
        : /prep|progress/.test(pubstate)
        ? "inPreparation"
        : "unpublished";
      const institution = str(fields.institution) ?? str(fields.organization);
      return {
        ...base,
        type: "unpublishedWork",
        status,
        ...(institution ? { institution } : {}),
      };
    }

    case "online":
    case "electronic":
    case "www": {
      const siteName = str(fields.organization) ?? str(fields.publisher);
      return { ...base, type: "website", ...(siteName ? { siteName } : {}) };
    }

    case "software":
    case "app":
      return {
        ...base,
        type: "software",
        kind: "software",
        ...(str(fields.version) ? { version: str(fields.version) } : {}),
        ...(str(fields.organization) ?? str(fields.publisher)
          ? { publisher: str(fields.organization) ?? str(fields.publisher) }
          : {}),
      };
    case "dataset":
    case "data":
      return {
        ...base,
        type: "software",
        kind: "dataset",
        ...(str(fields.organization) ?? str(fields.publisher)
          ? { publisher: str(fields.organization) ?? str(fields.publisher) }
          : {}),
      };

    case "video":
      return {
        ...base,
        type: "video",
        platform: str(fields.organization) ?? str(fields.publisher) ?? "",
      };
    case "movie":
      return {
        ...base,
        type: "film",
        kind: "film",
        ...(str(fields.organization)
          ? { productionCompany: str(fields.organization) }
          : {}),
      };

    case "misc":
      return fallback(base, fields, "misc", warnings, false);
    default:
      return fallback(base, fields, type.toLowerCase(), warnings, true);
  }
}

/** Map one parsed entry to a reference (id is caller-supplied, as in autofill). */
export function mapBibEntry(entry: Entry, id: string): MappedEntry {
  const warnings: BibWarning[] = [];
  const fields = entry.fields;

  const title = stripMarkup(str(fields.title) ?? "").trim();
  if (!title) warnings.push({ code: "noTitle" });

  const authors = creators(fields.author);
  if (authors.length === 0 && creators(fields.editor).length === 0) {
    warnings.push({ code: "noAuthors" });
  }

  const date = parseBibDate(fields, warnings);

  const bareDoi = stripDoiPrefix(str(fields.doi) ?? "");
  const rawUrl = (str(fields.url) ?? "").trim();
  const url =
    rawUrl && !(bareDoi && normalizeDoi(rawUrl) === normalizeDoi(bareDoi))
      ? rawUrl
      : "";
  const retrievedDate = parseYmd(str(fields.urldate));

  const base: RefBase = {
    id,
    authors,
    date,
    title,
    ...(bareDoi ? { doi: bareDoi } : {}),
    ...(url ? { url } : {}),
    ...(retrievedDate ? { retrievedDate } : {}),
  };

  return { ref: buildTyped(entry.type, base, fields, warnings), warnings };
}

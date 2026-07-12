import type { Contributor, Reference } from "@tesina/engine";

/**
 * Metadata scraped from a web page, in the order of preference used by the
 * extractor. Everything is optional — the caller decides whether there is
 * enough to build a reference or whether to fall back to manual entry.
 */
export interface UrlMeta {
  title?: string;
  authors: string[];
  year?: number;
  month?: number;
  day?: number;
  journal?: string;
  volume?: string;
  issue?: string;
  pageStart?: string;
  pageEnd?: string;
  doi?: string;
  siteName?: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  "#x27": "'",
  "#x2F": "/",
};

/** Minimal HTML entity decode for attribute/text content. */
function decode(text: string): string {
  return text.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (whole, code: string) => {
      if (ENTITIES[code]) return ENTITIES[code];
      if (code.startsWith("#x") || code.startsWith("#X")) {
        const n = Number.parseInt(code.slice(2), 16);
        return Number.isNaN(n) ? whole : String.fromCodePoint(n);
      }
      if (code.startsWith("#")) {
        const n = Number.parseInt(code.slice(1), 10);
        return Number.isNaN(n) ? whole : String.fromCodePoint(n);
      }
      return whole;
    },
  ).trim();
}

/** Collects every `<meta>` name/property → all its content values. */
function metaMap(html: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = tag[0];
    const key = /(?:name|property|itemprop)\s*=\s*["']([^"']+)["']/i.exec(
      attrs,
    );
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(attrs);
    if (!key || !content) continue;
    const k = key[1]!.toLowerCase();
    const list = map.get(k) ?? [];
    list.push(decode(content[1]!));
    map.set(k, list);
  }
  return map;
}

function first(
  map: Map<string, string[]>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const v = map.get(key)?.[0];
    if (v && v.trim() !== "") return v.trim();
  }
  return undefined;
}

function all(map: Map<string, string[]>, ...keys: string[]): string[] {
  for (const key of keys) {
    const v = map.get(key);
    if (v && v.length > 0) return v.filter((s) => s.trim() !== "");
  }
  return [];
}

/** Parses a year/month/day out of common date formats (ISO, YYYY/MM/DD…). */
function parseDate(
  raw: string | undefined,
): { year?: number; month?: number; day?: number } {
  if (!raw) return {};
  const m = raw.match(/(\d{4})(?:[-/](\d{1,2}))?(?:[-/](\d{1,2}))?/);
  if (!m) return {};
  const year = Number.parseInt(m[1]!, 10);
  const month = m[2] ? Number.parseInt(m[2], 10) : undefined;
  const day = m[3] ? Number.parseInt(m[3], 10) : undefined;
  return {
    year,
    ...(month && month >= 1 && month <= 12 ? { month } : {}),
    ...(day && day >= 1 && day <= 31 ? { day } : {}),
  };
}

/** Pulls headline/author/date out of schema.org JSON-LD blocks. */
function fromJsonLd(html: string): Partial<UrlMeta> {
  for (
    const block of html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    )
  ) {
    let data: unknown;
    try {
      data = JSON.parse(block[1]!.trim());
    } catch {
      continue;
    }
    const nodes = Array.isArray(data) ? data : [data];
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const n = node as Record<string, unknown>;
      const type = String(n["@type"] ?? "").toLowerCase();
      if (
        !/article|report|thesis|webpage|creativework|blogposting/.test(type)
      ) {
        continue;
      }
      const authors: string[] = [];
      const a = n["author"];
      const list = Array.isArray(a) ? a : a ? [a] : [];
      for (const author of list) {
        if (typeof author === "string") authors.push(author);
        else if (author && typeof author === "object") {
          const name = (author as Record<string, unknown>)["name"];
          if (typeof name === "string") authors.push(name);
        }
      }
      const headline = n["headline"] ?? n["name"];
      const date = n["datePublished"] ?? n["dateCreated"];
      return {
        ...(typeof headline === "string" ? { title: headline } : {}),
        ...(authors.length > 0 ? { authors } : {}),
        ...(typeof date === "string" ? parseDate(date) : {}),
      };
    }
  }
  return {};
}

function titleTag(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decode(m[1]!.replace(/\s+/g, " ")) : undefined;
}

function normalizeDoi(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = raw.match(/10\.\d{4,9}\/\S+/);
  return m ? m[0].replace(/[.,;)\]]+$/, "") : undefined;
}

/**
 * Extracts reference metadata from a page's raw HTML, preferring the Highwire
 * `citation_*` tags (the academic standard) and falling back through JSON-LD,
 * OpenGraph/article, Dublin Core, and finally the <title>.
 */
export function extractUrlMeta(html: string): UrlMeta {
  const map = metaMap(html);
  const jsonLd = fromJsonLd(html);

  const title = first(map, "citation_title", "dc.title", "og:title") ??
    jsonLd.title ?? first(map, "twitter:title") ?? titleTag(html);

  let authors = all(map, "citation_author", "dc.creator", "dc.contributor");
  if (authors.length === 0 && jsonLd.authors) authors = jsonLd.authors;
  if (authors.length === 0) {
    authors = all(map, "author", "article:author").filter((a) =>
      // Skip URLs sometimes placed in article:author.
      !/^https?:\/\//i.test(a)
    );
  }

  const dateRaw = first(
    map,
    "citation_publication_date",
    "citation_date",
    "citation_online_date",
    "article:published_time",
    "dc.date",
    "date",
  );
  const date = dateRaw ? parseDate(dateRaw) : jsonLd;

  const doi = normalizeDoi(
    first(map, "citation_doi", "dc.identifier", "prism.doi"),
  );

  return {
    ...(title ? { title } : {}),
    authors,
    ...(date.year !== undefined ? { year: date.year } : {}),
    ...(date.month !== undefined ? { month: date.month } : {}),
    ...(date.day !== undefined ? { day: date.day } : {}),
    ...(first(map, "citation_journal_title", "prism.publicationname")
      ? {
        journal: first(map, "citation_journal_title", "prism.publicationname"),
      }
      : {}),
    ...(first(map, "citation_volume", "prism.volume")
      ? { volume: first(map, "citation_volume", "prism.volume") }
      : {}),
    ...(first(map, "citation_issue", "prism.number")
      ? { issue: first(map, "citation_issue", "prism.number") }
      : {}),
    ...(first(map, "citation_firstpage")
      ? { pageStart: first(map, "citation_firstpage") }
      : {}),
    ...(first(map, "citation_lastpage")
      ? { pageEnd: first(map, "citation_lastpage") }
      : {}),
    ...(doi ? { doi } : {}),
    ...(first(map, "og:site_name")
      ? { siteName: first(map, "og:site_name") }
      : {}),
  };
}

/** "Surname, Given" or "Given Surname" → a person contributor. */
function parseAuthor(raw: string): Contributor {
  const t = raw.trim();
  const comma = t.indexOf(",");
  if (comma >= 0) {
    const family = t.slice(0, comma).trim();
    const given = t.slice(comma + 1).trim();
    return given
      ? { kind: "person", family, given }
      : { kind: "person", family };
  }
  const parts = t.split(/\s+/);
  if (parts.length === 1) return { kind: "person", family: parts[0]! };
  const family = parts.pop()!;
  return { kind: "person", family, given: parts.join(" ") };
}

/**
 * Whether the scrape found enough to be worth pre-filling. A page that only
 * yields a bare title (or nothing) is treated as unreadable so the UI can tell
 * the user to enter the reference by hand.
 */
export function hasUsableMeta(meta: UrlMeta): boolean {
  if (!meta.title || meta.title.trim() === "") return false;
  return meta.authors.length > 0 ||
    meta.year !== undefined ||
    meta.doi !== undefined ||
    meta.journal !== undefined;
}

/** Maps scraped metadata onto a journal article (when it looks like one) or a
 * website reference. */
export function urlMetaToReference(
  meta: UrlMeta,
  url: string,
  id: string,
): Reference {
  const authors = meta.authors.slice(0, 25).map(parseAuthor);
  const date = meta.year !== undefined
    ? {
      year: meta.year,
      ...(meta.month !== undefined ? { month: meta.month } : {}),
      ...(meta.day !== undefined ? { day: meta.day } : {}),
    }
    : { noDate: true };
  const base = {
    id,
    authors,
    date,
    title: meta.title ?? "",
    ...(meta.doi ? { doi: meta.doi } : {}),
    url,
  };

  if (meta.journal || meta.doi) {
    return {
      ...base,
      type: "journalArticle",
      journal: meta.journal ?? "",
      ...(meta.volume ? { volume: meta.volume } : {}),
      ...(meta.issue ? { issue: meta.issue } : {}),
      ...(meta.pageStart ? { pageStart: meta.pageStart } : {}),
      ...(meta.pageEnd ? { pageEnd: meta.pageEnd } : {}),
    };
  }
  return {
    ...base,
    type: "website",
    ...(meta.siteName ? { siteName: meta.siteName } : {}),
  };
}

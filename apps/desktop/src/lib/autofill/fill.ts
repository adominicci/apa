import type { Reference } from "@tesina/engine";

/** Field values the quick-reference form can be prefilled with. */
export interface QuickFields {
  type: "journalArticle" | "book" | "website";
  authorsText: string;
  year: string;
  noDate: boolean;
  title: string;
  journal: string;
  volume: string;
  issue: string;
  pages: string;
  publisher: string;
  siteName: string;
  url: string;
  doi: string;
}

/**
 * Maps a fetched reference onto the quick form so the user can review and
 * correct before saving. Returns null for types the quick form cannot edit
 * yet (chapters arrive with the full reference manager).
 */
export function refToQuickFields(ref: Reference): QuickFields | null {
  if (ref.type === "bookChapter") return null;

  const authorsText = ref.authors
    .map((a) =>
      a.kind === "group"
        ? a.name
        : a.given
        ? `${a.family}, ${a.given}`
        : a.family
    )
    .join("\n");
  const base: QuickFields = {
    type: ref.type,
    authorsText,
    year: ref.date.year !== undefined ? String(ref.date.year) : "",
    noDate: ref.date.noDate === true,
    title: ref.title,
    journal: "",
    volume: "",
    issue: "",
    pages: "",
    publisher: "",
    siteName: "",
    url: ref.url ?? "",
    doi: ref.doi ?? "",
  };

  if (ref.type === "journalArticle") {
    base.journal = ref.journal;
    base.volume = ref.volume ?? "";
    base.issue = ref.issue ?? "";
    base.pages = ref.pageStart
      ? ref.pageEnd ? `${ref.pageStart}–${ref.pageEnd}` : ref.pageStart
      : "";
  } else if (ref.type === "book") {
    base.publisher = ref.publisher ?? "";
  } else if (ref.type === "website") {
    base.siteName = ref.siteName ?? "";
  }
  return base;
}

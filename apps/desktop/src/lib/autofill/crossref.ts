import type {
  APADate,
  Book,
  BookChapter,
  Contributor,
  JournalArticle,
  Reference,
} from "@tesina/engine";

/** The slice of a CrossRef work message the mappers read. */
export interface CrossrefWork {
  type?: string;
  author?: { family?: string; given?: string; name?: string }[];
  editor?: { family?: string; given?: string; name?: string }[];
  title?: string[];
  "container-title"?: string[];
  issued?: { "date-parts"?: number[][] };
  volume?: string;
  issue?: string;
  page?: string;
  publisher?: string;
  DOI?: string;
}

function contributors(
  list: CrossrefWork["author"],
): Contributor[] {
  if (!list) return [];
  return list.flatMap((entry): Contributor[] => {
    if (entry.family) {
      return [{
        kind: "person",
        family: entry.family,
        ...(entry.given ? { given: entry.given } : {}),
      }];
    }
    if (entry.name) return [{ kind: "group", name: entry.name }];
    return [];
  });
}

function issuedDate(work: CrossrefWork): APADate {
  const parts = work.issued?.["date-parts"]?.[0];
  if (!parts || parts.length === 0 || typeof parts[0] !== "number") {
    return { noDate: true };
  }
  const [year, month, day] = parts;
  return {
    year: year as number,
    ...(typeof month === "number" ? { month } : {}),
    ...(typeof day === "number" ? { day } : {}),
  };
}

function pageRange(page?: string): { pageStart?: string; pageEnd?: string } {
  if (!page) return {};
  const [start, end] = page.split(/[-–]/).map((p) => p.trim());
  return {
    ...(start ? { pageStart: start } : {}),
    ...(end ? { pageEnd: end } : {}),
  };
}

/**
 * Maps a CrossRef work message onto Tesina's reference model. Returns null
 * for work types M3 does not support yet, so the UI can say so instead of
 * guessing a wrong entry.
 */
export function mapCrossrefWork(
  work: CrossrefWork,
  id: string,
): Reference | null {
  const title = work.title?.[0]?.trim() ?? "";
  if (title === "") return null;
  const base = {
    id,
    authors: contributors(work.author),
    date: issuedDate(work),
    title,
    ...(work.DOI ? { doi: work.DOI } : {}),
  };

  switch (work.type) {
    case "journal-article": {
      const article: JournalArticle = {
        ...base,
        type: "journalArticle",
        journal: work["container-title"]?.[0] ?? "",
        ...(work.volume ? { volume: work.volume } : {}),
        ...(work.issue ? { issue: work.issue } : {}),
        ...pageRange(work.page),
      };
      return article;
    }
    case "book":
    case "monograph":
    case "edited-book":
    case "reference-book": {
      const book: Book = {
        ...base,
        type: "book",
        ...(work.publisher ? { publisher: work.publisher } : {}),
        ...(work.type === "edited-book" && base.authors.length === 0
          ? { editors: contributors(work.editor) }
          : {}),
      };
      return book;
    }
    case "book-chapter": {
      const chapter: BookChapter = {
        ...base,
        type: "bookChapter",
        editors: contributors(work.editor),
        bookTitle: work["container-title"]?.[0] ?? "",
        ...(work.publisher ? { publisher: work.publisher } : {}),
        ...pageRange(work.page),
      };
      return chapter;
    }
    default:
      return null;
  }
}

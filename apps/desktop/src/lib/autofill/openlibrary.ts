import type { Book, Contributor } from "@tesina/engine";

/** The slice of an OpenLibrary /isbn/{isbn}.json response the mapper reads. */
export interface OpenLibraryBook {
  title?: string;
  publishers?: string[];
  publish_date?: string;
}

/**
 * OpenLibrary author names arrive from separate /authors/{key}.json fetches
 * as display names ("Nora Salgado"); the last word becomes the surname and
 * the rest the given names — a heuristic the user confirms in the form.
 */
export function contributorFromDisplayName(name: string): Contributor {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) {
    return { kind: "person", family: name.trim() };
  }
  const family = words[words.length - 1]!;
  const given = words.slice(0, -1).join(" ");
  return { kind: "person", family, given };
}

export function mapOpenLibraryBook(
  data: OpenLibraryBook,
  authorNames: string[],
  id: string,
): Book | null {
  const title = data.title?.trim() ?? "";
  if (title === "") return null;
  const yearMatch = data.publish_date?.match(/\d{4}/);
  return {
    id,
    type: "book",
    authors: authorNames.map(contributorFromDisplayName),
    date: yearMatch
      ? { year: Number.parseInt(yearMatch[0], 10) }
      : { noDate: true },
    title,
    ...(data.publishers?.[0] ? { publisher: data.publishers[0] } : {}),
  };
}

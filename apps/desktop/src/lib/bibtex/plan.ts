/**
 * Turns raw `.bib` text into a review plan: one row per entry (already mapped
 * to a `Reference`) plus duplicate flags, so the import modal can let the user
 * pick what enters the library. Parsing and mapping are pure; `library.add`
 * still never dedupes — duplicate detection lives here, at import time.
 */
import {
  type Library,
  parse,
  type ParseError,
} from "@retorquere/bibtex-parser";
import type { Reference } from "@tesina/engine";
import { type BibWarning, mapBibEntry, normalizeDoi } from "./map.ts";

export interface ImportRow {
  /** BibTeX citation key, shown for orientation; discarded on import. */
  key: string;
  ref: Reference;
  warnings: BibWarning[];
  /** Set when the entry already exists in the library or earlier in the file. */
  duplicate?: { of: "library" | "batch"; label: string };
}

export interface ImportPlan {
  rows: ImportRow[];
  /** Entries the parser could not read; surfaced as a count in the modal. */
  errors: ParseError[];
}

/** Parse `.bib` text with Tesina's options (no sentence-casing, tolerant). */
export function parseBib(text: string): Library {
  return parse(text, { english: false, unsupported: "ignore" });
}

/**
 * Fuzzy key for title+year duplicate matching: case-folded, diacritics
 * stripped, non-alphanumerics dropped. Guards against the same work arriving
 * with hand-typed vs LaTeX-escaped accents.
 */
export function normalizeTitleKey(title: string, year?: number): string {
  const norm = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "");
  return `${norm}|${year ?? "?"}`;
}

/**
 * Build the review plan. Duplicates match by normalized DOI first, then by
 * title+year for entries without a DOI, against both the existing library and
 * earlier rows in this same file.
 */
export function buildImportPlan(
  lib: Library,
  existing: Reference[],
): ImportPlan {
  const libraryDoi = new Map<string, string>();
  const libraryTitle = new Map<string, string>();
  for (const ref of existing) {
    if (ref.doi) libraryDoi.set(normalizeDoi(ref.doi), ref.title);
    if (ref.title) {
      libraryTitle.set(normalizeTitleKey(ref.title, ref.date.year), ref.title);
    }
  }

  const batchDoi = new Map<string, string>();
  const batchTitle = new Map<string, string>();
  const rows: ImportRow[] = [];

  for (const entry of lib.entries) {
    const { ref, warnings } = mapBibEntry(entry, crypto.randomUUID());

    // A malformed entry can survive parsing as a stub with no usable fields
    // (the parser also records it under `errors`). Drop it rather than show a
    // confusing empty row — it's already counted as an unreadable entry.
    if (ref.title === "" && ref.authors.length === 0) continue;

    const doiKey = ref.doi ? normalizeDoi(ref.doi) : "";
    const titleKey = ref.title
      ? normalizeTitleKey(ref.title, ref.date.year)
      : "";

    let duplicate: ImportRow["duplicate"];
    if (doiKey && libraryDoi.has(doiKey)) {
      duplicate = { of: "library", label: libraryDoi.get(doiKey)! };
    } else if (doiKey && batchDoi.has(doiKey)) {
      duplicate = { of: "batch", label: batchDoi.get(doiKey)! };
    } else if (!doiKey && titleKey && libraryTitle.has(titleKey)) {
      duplicate = { of: "library", label: libraryTitle.get(titleKey)! };
    } else if (!doiKey && titleKey && batchTitle.has(titleKey)) {
      duplicate = { of: "batch", label: batchTitle.get(titleKey)! };
    }

    if (doiKey && !batchDoi.has(doiKey)) batchDoi.set(doiKey, ref.title);
    if (titleKey && !batchTitle.has(titleKey)) {
      batchTitle.set(titleKey, ref.title);
    }

    rows.push({
      key: entry.key,
      ref,
      warnings,
      ...(duplicate ? { duplicate } : {}),
    });
  }

  return { rows, errors: lib.errors };
}

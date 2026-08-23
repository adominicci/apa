import type { DocLocale } from "@tesina/engine";

export const MAX_SPELLING_TERMS = 256;
export const MAX_SPELLING_TERM_UNITS = 128;

export interface CanonicalTerm {
  display: string;
  key: string;
}

export type AddCanonicalTermResult =
  | { status: "added" | "duplicate"; terms: string[] }
  | { status: "invalid" | "overflow"; terms: readonly string[] };

const CONTROL_OR_WHITESPACE = /[\p{Cc}\p{Cf}\p{Cs}\p{Z}\s]/u;

export function canonicalizeTerm(
  candidate: unknown,
  language: DocLocale,
): CanonicalTerm | null {
  if (typeof candidate !== "string") return null;
  const display = candidate.trim().normalize("NFC");
  if (
    display.length === 0 || display.length > MAX_SPELLING_TERM_UNITS ||
    CONTROL_OR_WHITESPACE.test(display)
  ) return null;
  return { display, key: display.toLocaleLowerCase(language) };
}

export function canonicalizeStoredTerms(
  value: unknown,
  language: DocLocale,
): string[] {
  if (!Array.isArray(value)) return [];
  const terms: string[] = [];
  const keys = new Set<string>();
  for (const candidate of value) {
    const canonical = canonicalizeTerm(candidate, language);
    if (!canonical || keys.has(canonical.key)) continue;
    keys.add(canonical.key);
    terms.push(canonical.display);
    if (terms.length === MAX_SPELLING_TERMS) break;
  }
  return terms;
}

export function isCanonicalStoredTerms(
  value: unknown,
  language: DocLocale,
): value is string[] {
  if (!Array.isArray(value) || value.length > MAX_SPELLING_TERMS) return false;
  const canonical = canonicalizeStoredTerms(value, language);
  return canonical.length === value.length &&
    canonical.every((term, index) => term === value[index]);
}

export function addCanonicalTerm(
  current: readonly string[],
  candidate: unknown,
  language: DocLocale,
): AddCanonicalTermResult {
  const canonical = canonicalizeTerm(candidate, language);
  if (!canonical) return { status: "invalid", terms: current };
  if (
    current.some((term) =>
      canonicalizeTerm(term, language)?.key === canonical.key
    )
  ) return { status: "duplicate", terms: [...current] };
  if (current.length >= MAX_SPELLING_TERMS) {
    return { status: "overflow", terms: current };
  }
  return { status: "added", terms: [...current, canonical.display] };
}

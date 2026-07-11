import type { Contributor } from "./model/reference.ts";
import type { LocaleTerms } from "./locale/terms.ts";

/**
 * "José María" → "J. M.", "Jean-Paul" → "J.-P.", "J. M." → "J. M.".
 * Tokens split on whitespace keep internal hyphens, initialing each part.
 */
export function initialsOf(given: string): string {
  return given
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) =>
      token
        .split("-")
        .map((part) => {
          const letter = part.replace(/[.]/g, "").charAt(0);
          return letter ? `${letter.toUpperCase()}.` : "";
        })
        .filter((part) => part.length > 0)
        .join("-")
    )
    .filter((token) => token.length > 0)
    .join(" ");
}

/** Reference-list form: "García, J. M." / "Soto, R., Jr." / group name as-is. */
export function invertedName(c: Contributor): string {
  if (c.kind === "group") return c.name;
  const parts = [c.family];
  if (c.given) parts.push(initialsOf(c.given));
  if (c.suffix) parts.push(c.suffix);
  return parts.join(", ");
}

/** Running-prose form used for editors and translators: "J. M. García". */
export function initialsFirstName(c: Contributor): string {
  if (c.kind === "group") return c.name;
  return c.given ? `${initialsOf(c.given)} ${c.family}` : c.family;
}

/** In-text form: surname only, or "J. M. García" when initials disambiguate. */
export function inTextName(c: Contributor, useInitials: boolean): string {
  if (c.kind === "group") return c.name;
  if (useInitials && c.given) return `${initialsOf(c.given)} ${c.family}`;
  return c.family;
}

/**
 * Two comma policies feed off one locale flag: inverted reference-list
 * names always take the comma before "&" in English ("Soto, R., & Vega, L.");
 * inline prose lists follow ordinary serial-comma rules (comma only with
 * three or more names). Spanish never puts a comma before the and-word and
 * adjusts "y" → "e" against the following name.
 */
function joinWithAnd(
  names: readonly string[],
  andWord: string,
  t: LocaleTerms,
  style: "inverted" | "inline",
): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  const last = names[names.length - 1]!;
  const head = names.slice(0, -1).join(", ");
  const useComma = t.serialCommaBeforeAnd &&
    (style === "inverted" || names.length > 2);
  const and = t.andBefore(andWord, last);
  return `${head}${useComma ? "," : ""} ${and} ${last}`;
}

/**
 * Reference-list author block (APA 9.8): up to 20 authors all listed with
 * the and-word before the last; 21 or more collapse to the first 19, a
 * spaced ellipsis, and the final author with no and-word.
 */
export function formatAuthorsForReferences(
  authors: readonly Contributor[],
  t: LocaleTerms,
): string {
  const inverted = authors.map(invertedName);
  if (inverted.length === 0) return "";
  if (inverted.length <= 20) {
    return joinWithAnd(inverted, t.andReferences, t, "inverted");
  }
  const first19 = inverted.slice(0, 19).join(", ");
  const last = inverted[inverted.length - 1]!;
  return `${first19}, . . . ${last}`;
}

/**
 * Editor/translator lists inside an entry ("In J. Soto & M. Vega (Eds.), …"):
 * initials-first names joined as inline prose. No 21+ rule here — edited
 * books with that many editors do not realistically occur.
 */
export function formatContributorsInline(
  contributors: readonly Contributor[],
  t: LocaleTerms,
): string {
  return joinWithAnd(
    contributors.map(initialsFirstName),
    t.andReferences,
    t,
    "inline",
  );
}

/**
 * In-text author list for citations that spell out every name (1–2 authors,
 * or et-al expansion that reached the full list).
 */
export function formatAuthorsInText(
  authors: readonly Contributor[],
  useInitials: boolean,
  andWord: string,
  t: LocaleTerms,
): string {
  const names = authors.map((a) => inTextName(a, useInitials));
  return joinWithAnd(names, andWord, t, "inline");
}

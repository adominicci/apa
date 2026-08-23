import { describe, expect, it } from "vitest";
import {
  addCanonicalTerm,
  canonicalizeStoredTerms,
  canonicalizeTerm,
  isCanonicalStoredTerms,
  MAX_SPELLING_TERM_UNITS,
  MAX_SPELLING_TERMS,
} from "./canonicalTerms.ts";

describe("canonical spelling terms", () => {
  it("normalizes trusted English and Spanish display values and keys", () => {
    expect(canonicalizeTerm(" \u00a0Cafe\u0301\u3000", "es")).toEqual({
      display: "Café",
      key: "café",
    });
    expect(canonicalizeTerm("TITLE", "en")).toEqual({
      display: "TITLE",
      key: "title",
    });
    expect(canonicalizeTerm("two words", "en")).toBeNull();
    expect(canonicalizeTerm("bad\u0000", "en")).toBeNull();
    expect(canonicalizeTerm("x".repeat(MAX_SPELLING_TERM_UNITS + 1), "en"))
      .toBeNull();
  });

  it("sanitizes stored arrays with first-winner and exact bounds", () => {
    const input = [
      " Cafe\u0301 ",
      "CAFÉ",
      "valid",
      "two words",
      ...Array.from(
        { length: MAX_SPELLING_TERMS },
        (_, index) => `term${index}`,
      ),
    ];
    const result = canonicalizeStoredTerms(input, "es");
    expect(result).toHaveLength(MAX_SPELLING_TERMS);
    expect(result.slice(0, 2)).toEqual(["Café", "valid"]);
    expect(new Set(result.map((term) => term.toLocaleLowerCase("es"))).size)
      .toBe(MAX_SPELLING_TERMS);
  });

  it("applies trusted additions atomically and keeps first display spelling", () => {
    expect(addCanonicalTerm(["Café"], " CAFÉ ", "es")).toEqual({
      status: "duplicate",
      terms: ["Café"],
    });
    expect(addCanonicalTerm(["Café"], "two words", "es")).toEqual({
      status: "invalid",
      terms: ["Café"],
    });
    const full = Array.from(
      { length: MAX_SPELLING_TERMS },
      (_, index) => `term${index}`,
    );
    expect(addCanonicalTerm(full, "overflow", "en")).toEqual({
      status: "overflow",
      terms: full,
    });
  });

  it("distinguishes canonical untrusted arrays from data that needs sanitizing", () => {
    expect(isCanonicalStoredTerms(["Café", "term"], "es")).toBe(true);
    expect(isCanonicalStoredTerms([" Cafe\u0301", "term"], "es")).toBe(false);
    expect(isCanonicalStoredTerms(["Café", "CAFÉ"], "es")).toBe(false);
  });
});

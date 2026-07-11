export type DetectedInput =
  | { kind: "doi"; value: string }
  | { kind: "isbn"; value: string }
  | { kind: "url"; value: string }
  | { kind: "unknown"; value: string };

const DOI_PATTERN = /10\.\d{4,9}\/\S+/;

function isbnChecksumOk(digits: string): boolean {
  if (digits.length === 10) {
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      const ch = digits[i]!;
      const value = ch === "X" || ch === "x" ? 10 : Number.parseInt(ch, 10);
      if (Number.isNaN(value)) return false;
      sum += (10 - i) * value;
    }
    return sum % 11 === 0;
  }
  if (digits.length === 13) {
    let sum = 0;
    for (let i = 0; i < 13; i++) {
      const value = Number.parseInt(digits[i]!, 10);
      if (Number.isNaN(value)) return false;
      sum += value * (i % 2 === 0 ? 1 : 3);
    }
    return sum % 10 === 0;
  }
  return false;
}

/**
 * Classifies whatever the user pasted into the autofill box. DOIs win over
 * URLs so that a pasted "https://doi.org/10.1234/x" resolves via CrossRef
 * instead of the generic URL scraper.
 */
export function detectInput(raw: string): DetectedInput {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "unknown", value: "" };

  const doiMatch = trimmed.match(DOI_PATTERN);
  if (doiMatch) {
    return {
      kind: "doi",
      value: doiMatch[0].replace(/[.,;)\]]+$/, ""),
    };
  }

  const compact = trimmed.replace(/[-\s]/g, "");
  if (/^\d{9}[\dXx]$/.test(compact) || /^\d{13}$/.test(compact)) {
    if (isbnChecksumOk(compact)) {
      return { kind: "isbn", value: compact.toUpperCase() };
    }
  }

  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    return { kind: "url", value: trimmed };
  }

  return { kind: "unknown", value: trimmed };
}

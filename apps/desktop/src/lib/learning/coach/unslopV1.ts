import type { DocLocale } from "@tesina/engine";
import { sentences } from "./segmentation.ts";

export const UNSLOP_POLICY_VERSION = "unslopV1" as const;
export type UnslopViolationCode =
  | "canned-framing"
  | "heading-inflation"
  | "experiential-claim"
  | "reviewed-slang"
  | "nonstandard-language"
  | "adjacent-repetition";

export interface UnslopViolation {
  code: UnslopViolationCode;
  from: number;
  to: number;
  observedText: string;
}

const PATTERNS: Record<
  DocLocale,
  Array<{ code: UnslopViolationCode; phrase: string }>
> = {
  en: [
    { code: "canned-framing", phrase: "it is important to note that" },
    { code: "heading-inflation", phrase: "a comprehensive exploration of" },
    { code: "experiential-claim", phrase: "in my experience" },
    { code: "reviewed-slang", phrase: "super cool" },
    { code: "nonstandard-language", phrase: "could of" },
  ],
  es: [
    { code: "canned-framing", phrase: "cabe señalar que" },
    { code: "heading-inflation", phrase: "una exploración integral" },
    { code: "experiential-claim", phrase: "en mi experiencia" },
    { code: "reviewed-slang", phrase: "súper chévere" },
    { code: "nonstandard-language", phrase: "habían muchas" },
  ],
};

const escape = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\s+/gu, "\\s+");
const compareLexically = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

export function auditUnslopV1(
  request: { text: string; contentLanguage: DocLocale },
) {
  if (request.contentLanguage !== "en" && request.contentLanguage !== "es") {
    throw new TypeError("unsupported-content-language");
  }
  if (typeof request.text !== "string") {
    throw new TypeError("invalid-generated-text");
  }
  const violations: UnslopViolation[] = [];
  for (const pattern of PATTERNS[request.contentLanguage]) {
    const matcher = new RegExp(
      `(?<![\\p{L}\\p{M}\\p{N}])${
        escape(pattern.phrase)
      }(?![\\p{L}\\p{M}\\p{N}])`,
      "giu",
    );
    for (const match of request.text.matchAll(matcher)) {
      violations.push({
        code: pattern.code,
        from: match.index,
        to: match.index + match[0].length,
        observedText: match[0],
      });
    }
  }
  const sentenceRanges = sentences(request.text);
  for (let index = 1; index < sentenceRanges.length; index += 1) {
    const prior = sentenceRanges[index - 1]!;
    const current = sentenceRanges[index]!;
    const priorText = request.text.slice(prior.from, prior.to)
      .toLocaleLowerCase(request.contentLanguage);
    const currentText = request.text.slice(current.from, current.to)
      .toLocaleLowerCase(request.contentLanguage);
    if (priorText === currentText) {
      violations.push({
        code: "adjacent-repetition",
        from: current.from,
        to: current.to,
        observedText: request.text.slice(current.from, current.to),
      });
    }
  }
  violations.sort((a, b) =>
    a.from - b.from || a.to - b.to || compareLexically(a.code, b.code)
  );
  return { policyVersion: UNSLOP_POLICY_VERSION, violations };
}

export interface CorrectionValidationState {
  phase: "initial" | "corrected";
  schemaValid: boolean;
  grounded: boolean;
  styleCompliant: boolean;
}

export function correctionEligibility(state: CorrectionValidationState) {
  if (!state.schemaValid || !state.grounded) {
    return {
      disposition: "discard" as const,
      styleAttemptsAuthorized: 0 as const,
    };
  }
  if (state.styleCompliant) {
    return {
      disposition: "accept" as const,
      styleAttemptsAuthorized: 0 as const,
    };
  }
  if (state.phase === "initial") {
    return {
      disposition: "eligible-style-correction" as const,
      styleAttemptsAuthorized: 1 as const,
    };
  }
  return {
    disposition: "discard" as const,
    styleAttemptsAuthorized: 0 as const,
  };
}

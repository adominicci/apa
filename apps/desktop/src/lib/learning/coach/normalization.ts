import {
  type CoachToken,
  paragraphs,
  sentences,
  type TextRange,
  tokens,
} from "./segmentation.ts";
import {
  COACH_CATEGORIES,
  type CoachCategory,
  type ProtectedSpanKind,
  type WritingCoachRequest,
} from "./types.ts";

export interface Candidate extends TextRange {
  category: CoachCategory;
  ruleId: string;
  priority: number;
}

export interface Protection extends TextRange {
  kinds: ProtectedSpanKind[];
}

const KIND_ORDER: ProtectedSpanKind[] = [
  "citation",
  "quotation",
  "source-title",
  "proper-name",
];
const CATEGORY_ORDER = new Map(
  COACH_CATEGORIES.map((category, index) => [category, index]),
);
const overlaps = (a: TextRange, b: TextRange): boolean =>
  a.from < b.to && b.from < a.to;
const compareLexically = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

export function normalizeProtection(
  request: WritingCoachRequest,
): Protection[] {
  const spans: Array<{ from: number; to: number; kind: ProtectedSpanKind }> =
    request.protectedSpans.map((span) => ({ ...span }));
  for (const paragraph of paragraphs(request.text)) {
    const paragraphText = request.text.slice(paragraph.from, paragraph.to);
    for (const quote of paragraphText.matchAll(/(["“])(?=\S)(.*?\S)(["”])/gu)) {
      if (
        (quote[1] === '"' && quote[3] !== '"') ||
        (quote[1] === "“" && quote[3] !== "”")
      ) continue;
      spans.push({
        from: request.documentStart + paragraph.from + quote.index,
        to: request.documentStart + paragraph.from + quote.index +
          quote[0].length,
        kind: "quotation",
      });
    }
  }
  for (
    const citation of request.text.matchAll(
      /\([\p{L}][\p{L}\p{M}'’.-]*(?:\s+(?:&|y)\s+[\p{L}][\p{L}\p{M}'’.-]*)?,\s*(?:19|20)\d{2}[a-z]?\)/gu,
    )
  ) {
    spans.push({
      from: request.documentStart + citation.index,
      to: request.documentStart + citation.index + citation[0].length,
      kind: "citation",
    });
  }
  spans.sort((a, b) =>
    a.from - b.from || a.to - b.to ||
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
  );
  const merged: Protection[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span.from <= last.to) {
      last.to = Math.max(last.to, span.to);
      if (!last.kinds.includes(span.kind)) {
        last.kinds.push(span.kind);
        last.kinds.sort((a, b) =>
          KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b)
        );
      }
    } else merged.push({ from: span.from, to: span.to, kinds: [span.kind] });
  }
  return merged;
}

export function filterProtectedCandidates<T extends Candidate>(
  candidates: readonly T[],
  protection: readonly Protection[],
): T[] {
  return candidates.filter((candidate) =>
    !protection.some((span) => overlaps(candidate, span))
  );
}

export function maskedTokens(
  request: WritingCoachRequest,
  protection: readonly Protection[],
): CoachToken[] {
  return tokens(request.text, request.documentLanguage).filter((token) => {
    const absolute = {
      from: request.documentStart + token.from,
      to: request.documentStart + token.to,
    };
    return !protection.some((span) => overlaps(absolute, span));
  });
}

export function hasNearbySupport(
  text: string,
  claim: TextRange,
  protection: readonly Protection[],
  documentStart: number,
): boolean {
  const ranges = sentences(text).map((range) => ({
    from: range.from + documentStart,
    to: range.to + documentStart,
  }));
  const claimIndex = ranges.findIndex((range) =>
    claim.from >= range.from && claim.from < range.to
  );
  if (claimIndex < 0) return false;
  return protection.some((span) => {
    if (
      !span.kinds.some((kind) => kind === "citation" || kind === "quotation")
    ) return false;
    return [ranges[claimIndex], ranges[claimIndex + 1]].some((range) =>
      range && overlaps(span, range)
    );
  });
}

export function normalizeCandidates<T extends Candidate>(
  candidates: readonly T[],
): T[] {
  const exact = new Map<string, T>();
  for (const candidate of candidates) {
    const key = `${candidate.category}\0${candidate.from}\0${candidate.to}`;
    const prior = exact.get(key);
    if (
      !prior || candidate.priority < prior.priority ||
      (candidate.priority === prior.priority && candidate.ruleId < prior.ruleId)
    ) {
      exact.set(key, candidate);
    }
  }
  const ranked = [...exact.values()].sort((a, b) =>
    (a.to - a.from) - (b.to - b.from) || a.from - b.from || a.to - b.to ||
    a.priority - b.priority || compareLexically(a.ruleId, b.ruleId)
  );
  const retained: T[] = [];
  for (const candidate of ranked) {
    if (
      !retained.some((prior) =>
        prior.category === candidate.category && overlaps(prior, candidate)
      )
    ) {
      retained.push(candidate);
    }
  }
  return retained.sort((a, b) =>
    a.from - b.from || a.to - b.to ||
    CATEGORY_ORDER.get(a.category)! - CATEGORY_ORDER.get(b.category)! ||
    compareLexically(a.ruleId, b.ruleId)
  );
}

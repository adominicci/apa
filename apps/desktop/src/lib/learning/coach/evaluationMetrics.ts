import type { ProposedObservation } from "./fixtures/index.ts";
import { COACH_CATEGORIES, type WritingCoachIssue } from "./types.ts";

const CATEGORY_ORDER = new Map(
  COACH_CATEGORIES.map((category, index) => [category, index]),
);

export interface MatchResult {
  matches: Array<
    { emittedIndex: number; expectedId: string; exactSpan: boolean }
  >;
  unmatchedEmitted: number[];
  unmatchedExpected: string[];
}

export function matchIssues(
  emittedInput: readonly WritingCoachIssue[],
  expectedInput: readonly ProposedObservation[],
): MatchResult {
  const emitted = emittedInput.map((issue, originalIndex) => ({
    issue,
    originalIndex,
  })).sort((a, b) =>
    a.issue.from - b.issue.from || a.issue.to - b.issue.to ||
    CATEGORY_ORDER.get(a.issue.category)! -
      CATEGORY_ORDER.get(b.issue.category)!
  );
  const expected = [...expectedInput].sort((a, b) =>
    a.from - b.from || a.to - b.to ||
    CATEGORY_ORDER.get(a.category)! - CATEGORY_ORDER.get(b.category)! ||
    a.id.localeCompare(b.id)
  );
  const pairs = emitted.flatMap((entry, emittedOrder) =>
    expected.flatMap((observation) => {
      if (
        entry.issue.category !== observation.category ||
        entry.issue.from >= observation.to || observation.from >= entry.issue.to
      ) return [];
      return [{
        emittedOrder,
        emittedIndex: entry.originalIndex,
        expectedId: observation.id,
        exactSpan: entry.issue.from === observation.from &&
          entry.issue.to === observation.to,
        intersection: Math.min(entry.issue.to, observation.to) -
          Math.max(entry.issue.from, observation.from),
        distance: Math.abs(entry.issue.from - observation.from) +
          Math.abs(entry.issue.to - observation.to),
      }];
    })
  ).sort((a, b) =>
    Number(b.exactSpan) - Number(a.exactSpan) ||
    b.intersection - a.intersection || a.distance - b.distance ||
    a.emittedOrder - b.emittedOrder || a.expectedId.localeCompare(b.expectedId)
  );
  const usedEmitted = new Set<number>();
  const usedExpected = new Set<string>();
  const matches: MatchResult["matches"] = [];
  for (const pair of pairs) {
    if (
      usedEmitted.has(pair.emittedIndex) || usedExpected.has(pair.expectedId)
    ) continue;
    usedEmitted.add(pair.emittedIndex);
    usedExpected.add(pair.expectedId);
    matches.push({
      emittedIndex: pair.emittedIndex,
      expectedId: pair.expectedId,
      exactSpan: pair.exactSpan,
    });
  }
  matches.sort((a, b) =>
    a.emittedIndex - b.emittedIndex || a.expectedId.localeCompare(b.expectedId)
  );
  return {
    matches,
    unmatchedEmitted: emittedInput.map((_, index) => index).filter((index) =>
      !usedEmitted.has(index)
    ),
    unmatchedExpected: expected.map((item) => item.id).filter((id) =>
      !usedExpected.has(id)
    ),
  };
}

export type RateState = "computed" | "pending-review" | "not-computable";
export interface Rate {
  numerator: number;
  denominator: number;
  basisPoints: number | null;
  state: RateState;
}

export function basisPointRate(
  numerator: number,
  denominator: number,
  pending = false,
): Rate {
  if (denominator === 0) {
    return {
      numerator,
      denominator,
      basisPoints: null,
      state: pending ? "pending-review" : "not-computable",
    };
  }
  return {
    numerator,
    denominator,
    basisPoints: Math.floor(
      (numerator * 20_000 + denominator) / (2 * denominator),
    ),
    state: "computed",
  };
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function macroRate(rates: readonly Rate[], pending = false): Rate {
  if (rates.some((rate) => rate.denominator === 0)) {
    return basisPointRate(0, 0, pending);
  }
  let numerator = 0n;
  let denominator = 1n;
  for (const rate of rates) {
    numerator = numerator * BigInt(rate.denominator) +
      BigInt(rate.numerator) * denominator;
    denominator *= BigInt(rate.denominator);
    const divisor = gcd(numerator, denominator);
    numerator /= divisor;
    denominator /= divisor;
  }
  denominator *= BigInt(rates.length);
  const divisor = gcd(numerator, denominator);
  numerator /= divisor;
  denominator /= divisor;
  return basisPointRate(Number(numerator), Number(denominator));
}

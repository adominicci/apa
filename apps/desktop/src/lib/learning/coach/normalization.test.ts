import { describe, expect, it } from "vitest";
import {
  type Candidate,
  filterProtectedCandidates,
  hasNearbySupport,
  maskedTokens,
  normalizeCandidates,
  normalizeProtection,
} from "./normalization.ts";
import type { WritingCoachRequest } from "./types.ts";

const request = (text: string): WritingCoachRequest => ({
  text,
  documentLanguage: "en",
  documentStart: 100,
  protectedSpans: [],
});

const candidate = (
  from: number,
  to: number,
  category: Candidate["category"] = "economy",
  ruleId = "b",
  priority = 2,
): Candidate => ({ from, to, category, ruleId, priority });

describe("protected coach source", () => {
  it("sorts and merges touching spans while retaining kind unions", () => {
    const input: WritingCoachRequest = {
      ...request("01234567890123456789"),
      protectedSpans: [
        { from: 110, to: 114, kind: "proper-name" },
        { from: 103, to: 108, kind: "citation" },
        { from: 108, to: 112, kind: "quotation" },
      ],
    };
    expect(normalizeProtection(input)).toEqual([{
      from: 103,
      to: 114,
      kinds: ["citation", "quotation", "proper-name"],
    }]);
    expect(input.protectedSpans).toHaveLength(3);
  });

  it("infers only balanced quotations and narrow APA-shaped citations", () => {
    const spans = normalizeProtection(
      request('Before “quoted words” and (Rivera, 2024). After "open.'),
    );
    expect(
      spans.map((
        { from, to, kinds },
      ) => [
        from,
        to,
        kinds,
        request('Before “quoted words” and (Rivera, 2024). After "open.').text
          .slice(from - 100, to - 100),
      ]),
    )
      .toEqual([
        [107, 121, ["quotation"], "“quoted words”"],
        [126, 140, ["citation"], "(Rivera, 2024)"],
      ]);
  });

  it("keeps inferred quotation offsets after variable blank-line separators", () => {
    const input = request("First paragraph.\n   \nSecond “exact quote” ends.");
    const observed = "“exact quote”";
    const from = input.documentStart + input.text.indexOf(observed);
    expect(normalizeProtection(input)).toContainEqual({
      from,
      to: from + observed.length,
      kinds: ["quotation"],
    });
  });

  it("discards any intersecting candidate but retains touching candidates", () => {
    const protection = [{ from: 110, to: 120, kinds: ["quotation" as const] }];
    expect(
      filterProtectedCandidates([
        candidate(105, 110),
        candidate(105, 111),
        candidate(112, 118),
        candidate(119, 125),
        candidate(120, 125),
      ], protection).map(({ from, to }) => [from, to]),
    ).toEqual([[105, 110], [120, 125]]);
  });

  it("masks protected lexical tokens and finds support in the next sentence only", () => {
    const input = request(
      "This clearly proves the result today. (Rivera, 2024). Later text follows.",
    );
    const protection = normalizeProtection(input);
    expect(maskedTokens(input, protection).map((token) => token.normalized)).not
      .toContain("rivera");
    expect(
      hasNearbySupport(input.text, { from: 100, to: 137 }, protection, 100),
    ).toBe(true);
    expect(
      hasNearbySupport(input.text, { from: 158, to: 177 }, protection, 100),
    ).toBe(false);
  });
});

describe("deterministic candidate normalization", () => {
  it("collapses exact duplicates by priority then stable ID", () => {
    const output = normalizeCandidates([
      candidate(0, 4, "economy", "z", 1),
      candidate(0, 4, "economy", "a", 1),
      candidate(0, 4, "economy", "x", 2),
    ]);
    expect(output).toEqual([candidate(0, 4, "economy", "a", 1)]);
  });

  it("selects shortest same-category spans independent of arrival order", () => {
    const values = [
      candidate(0, 10),
      candidate(0, 4, "economy", "a"),
      candidate(4, 8, "economy", "c"),
      candidate(7, 12, "economy", "d"),
    ];
    const expected = [[0, 4], [4, 8]];
    expect(normalizeCandidates(values).map(({ from, to }) => [from, to]))
      .toEqual(expected);
    expect(
      normalizeCandidates([...values].reverse()).map((
        { from, to },
      ) => [from, to]),
    ).toEqual(expected);
  });

  it("allows cross-category overlap and sorts by fixed category order", () => {
    const output = normalizeCandidates([
      candidate(0, 5, "voice", "v"),
      candidate(0, 5, "specificity", "s"),
    ]);
    expect(output.map(({ category }) => category)).toEqual([
      "specificity",
      "voice",
    ]);
  });
});

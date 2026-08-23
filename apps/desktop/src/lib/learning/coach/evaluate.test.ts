import { describe, expect, it } from "vitest";
import {
  basisPointRate,
  canonicalJson,
  createReviewInstance,
  createReviewRequirements,
  evaluateCorpus,
  macroRate,
  matchIssues,
  type ObservationReviewDecision,
  type ReviewDecision,
  type ReviewerAssignment,
  validateReviewState,
} from "./evaluate.ts";
import type { WritingCoachIssue } from "./types.ts";
import {
  PENDING_AGGREGATE_SNAPSHOT,
  REVIEW_HANDOFF_BUNDLE,
} from "./reviewBundle.ts";

const issue = (
  from: number,
  to: number,
  category: WritingCoachIssue["category"] = "clarity",
): WritingCoachIssue => ({
  from,
  to,
  category,
  observedText: "x",
  explanation: {
    id: `coach.${category}.explanation`,
    params: { observedText: "x" },
  },
  learningQuestion: {
    id: `coach.${category}.question`,
    params: { observedText: "x" },
  },
  source: "deterministic",
});

describe("offline one-to-one matching", () => {
  it("uses exact span, intersection, distance, emitted order, then expected ID", () => {
    const result = matchIssues(
      [issue(10, 20), issue(12, 18), issue(30, 40, "voice")],
      [
        { id: "b", category: "clarity", from: 11, to: 19 },
        { id: "a", category: "clarity", from: 10, to: 20 },
        { id: "c", category: "voice", from: 35, to: 45 },
      ],
    );
    expect(
      result.matches.map((
        match,
      ) => [match.emittedIndex, match.expectedId, match.exactSpan]),
    ).toEqual([
      [0, "a", true],
      [1, "b", false],
      [2, "c", false],
    ]);
    expect(result.unmatchedEmitted).toEqual([]);
    expect(result.unmatchedExpected).toEqual([]);
  });

  it("does not match touching or cross-category spans and keeps single-use counts", () => {
    const result = matchIssues([issue(0, 5), issue(4, 8, "voice")], [
      { id: "touch", category: "clarity", from: 5, to: 9 },
      { id: "wrong", category: "economy", from: 4, to: 6 },
    ]);
    expect(result.matches).toEqual([]);
    expect(result.unmatchedEmitted).toEqual([0, 1]);
    expect(result.unmatchedExpected).toEqual(["wrong", "touch"]);
  });
});

describe("stable aggregate mechanics", () => {
  it("uses integer half-up basis points and never substitutes a zero denominator", () => {
    expect(basisPointRate(2, 3)).toEqual({
      numerator: 2,
      denominator: 3,
      basisPoints: 6667,
      state: "computed",
    });
    expect(basisPointRate(0, 0)).toEqual({
      numerator: 0,
      denominator: 0,
      basisPoints: null,
      state: "not-computable",
    });
    expect(basisPointRate(0, 0, true)).toEqual({
      numerator: 0,
      denominator: 0,
      basisPoints: null,
      state: "pending-review",
    });
    expect(macroRate([basisPointRate(1, 2), basisPointRate(1, 4)])).toEqual({
      numerator: 3,
      denominator: 8,
      basisPoints: 3750,
      state: "computed",
    });
  });

  it("serializes nested parameters with lexical object keys", () => {
    expect(canonicalJson({ z: 1, a: [{ y: true, x: null }] })).toBe(
      '{"a":[{"x":null,"y":true}],"z":1}',
    );
  });

  it("creates stable fully linked rendered-question instances", () => {
    const instance = createReviewInstance("fixture-1", issue(2, 6), 3, "es");
    expect(instance.key).toEqual(expect.objectContaining({
      fixtureId: "fixture-1",
      uiLocale: "es",
      catalogVersion: "coach-render-catalog-v1",
    }));
    expect(instance.key.issueKey).toContain("3\u00002\u00006\u0000clarity");
    expect(instance.digest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("keeps the complete corpus pending without human decisions and retains every fixed cell", () => {
    const aggregate = evaluateCorpus();
    expect(Object.keys(aggregate)[0]).toBe("schemaVersion");
    expect(aggregate.schemaVersion).toBe("writing-coach-evaluation-v1");
    expect(aggregate.status).toBe("pending-human-review");
    expect(aggregate.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(aggregate.byDocumentLanguage).toHaveLength(2);
    expect(aggregate.byCategory).toHaveLength(6);
    expect(aggregate.byCohort).toHaveLength(4);
    expect(aggregate.byLanguageCategory).toHaveLength(12);
    expect(aggregate.byLanguageCohort).toHaveLength(8);
    expect(aggregate.byLanguageCategoryUiLocale).toHaveLength(24);
    expect(aggregate.falsePositiveRates).toHaveLength(4);
    expect(aggregate.macro.precision.basisPoints).toBe(10_000);
    expect(aggregate.gates.some((gate) => gate.state === "pending-review"))
      .toBe(true);
    expect(PENDING_AGGREGATE_SNAPSHOT).toEqual(aggregate);
    expect(REVIEW_HANDOFF_BUNDLE.aggregateDigest).toBe(aggregate.digest);
    expect(
      REVIEW_HANDOFF_BUNDLE.reviewerSlots.every((slot) =>
        slot.reviewerId === null
      ),
    ).toBe(true);
    expect(REVIEW_HANDOFF_BUNDLE.submissionTemplates).toHaveLength(2);
    expect(
      REVIEW_HANDOFF_BUNDLE.submissionTemplates.every((submission) =>
        submission.reviewerId === null &&
        submission.bilingualAttestation === null &&
        submission.independenceAttestation === null &&
        submission.expectedObservationDecisions.every((decision) =>
          decision.decision === null
        ) &&
        submission.renderedQuestionDecisions.every((decision) =>
          decision.decision === null
        )
      ),
    ).toBe(true);
  });
});

describe("human review linkage", () => {
  const validAssignments: [ReviewerAssignment, ReviewerAssignment] = [
    {
      slot: 1,
      role: "independent-bilingual-reviewer",
      reviewerId: "reviewer-a",
      bilingualAttestation: true,
      independenceAttestation: true,
    },
    {
      slot: 2,
      role: "independent-bilingual-reviewer",
      reviewerId: "reviewer-b",
      bilingualAttestation: true,
      independenceAttestation: true,
    },
  ];

  it("distinguishes pending assignments from invalid duplicate or false attestations", () => {
    expect(validateReviewState([], [])).toBe("pending");
    expect(validateReviewState([
      validAssignments[0],
      { ...validAssignments[1], reviewerId: "reviewer-a" },
    ], [])).toBe("failed");
    expect(validateReviewState([
      validAssignments[0],
      { ...validAssignments[1], bilingualAttestation: false },
    ], [])).toBe("failed");
    expect(validateReviewState(validAssignments, [])).toBe("pending");
  });

  it("requires fresh complete independent decisions and treats not-useful as complete", () => {
    const requirements = createReviewRequirements();
    const questions: ReviewDecision[] = validAssignments.flatMap((
      { reviewerId },
    ) =>
      requirements.questions.map((instance, index) => ({
        reviewerId,
        key: instance.key,
        digest: instance.digest,
        decision: index === 0 ? "not-useful" : "useful",
      }))
    );
    const observations: ObservationReviewDecision[] = validAssignments.flatMap((
      { reviewerId },
    ) =>
      requirements.observations.map((item) => ({
        reviewerId,
        ...item,
        decision: "accept",
      }))
    );
    expect(validateReviewState(validAssignments, questions, observations)).toBe(
      "complete",
    );
    expect(evaluateCorpus(validAssignments, questions, observations).status)
      .toBe("passed");
    expect(
      validateReviewState(validAssignments, questions.slice(1), observations),
    ).toBe("pending");
    expect(
      validateReviewState(validAssignments, [{
        ...questions[0]!,
        digest: "0".repeat(64),
      }], []),
    ).toBe("failed");
    expect(
      validateReviewState(validAssignments, [questions[0]!, questions[0]!], []),
    ).toBe("failed");
    expect(
      validateReviewState(validAssignments, [{
        ...questions[0]!,
        decision: "abstain",
      }], []),
    ).toBe("failed");
    expect(
      validateReviewState(validAssignments, [], [{
        ...observations[0]!,
        fixtureId: "foreign",
      }]),
    ).toBe("failed");
    const disagreed = [...observations];
    const secondIndex = requirements.observations.length;
    disagreed[secondIndex] = { ...disagreed[secondIndex]!, decision: "reject" };
    expect(validateReviewState(validAssignments, questions, disagreed)).toBe(
      "failed",
    );
    expect(evaluateCorpus(validAssignments, questions, disagreed).status).toBe(
      "failed",
    );
  });
});

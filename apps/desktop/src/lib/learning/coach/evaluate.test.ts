import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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
import { renderCoachMessage } from "./fixtures/index.ts";
import {
  ACCEPTED_AGGREGATE_SNAPSHOT,
  ACCEPTED_REVIEW_EVIDENCE,
  PENDING_AGGREGATE_SNAPSHOT,
  REVIEW_HANDOFF_BUNDLE,
} from "./reviewBundle.ts";

const sha256File = async (url: URL): Promise<string> =>
  createHash("sha256").update(await readFile(url)).digest("hex");

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
    expect(aggregate.reviewerSlots).toHaveLength(2);
    expect(aggregate.reviewerSlots.every((slot) => slot.reviewerId === null))
      .toBe(true);
    expect(aggregate.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(aggregate.byDocumentLanguage).toHaveLength(2);
    expect(aggregate.byCategory).toHaveLength(6);
    expect(aggregate.byCohort).toHaveLength(4);
    expect(aggregate.byLanguageCategory).toHaveLength(12);
    expect(aggregate.byLanguageCohort).toHaveLength(8);
    expect(aggregate.byLanguageCategoryUiLocale).toHaveLength(24);
    expect(aggregate.falsePositiveRates).toHaveLength(4);
    expect(
      aggregate.falsePositiveRates.every((item) =>
        item.rate.denominator === 8 && item.unmatchedIssueCount === 0
      ),
    ).toBe(true);
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
    expect(REVIEW_HANDOFF_BUNDLE.corpusFixtures).toHaveLength(64);
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
    expect(validateReviewState([{
      ...validAssignments[0],
      bilingualAttestation: false,
    }], [])).toBe("failed");
    expect(validateReviewState([
      validAssignments[0],
      { ...validAssignments[1], reviewerId: "reviewer-a" },
    ], [])).toBe("failed");
    expect(validateReviewState([
      validAssignments[0],
      { ...validAssignments[1], bilingualAttestation: false },
    ], [])).toBe("failed");
    expect(validateReviewState(validAssignments, [])).toBe("pending");
    expect(evaluateCorpus([validAssignments[0]]).reviewerSlots).toHaveLength(2);
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
    expect(validateReviewState(
      [
        validAssignments[0],
        { ...validAssignments[1], slot: 1 },
      ],
      questions,
      observations,
    )).toBe("failed");
    expect(evaluateCorpus(validAssignments, questions, observations).status)
      .toBe("passed");
    const canonical = evaluateCorpus(validAssignments, questions, observations);
    const permuted = evaluateCorpus(
      validAssignments.toReversed(),
      questions.toReversed(),
      observations.toReversed(),
    );
    expect(permuted.status).toBe(canonical.status);
    expect(permuted.digest).toBe(canonical.digest);
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
    expect(
      validateReviewState(validAssignments, [], [{
        ...observations[0]!,
        inputDigest: "0".repeat(64),
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

  it("removes a dual-rejected observation from completed-review metrics", () => {
    const requirements = createReviewRequirements();
    const rejected = requirements.observations[0]!;
    const questions: ReviewDecision[] = validAssignments.flatMap((assignment) =>
      requirements.questions.map((instance) => ({
        reviewerId: assignment.reviewerId,
        key: instance.key,
        digest: instance.digest,
        decision: "useful" as const,
      }))
    );
    const observations: ObservationReviewDecision[] = validAssignments.flatMap(
      (assignment) =>
        requirements.observations.map((item) => ({
          reviewerId: assignment.reviewerId,
          ...item,
          decision: item.fixtureId === rejected.fixtureId &&
              item.expectedId === rejected.expectedId
            ? "reject" as const
            : "accept" as const,
        })),
    );

    const aggregate = evaluateCorpus(validAssignments, questions, observations);
    const rejectedCell = aggregate.byLanguageCategory.find((cell) =>
      cell.documentLanguage === rejected.documentLanguage &&
      cell.category === rejected.category
    )!;

    expect(validateReviewState(validAssignments, questions, observations)).toBe(
      "complete",
    );
    expect(aggregate.globalCounts).toEqual({
      emitted: 96,
      expected: 95,
      matched: 95,
      exact: 95,
      unmatched: 1,
    });
    expect(rejectedCell.counts).toEqual({
      emitted: 8,
      expected: 7,
      matched: 7,
      exact: 7,
      unmatched: 1,
    });
    expect(
      aggregate.gates.find((gate) => gate.code === "supported-cells")?.state,
    )
      .toBe("passed");
    expect(
      aggregate.gates.find((gate) => gate.code === "dual-reviewed-support")
        ?.state,
    ).toBe("failed");
  });

  it("links aggregate and decision freshness to exact rendered catalog wording", () => {
    const requirements = createReviewRequirements();
    const questions: ReviewDecision[] = validAssignments.flatMap((assignment) =>
      requirements.questions.map((instance) => ({
        reviewerId: assignment.reviewerId,
        key: instance.key,
        digest: instance.digest,
        decision: "useful" as const,
      }))
    );
    const observations: ObservationReviewDecision[] = validAssignments.flatMap(
      (assignment) =>
        requirements.observations.map((instance) => ({
          reviewerId: assignment.reviewerId,
          ...instance,
          decision: "accept" as const,
        })),
    );
    const changedRenderer: typeof renderCoachMessage = (descriptor, locale) =>
      `${renderCoachMessage(descriptor, locale)} `;
    expect(evaluateCorpus([], [], [], changedRenderer).digest).not.toBe(
      evaluateCorpus().digest,
    );
    expect(
      validateReviewState(
        validAssignments,
        questions,
        observations,
        changedRenderer,
      ),
    ).toBe("failed");
  });
});

describe("accepted independent bilingual review evidence", () => {
  it("preserves the exact assigned submission bytes and handoff linkage", async () => {
    expect(ACCEPTED_REVIEW_EVIDENCE).toMatchObject({
      sourceHead: "b149e4695a690c07908b12b912e5175b21281061",
      bundleSha256:
        "dbe6d00c8e5e15964978b3ccc8295687135471e1150c745841b1e26f4d9e51b6",
      pendingAggregateDigest:
        "5d1de45b2826127a8ec903b2a56ad556cb1cd94300d0e5b09a63756c0e0c1b36",
      submissionSha256: {
        "BR-01":
          "2cac67c88d6e3896c4e6d3b5718d98b79a7f7098a3f2a368f0ac069ab236bd47",
        "BR-02":
          "55ebb21bd586e884493ef7a14fbdc82b9d2a123573e036b28dd5b7f57e99e17a",
      },
    });
    await expect(
      sha256File(
        new URL("./reviewEvidence/br-01-submission.json", import.meta.url),
      ),
    ).resolves.toBe(ACCEPTED_REVIEW_EVIDENCE.submissionSha256["BR-01"]);
    await expect(
      sha256File(
        new URL("./reviewEvidence/br-02-submission.json", import.meta.url),
      ),
    ).resolves.toBe(ACCEPTED_REVIEW_EVIDENCE.submissionSha256["BR-02"]);
  });

  it("loads two complete distinct attested evaluator submissions", () => {
    expect(ACCEPTED_REVIEW_EVIDENCE.assignments).toEqual([
      {
        slot: 1,
        role: "independent-bilingual-reviewer",
        reviewerId: "BR-01",
        bilingualAttestation: true,
        independenceAttestation: true,
      },
      {
        slot: 2,
        role: "independent-bilingual-reviewer",
        reviewerId: "BR-02",
        bilingualAttestation: true,
        independenceAttestation: true,
      },
    ]);
    expect(ACCEPTED_REVIEW_EVIDENCE.decisions).toHaveLength(384);
    expect(
      ACCEPTED_REVIEW_EVIDENCE.decisions.every((item) =>
        item.decision === "useful"
      ),
    ).toBe(true);
    expect(ACCEPTED_REVIEW_EVIDENCE.observationDecisions).toHaveLength(192);
    expect(
      ACCEPTED_REVIEW_EVIDENCE.observationDecisions.every((item) =>
        item.decision === "accept"
      ),
    ).toBe(true);
  });

  it("checks the accepted aggregate and every fixed gate", () => {
    expect(ACCEPTED_AGGREGATE_SNAPSHOT.status).toBe("passed");
    expect(ACCEPTED_AGGREGATE_SNAPSHOT.digest).toBe(
      "c2914ffc2b8be8d049e1987326607e87d6f79311da37e8d765a5a1ae514ab677",
    );
    expect(ACCEPTED_AGGREGATE_SNAPSHOT.globalCounts).toEqual({
      emitted: 96,
      expected: 96,
      matched: 96,
      exact: 96,
      unmatched: 0,
    });
    expect(
      ACCEPTED_AGGREGATE_SNAPSHOT.gates.every((gate) =>
        gate.state === "passed"
      ),
    ).toBe(true);
    expect(evaluateCorpus(
      ACCEPTED_REVIEW_EVIDENCE.assignments,
      ACCEPTED_REVIEW_EVIDENCE.decisions,
      ACCEPTED_REVIEW_EVIDENCE.observationDecisions,
    )).toEqual(ACCEPTED_AGGREGATE_SNAPSHOT);
  });
});

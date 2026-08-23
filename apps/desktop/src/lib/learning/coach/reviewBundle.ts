import br01Submission from "./reviewEvidence/br-01-submission.json" with {
  type: "json",
};
import br02Submission from "./reviewEvidence/br-02-submission.json" with {
  type: "json",
};
import {
  createReviewRequirements,
  evaluateCorpus,
  type ObservationReviewDecision,
  type ReviewDecision,
  type ReviewerAssignment,
} from "./evaluate.ts";
import {
  COACH_CORPUS,
  COACH_CORPUS_VERSION,
  COACH_RENDER_CATALOG_VERSION,
  REVIEWER_SLOTS,
} from "./fixtures/index.ts";

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

export const PENDING_AGGREGATE_SNAPSHOT = deepFreeze(evaluateCorpus());
const requirements = createReviewRequirements();
const submissionTemplates = ([1, 2] as const).map((slot) => ({
  slot,
  reviewerId: null,
  bilingualAttestation: null,
  independenceAttestation: null,
  expectedObservationDecisions: requirements.observations.map((instance) => ({
    ...instance,
    decision: null,
  })),
  renderedQuestionDecisions: requirements.questions.map((instance) => ({
    key: instance.key,
    digest: instance.digest,
    decision: null,
  })),
}));

export const REVIEW_HANDOFF_BUNDLE = deepFreeze({
  schemaVersion: "writing-coach-review-handoff-v1" as const,
  corpusVersion: COACH_CORPUS_VERSION,
  catalogVersion: COACH_RENDER_CATALOG_VERSION,
  aggregateDigest: PENDING_AGGREGATE_SNAPSHOT.digest,
  reviewerSlots: REVIEWER_SLOTS,
  corpusFixtures: COACH_CORPUS,
  expectedObservationInstances: requirements.observations,
  renderedQuestionInstances: requirements.questions,
  instructions: {
    assignment: "The product owner assigns two distinct opaque reviewer IDs.",
    attestations:
      "Each human independently confirms bilingual ability and independence.",
    observations:
      "Each human records accept, reject, or abstain for every exact expected-observation instance.",
    questions:
      "Each human records useful, not-useful, or abstain for every exact keyed and digested rendered-question instance.",
    acceptance:
      "Missing, duplicate, abstained, stale, foreign, or unresolved decisions cannot pass acceptance.",
  },
  submissionTemplates,
});

const SOURCE_HEAD = "b149e4695a690c07908b12b912e5175b21281061";
const BUNDLE_SHA256 =
  "dbe6d00c8e5e15964978b3ccc8295687135471e1150c745841b1e26f4d9e51b6";
const PENDING_AGGREGATE_DIGEST =
  "5d1de45b2826127a8ec903b2a56ad556cb1cd94300d0e5b09a63756c0e0c1b36";
const ACCEPTED_AGGREGATE_DIGEST =
  "c2914ffc2b8be8d049e1987326607e87d6f79311da37e8d765a5a1ae514ab677";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

interface ReviewSubmission {
  schemaVersion: "writing-coach-review-submission-v1";
  submissionStatus: "submittable";
  sourceHead: typeof SOURCE_HEAD;
  bundleSha256: typeof BUNDLE_SHA256;
  aggregateDigest: typeof PENDING_AGGREGATE_DIGEST;
  assignment: ReviewerAssignment;
  decisions: ReviewDecision[];
  observationDecisions: ObservationReviewDecision[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSubmission(
  value: unknown,
  expectedSlot: 1 | 2,
  expectedReviewerId: "BR-01" | "BR-02",
): asserts value is ReviewSubmission {
  if (!isRecord(value)) {
    throw new Error("Invalid writing-coach review submission");
  }
  if (
    value.schemaVersion !== "writing-coach-review-submission-v1" ||
    value.submissionStatus !== "submittable" ||
    value.sourceHead !== SOURCE_HEAD || value.bundleSha256 !== BUNDLE_SHA256 ||
    value.aggregateDigest !== PENDING_AGGREGATE_DIGEST
  ) {
    throw new Error(
      `Stale writing-coach review submission: ${expectedReviewerId}`,
    );
  }
  const assignment = value.assignment;
  if (
    !isRecord(assignment) || assignment.slot !== expectedSlot ||
    assignment.role !== "independent-bilingual-reviewer" ||
    assignment.reviewerId !== expectedReviewerId ||
    assignment.bilingualAttestation !== true ||
    assignment.independenceAttestation !== true
  ) throw new Error(`Invalid reviewer assignment: ${expectedReviewerId}`);
  if (!Array.isArray(value.decisions) || value.decisions.length !== 192) {
    throw new Error(`Incomplete question decisions: ${expectedReviewerId}`);
  }
  for (const decision of value.decisions) {
    if (
      !isRecord(decision) || decision.reviewerId !== expectedReviewerId ||
      !SHA256_PATTERN.test(String(decision.digest)) ||
      !["useful", "not-useful", "abstain"].includes(
        String(decision.decision),
      ) ||
      !isRecord(decision.key) ||
      decision.key.corpusVersion !== "coach-corpus-v1" ||
      typeof decision.key.fixtureId !== "string" ||
      typeof decision.key.issueKey !== "string" ||
      decision.key.catalogVersion !== "coach-render-catalog-v1" ||
      !["en", "es"].includes(String(decision.key.uiLocale))
    ) throw new Error(`Invalid question decision: ${expectedReviewerId}`);
  }
  if (
    !Array.isArray(value.observationDecisions) ||
    value.observationDecisions.length !== 96
  ) throw new Error(`Incomplete observation decisions: ${expectedReviewerId}`);
  for (const decision of value.observationDecisions) {
    if (
      !isRecord(decision) || decision.reviewerId !== expectedReviewerId ||
      typeof decision.fixtureId !== "string" ||
      typeof decision.expectedId !== "string" ||
      !SHA256_PATTERN.test(String(decision.inputDigest)) ||
      !["accept", "reject", "abstain"].includes(String(decision.decision))
    ) throw new Error(`Invalid observation decision: ${expectedReviewerId}`);
  }
}

assertSubmission(br01Submission, 1, "BR-01");
assertSubmission(br02Submission, 2, "BR-02");
const submissions = deepFreeze([br01Submission, br02Submission]);

export const ACCEPTED_REVIEW_EVIDENCE = deepFreeze({
  sourceHead: SOURCE_HEAD,
  bundleSha256: BUNDLE_SHA256,
  pendingAggregateDigest: PENDING_AGGREGATE_DIGEST,
  submissionSha256: {
    "BR-01": "2cac67c88d6e3896c4e6d3b5718d98b79a7f7098a3f2a368f0ac069ab236bd47",
    "BR-02": "55ebb21bd586e884493ef7a14fbdc82b9d2a123573e036b28dd5b7f57e99e17a",
  },
  assignments: submissions.map((submission) => submission.assignment),
  decisions: submissions.flatMap((submission) => submission.decisions),
  observationDecisions: submissions.flatMap((submission) =>
    submission.observationDecisions
  ),
});

export const ACCEPTED_AGGREGATE_SNAPSHOT = deepFreeze(evaluateCorpus(
  ACCEPTED_REVIEW_EVIDENCE.assignments,
  ACCEPTED_REVIEW_EVIDENCE.decisions,
  ACCEPTED_REVIEW_EVIDENCE.observationDecisions,
));

if (
  ACCEPTED_AGGREGATE_SNAPSHOT.status !== "passed" ||
  ACCEPTED_AGGREGATE_SNAPSHOT.digest !== ACCEPTED_AGGREGATE_DIGEST ||
  ACCEPTED_AGGREGATE_SNAPSHOT.gates.some((gate) => gate.state !== "passed")
) throw new Error("Accepted writing-coach review evidence failed evaluation");

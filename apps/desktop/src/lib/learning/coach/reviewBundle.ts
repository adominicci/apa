import { createReviewRequirements, evaluateCorpus } from "./evaluate.ts";
import {
  COACH_CORPUS_VERSION,
  COACH_RENDER_CATALOG_VERSION,
  REVIEWER_SLOTS,
} from "./fixtures.ts";

export const PENDING_AGGREGATE_SNAPSHOT = Object.freeze(evaluateCorpus());
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

export const REVIEW_HANDOFF_BUNDLE = Object.freeze({
  schemaVersion: "writing-coach-review-handoff-v1" as const,
  corpusVersion: COACH_CORPUS_VERSION,
  catalogVersion: COACH_RENDER_CATALOG_VERSION,
  aggregateDigest: PENDING_AGGREGATE_SNAPSHOT.digest,
  reviewerSlots: REVIEWER_SLOTS,
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

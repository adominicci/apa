import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { DocLocale } from "@tesina/engine";
import {
  COACH_CORPUS,
  COACH_CORPUS_VERSION,
  COACH_RENDER_CATALOG_VERSION,
  renderCoachMessage,
} from "./fixtures/index.ts";
import { analyzeWriting } from "./rules.ts";
import type { WritingCoachIssue } from "./types.ts";

const LANGUAGES = ["en", "es"] as const;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return "{" +
    Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",") + "}";
}

export function canonicalSort<T>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => {
    const leftKey = canonicalJson(left);
    const rightKey = canonicalJson(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

const digest = (value: string): string =>
  bytesToHex(sha256(new TextEncoder().encode(value)));

export const digestCanonicalValue = (value: unknown): string =>
  digest(canonicalJson(value));

export interface ReviewInstanceKey {
  corpusVersion: typeof COACH_CORPUS_VERSION;
  fixtureId: string;
  issueKey: string;
  catalogVersion: typeof COACH_RENDER_CATALOG_VERSION;
  uiLocale: DocLocale;
}

export function createReviewInstance(
  fixtureId: string,
  issue: WritingCoachIssue,
  outputIndex: number,
  uiLocale: DocLocale,
  renderer: typeof renderCoachMessage = renderCoachMessage,
) {
  const params = canonicalJson(issue.learningQuestion.params);
  const issueKey = [
    outputIndex,
    issue.from,
    issue.to,
    issue.category,
    issue.learningQuestion.id,
    params,
  ].join("\0");
  const renderedQuestion = renderer(issue.learningQuestion, uiLocale);
  const key: ReviewInstanceKey = {
    corpusVersion: COACH_CORPUS_VERSION,
    fixtureId,
    issueKey,
    catalogVersion: COACH_RENDER_CATALOG_VERSION,
    uiLocale,
  };
  return {
    key,
    questionId: issue.learningQuestion.id,
    parameters: issue.learningQuestion.params,
    renderedQuestion,
    digest: digest(
      [
        COACH_RENDER_CATALOG_VERSION,
        uiLocale,
        issue.learningQuestion.id,
        params,
        renderedQuestion,
      ].join("\0"),
    ),
  };
}

export interface ReviewerAssignment {
  slot: 1 | 2;
  role: "independent-bilingual-reviewer";
  reviewerId: string;
  bilingualAttestation: boolean;
  independenceAttestation: boolean;
}
export interface ReviewDecision {
  reviewerId: string;
  key: ReviewInstanceKey;
  digest: string;
  decision: "useful" | "not-useful" | "abstain";
}
export interface ObservationReviewDecision {
  reviewerId: string;
  fixtureId: string;
  expectedId: string;
  inputDigest: string;
  decision: "accept" | "reject" | "abstain";
}

export function isDualUseful(
  instance: ReturnType<typeof createReviewInstance>,
  assignments: readonly ReviewerAssignment[],
  decisions: readonly ReviewDecision[],
): boolean {
  return assignments.length === 2 &&
    assignments.every((assignment) =>
      decisions.some((decision) =>
        decision.reviewerId === assignment.reviewerId &&
        canonicalJson(decision.key) === canonicalJson(instance.key) &&
        decision.digest === instance.digest && decision.decision === "useful"
      )
    );
}

export function createReviewRequirements(
  renderer: typeof renderCoachMessage = renderCoachMessage,
) {
  const observations = COACH_CORPUS.flatMap((fixture) =>
    fixture.proposedObservations.map((observation) => ({
      corpusVersion: COACH_CORPUS_VERSION,
      fixtureId: fixture.id,
      expectedId: observation.id,
      documentLanguage: fixture.documentLanguage,
      category: observation.category,
      from: observation.from,
      to: observation.to,
      inputDigest: digest([
        COACH_CORPUS_VERSION,
        fixture.id,
        observation.id,
        fixture.documentLanguage,
        observation.category,
        observation.from,
        observation.to,
        fixture.text,
      ].join("\0")),
    }))
  );
  const questions = COACH_CORPUS.flatMap((fixture) =>
    analyzeWriting({
      text: fixture.text,
      documentLanguage: fixture.documentLanguage,
      documentStart: 0,
      protectedSpans: [],
    }).flatMap((issue, index) =>
      LANGUAGES.map((uiLocale) =>
        createReviewInstance(fixture.id, issue, index, uiLocale, renderer)
      )
    )
  );
  return { observations, questions };
}

export function validateReviewState(
  assignments: readonly ReviewerAssignment[],
  decisions: readonly ReviewDecision[],
  observationDecisions: readonly ObservationReviewDecision[] = [],
  renderer: typeof renderCoachMessage = renderCoachMessage,
): "pending" | "failed" | "complete" {
  const canonicalAssignments = canonicalSort(assignments);
  const canonicalDecisions = canonicalSort(decisions);
  const canonicalObservationDecisions = canonicalSort(observationDecisions);
  if (
    canonicalAssignments.some((assignment) =>
      (assignment.slot !== 1 && assignment.slot !== 2) ||
      assignment.role !== "independent-bilingual-reviewer" ||
      assignment.reviewerId.length === 0 ||
      assignment.bilingualAttestation === false ||
      assignment.independenceAttestation === false
    )
  ) return "failed";
  if (
    canonicalAssignments.length < 2 ||
    canonicalAssignments.some((assignment) =>
      assignment.bilingualAttestation !== true ||
      assignment.independenceAttestation !== true
    )
  ) return "pending";
  const ids = canonicalAssignments.map((assignment) => assignment.reviewerId);
  const slots = new Set(
    canonicalAssignments.map((assignment) => assignment.slot),
  );
  if (
    canonicalAssignments.length !== 2 || new Set(ids).size !== 2 ||
    slots.size !== 2 || !slots.has(1) || !slots.has(2) ||
    ids.some((id) => id.length === 0)
  ) return "failed";
  const requirements = createReviewRequirements(renderer);
  const requiredQuestions = new Map(
    requirements.questions.map((instance) => [
      canonicalJson(instance.key),
      instance.digest,
    ]),
  );
  const requiredObservations = new Map(
    requirements.observations.map((item) => [
      `${item.fixtureId}\0${item.expectedId}`,
      item.inputDigest,
    ]),
  );
  const seenQuestions = new Set<string>();
  for (const decision of canonicalDecisions) {
    const key = canonicalJson(decision.key);
    const decisionKey = `${decision.reviewerId}\0${key}`;
    if (
      decision.decision === "abstain" || !ids.includes(decision.reviewerId) ||
      !requiredQuestions.has(key) ||
      requiredQuestions.get(key) !== decision.digest ||
      seenQuestions.has(decisionKey)
    ) return "failed";
    seenQuestions.add(decisionKey);
  }
  const seenObservations = new Map<
    string,
    ObservationReviewDecision["decision"]
  >();
  for (const decision of canonicalObservationDecisions) {
    const key = `${decision.fixtureId}\0${decision.expectedId}`;
    const decisionKey = `${decision.reviewerId}\0${key}`;
    if (
      decision.decision === "abstain" || !ids.includes(decision.reviewerId) ||
      !requiredObservations.has(key) ||
      requiredObservations.get(key) !== decision.inputDigest ||
      seenObservations.has(decisionKey)
    ) return "failed";
    seenObservations.set(decisionKey, decision.decision);
  }
  for (const key of requiredObservations.keys()) {
    const first = seenObservations.get(`${ids[0]}\0${key}`);
    const second = seenObservations.get(`${ids[1]}\0${key}`);
    if (first && second && first !== second) return "failed";
  }
  const questionsComplete = requirements.questions.every((instance) =>
    ids.every((id) =>
      seenQuestions.has(`${id}\0${canonicalJson(instance.key)}`)
    )
  );
  const observationsComplete = requirements.observations.every((item) =>
    ids.every((id) =>
      seenObservations.has(`${id}\0${item.fixtureId}\0${item.expectedId}`)
    )
  );
  return questionsComplete && observationsComplete ? "complete" : "pending";
}

export function dualAcceptedObservationKeys(
  assignments: readonly ReviewerAssignment[],
  decisions: readonly ObservationReviewDecision[],
  requirements: ReturnType<typeof createReviewRequirements>,
): Set<string> {
  return new Set(
    requirements.observations.filter((item) =>
      assignments.every((assignment) =>
        decisions.some((decision) =>
          decision.reviewerId === assignment.reviewerId &&
          decision.fixtureId === item.fixtureId &&
          decision.expectedId === item.expectedId &&
          decision.inputDigest === item.inputDigest &&
          decision.decision === "accept"
        )
      )
    ).map((item) => `${item.fixtureId}\0${item.expectedId}`),
  );
}

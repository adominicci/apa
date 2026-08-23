import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { DocLocale } from "@tesina/engine";
import {
  COACH_CORPUS,
  COACH_CORPUS_VERSION,
  COACH_RENDER_CATALOG_VERSION,
  type ProposedObservation,
  renderCoachMessage,
} from "./fixtures.ts";
import { analyzeWriting } from "./rules.ts";
import {
  COACH_CATEGORIES,
  type CoachCategory,
  type WritingCoachIssue,
} from "./types.ts";

const LANGUAGES = ["en", "es"] as const;
const COHORTS = [
  "ai-assisted",
  "competent",
  "second-language",
  "weak",
] as const;
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

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${
    Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")
  }}`;
}

const digest = (value: string): string =>
  bytesToHex(sha256(new TextEncoder().encode(value)));

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
  const renderedQuestion = renderCoachMessage(issue.learningQuestion, uiLocale);
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
  decision: "accept" | "reject" | "abstain";
}

export function createReviewRequirements() {
  const observations = COACH_CORPUS.flatMap((fixture) =>
    fixture.proposedObservations.map((observation) => ({
      fixtureId: fixture.id,
      expectedId: observation.id,
    }))
  );
  const questions = COACH_CORPUS.flatMap((fixture) =>
    analyzeWriting({
      text: fixture.text,
      documentLanguage: fixture.documentLanguage,
      documentStart: 0,
      protectedSpans: [],
    })
      .flatMap((issue, index) =>
        LANGUAGES.map((uiLocale) =>
          createReviewInstance(fixture.id, issue, index, uiLocale)
        )
      )
  );
  return { observations, questions };
}

export function validateReviewState(
  assignments: readonly ReviewerAssignment[],
  decisions: readonly ReviewDecision[],
  observationDecisions: readonly ObservationReviewDecision[] = [],
): "pending" | "failed" | "complete" {
  if (assignments.length < 2) return "pending";
  const ids = assignments.map((assignment) => assignment.reviewerId);
  if (
    assignments.length !== 2 || new Set(ids).size !== 2 ||
    ids.some((id) => id.length === 0) ||
    assignments.some((assignment) =>
      !assignment.bilingualAttestation || !assignment.independenceAttestation
    )
  ) return "failed";
  const requirements = createReviewRequirements();
  const requiredQuestions = new Map(
    requirements.questions.map((
      instance,
    ) => [canonicalJson(instance.key), instance.digest]),
  );
  const requiredObservations = new Set(
    requirements.observations.map((item) =>
      `${item.fixtureId}\0${item.expectedId}`
    ),
  );
  const seenQuestions = new Set<string>();
  for (const decision of decisions) {
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
  for (const decision of observationDecisions) {
    const key = `${decision.fixtureId}\0${decision.expectedId}`;
    const decisionKey = `${decision.reviewerId}\0${key}`;
    if (
      decision.decision === "abstain" || !ids.includes(decision.reviewerId) ||
      !requiredObservations.has(key) || seenObservations.has(decisionKey)
    ) return "failed";
    seenObservations.set(decisionKey, decision.decision);
  }
  for (const key of requiredObservations) {
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

interface CellCounts {
  emitted: number;
  expected: number;
  matched: number;
  exact: number;
  unmatched: number;
}
const emptyCounts = (): CellCounts => ({
  emitted: 0,
  expected: 0,
  matched: 0,
  exact: 0,
  unmatched: 0,
});
const sumCounts = (values: readonly CellCounts[]): CellCounts =>
  values.reduce((sum, value) => ({
    emitted: sum.emitted + value.emitted,
    expected: sum.expected + value.expected,
    matched: sum.matched + value.matched,
    exact: sum.exact + value.exact,
    unmatched: sum.unmatched + value.unmatched,
  }), emptyCounts());

export function evaluateCorpus(
  assignments: readonly ReviewerAssignment[] = [],
  decisions: readonly ReviewDecision[] = [],
  observationDecisions: readonly ObservationReviewDecision[] = [],
) {
  const fixtureResults = COACH_CORPUS.map((fixture) => {
    const issues = analyzeWriting({
      text: fixture.text,
      documentLanguage: fixture.documentLanguage,
      documentStart: 0,
      protectedSpans: [],
    });
    const matching = matchIssues(issues, fixture.proposedObservations);
    const instances = issues.flatMap((item, index) =>
      LANGUAGES.map((uiLocale) =>
        createReviewInstance(fixture.id, item, index, uiLocale)
      )
    );
    return { fixture, issues, matching, instances };
  });
  const countsFor = (
    predicate: (
      result: typeof fixtureResults[number],
      issue?: WritingCoachIssue,
    ) => boolean,
  ): CellCounts => {
    const selected = fixtureResults.filter((result) => predicate(result));
    const emitted = selected.flatMap((result) =>
      result.issues.filter((item) => predicate(result, item))
    );
    const expected = selected.flatMap((result) =>
      result.fixture.proposedObservations.filter((item) =>
        predicate(result, item as unknown as WritingCoachIssue)
      )
    );
    const matched = selected.flatMap((result) =>
      result.matching.matches.filter((match) => {
        const item = result.issues[match.emittedIndex];
        return item && predicate(result, item);
      })
    );
    return {
      emitted: emitted.length,
      expected: expected.length,
      matched: matched.length,
      exact: matched.filter((match) => match.exactSpan).length,
      unmatched: emitted.length - matched.length,
    };
  };
  const cell = (
    documentLanguage?: DocLocale,
    category?: CoachCategory,
    cohort?: typeof COHORTS[number],
  ) =>
    countsFor((result, issueValue) =>
      (!documentLanguage ||
        result.fixture.documentLanguage === documentLanguage) &&
      (!cohort || result.fixture.cohort === cohort) &&
      (!category || !issueValue || issueValue.category === category)
    );
  const global = sumCounts([cell("en"), cell("es")]);
  const reviewState = validateReviewState(
    assignments,
    decisions,
    observationDecisions,
  );
  const requirements = createReviewRequirements();
  const usefulCount =
    requirements.questions.filter((instance) =>
      assignments.length === 2 &&
      assignments.every((assignment) =>
        decisions.some((decision) =>
          decision.reviewerId === assignment.reviewerId &&
          canonicalJson(decision.key) === canonicalJson(instance.key) &&
          decision.digest === instance.digest && decision.decision === "useful"
        )
      )
    ).length;
  const metrics = {
    precision: basisPointRate(global.matched, global.emitted),
    exactSpan: basisPointRate(global.exact, global.matched),
    coverage: basisPointRate(global.matched, global.expected),
    usefulness: reviewState === "complete"
      ? basisPointRate(usefulCount, requirements.questions.length)
      : basisPointRate(0, 0, reviewState === "pending"),
  };
  const byDocumentLanguage = LANGUAGES.map((documentLanguage) => ({
    documentLanguage,
    counts: cell(documentLanguage),
  }));
  const byCategory = COACH_CATEGORIES.map((category) => ({
    category,
    counts: cell(undefined, category),
  }));
  const byCohort = COHORTS.map((cohort) => ({
    cohort,
    counts: cell(undefined, undefined, cohort),
  }));
  const byLanguageCategory = LANGUAGES.flatMap((documentLanguage) =>
    COACH_CATEGORIES.map((category) => ({
      documentLanguage,
      category,
      counts: cell(documentLanguage, category),
    }))
  );
  const byLanguageCohort = LANGUAGES.flatMap((documentLanguage) =>
    COHORTS.map((cohort) => ({
      documentLanguage,
      cohort,
      counts: cell(documentLanguage, undefined, cohort),
    }))
  );
  const fixtureLanguage = new Map(
    COACH_CORPUS.map((fixture) => [fixture.id, fixture.documentLanguage]),
  );
  const byLanguageCategoryUiLocale = LANGUAGES.flatMap((documentLanguage) =>
    COACH_CATEGORIES.flatMap((category) =>
      LANGUAGES.map((uiLocale) => {
        const instances = requirements.questions.filter((instance) =>
          fixtureLanguage.get(instance.key.fixtureId) === documentLanguage &&
          instance.key.issueKey.split("\0")[3] === category &&
          instance.key.uiLocale === uiLocale
        );
        const useful = instances.filter((instance) =>
          assignments.length === 2 && assignments.every((assignment) =>
            decisions.some((decision) =>
              decision.reviewerId === assignment.reviewerId &&
              canonicalJson(decision.key) === canonicalJson(instance.key) &&
              decision.digest === instance.digest &&
              decision.decision === "useful"
            )
          )
        ).length;
        return {
          documentLanguage,
          category,
          uiLocale,
          usefulness: reviewState === "complete"
            ? basisPointRate(useful, instances.length)
            : basisPointRate(0, 0, reviewState === "pending"),
        };
      })
    )
  );
  const cellPrecision = byLanguageCategory.map(({ counts }) =>
    basisPointRate(counts.matched, counts.emitted)
  );
  const cellSpan = byLanguageCategory.map(({ counts }) =>
    basisPointRate(counts.exact, counts.matched)
  );
  const cellCoverage = byLanguageCategory.map(({ counts }) =>
    basisPointRate(counts.matched, counts.expected)
  );
  const falsePositiveRate = (
    documentLanguage: DocLocale,
    cohort: "competent" | "second-language",
  ) => {
    const results = fixtureResults.filter((result) =>
      result.fixture.documentLanguage === documentLanguage &&
      result.fixture.cohort === cohort
    );
    return basisPointRate(
      results.filter((result) => result.matching.unmatchedEmitted.length > 0)
        .length,
      results.length,
    );
  };
  const macro = {
    precision: macroRate(cellPrecision),
    exactSpan: macroRate(cellSpan),
    coverage: macroRate(cellCoverage),
    usefulness: reviewState === "complete"
      ? macroRate(
        byLanguageCategoryUiLocale.map((cellValue) => cellValue.usefulness),
      )
      : basisPointRate(0, 0, reviewState === "pending"),
  };
  const supported = byLanguageCategory.every(({ counts }) =>
    counts.expected >= 8 && counts.emitted >= 8
  );
  const reviewedSupport = reviewState === "complete" &&
    byLanguageCategory.every(({ documentLanguage, category }) => {
      const expectedIds = COACH_CORPUS.flatMap((fixture) =>
        fixture.documentLanguage === documentLanguage
          ? fixture.proposedObservations.filter((item) =>
            item.category === category
          ).map((item) => ({ fixtureId: fixture.id, expectedId: item.id }))
          : []
      );
      return expectedIds.filter((item) =>
        assignments.every((assignment) =>
          observationDecisions.some((decision) =>
            decision.reviewerId === assignment.reviewerId &&
            decision.fixtureId === item.fixtureId &&
            decision.expectedId === item.expectedId &&
            decision.decision === "accept"
          )
        )
      ).length >= 8;
    });
  const falsePositiveRates = LANGUAGES.flatMap((documentLanguage) => [
    {
      documentLanguage,
      cohort: "competent" as const,
      rate: falsePositiveRate(documentLanguage, "competent"),
    },
    {
      documentLanguage,
      cohort: "second-language" as const,
      rate: falsePositiveRate(documentLanguage, "second-language"),
    },
  ]);
  const gates = [
    {
      code: "supported-cells",
      state: supported ? "passed" : "failed",
      observed: supported,
      threshold: 8,
    },
    {
      code: "micro-precision",
      state: metrics.precision.basisPoints !== null &&
          metrics.precision.basisPoints >= 8500
        ? "passed"
        : "failed",
      observed: metrics.precision,
      threshold: 8500,
    },
    {
      code: "language-category-precision",
      state:
        cellPrecision.every((rate) =>
            rate.basisPoints !== null && rate.basisPoints >= 7500
          )
          ? "passed"
          : "failed",
      observed: cellPrecision,
      threshold: 7500,
    },
    {
      code: "micro-exact-span",
      state: metrics.exactSpan.basisPoints !== null &&
          metrics.exactSpan.basisPoints >= 9000
        ? "passed"
        : "failed",
      observed: metrics.exactSpan,
      threshold: 9000,
    },
    {
      code: "competent-false-positive-passages",
      state:
        falsePositiveRates.filter((item) => item.cohort === "competent").every((
            item,
          ) => item.rate.basisPoints !== null && item.rate.basisPoints <= 1000
          )
          ? "passed"
          : "failed",
      observed: falsePositiveRates.filter((item) =>
        item.cohort === "competent"
      ),
      threshold: 1000,
    },
    {
      code: "second-language-false-positive-passages",
      state:
        falsePositiveRates.filter((item) => item.cohort === "second-language")
            .every((item) =>
              item.rate.basisPoints !== null && item.rate.basisPoints <= 1000
            )
          ? "passed"
          : "failed",
      observed: falsePositiveRates.filter((item) =>
        item.cohort === "second-language"
      ),
      threshold: 1000,
    },
    {
      code: "dual-reviewed-support",
      state: reviewState === "pending"
        ? "pending-review"
        : reviewedSupport
        ? "passed"
        : "failed",
      observed: reviewedSupport,
      threshold: 8,
    },
    {
      code: "question-usefulness",
      state: reviewState === "pending"
        ? "pending-review"
        : metrics.usefulness.basisPoints !== null &&
            metrics.usefulness.basisPoints >= 8000
        ? "passed"
        : "failed",
      observed: metrics.usefulness,
      threshold: 8000,
    },
    {
      code: "human-review",
      state: reviewState === "pending"
        ? "pending-review"
        : reviewState === "failed"
        ? "failed"
        : "passed",
      observed: decisions.length,
      threshold: "complete-dual-review",
    },
  ];
  const status = gates.some((gate) => gate.state === "failed")
    ? "failed"
    : gates.some((gate) => gate.state === "pending-review")
    ? "pending-human-review"
    : "passed";
  const digestInput = {
    corpus: COACH_CORPUS,
    outputs: fixtureResults.map(({ fixture, issues }) => ({
      fixtureId: fixture.id,
      issues,
    })),
    catalogVersion: COACH_RENDER_CATALOG_VERSION,
    assignments,
    decisions,
    observationDecisions,
  };
  return {
    schemaVersion: "writing-coach-evaluation-v1" as const,
    coachVersion: 1,
    corpusVersion: COACH_CORPUS_VERSION,
    catalogVersion: COACH_RENDER_CATALOG_VERSION,
    digest: digest(canonicalJson(digestInput)),
    status,
    reviewerSlots: assignments,
    globalCounts: global,
    micro: metrics,
    macro,
    byDocumentLanguage,
    byCategory,
    byCohort,
    byLanguageCategory,
    byLanguageCohort,
    byLanguageCategoryUiLocale,
    falsePositiveRates,
    gates,
  };
}

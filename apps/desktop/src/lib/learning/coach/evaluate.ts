import type { DocLocale } from "@tesina/engine";
import {
  COACH_CORPUS,
  COACH_CORPUS_VERSION,
  COACH_RENDER_CATALOG_VERSION,
  renderCoachMessage,
  REVIEWER_SLOTS,
} from "./fixtures/index.ts";
import { analyzeWriting } from "./rules.ts";
import { COACH_CATEGORIES, type CoachCategory } from "./types.ts";
import { basisPointRate, macroRate, matchIssues } from "./evaluationMetrics.ts";
export { basisPointRate, macroRate, matchIssues } from "./evaluationMetrics.ts";
export type { MatchResult, Rate, RateState } from "./evaluationMetrics.ts";
import {
  canonicalSort,
  createReviewInstance,
  createReviewRequirements,
  digestCanonicalValue,
  dualAcceptedObservationKeys,
  isDualUseful,
  type ObservationReviewDecision,
  type ReviewDecision,
  type ReviewerAssignment,
  validateReviewState,
} from "./reviewValidation.ts";
export {
  canonicalJson,
  createReviewInstance,
  createReviewRequirements,
  validateReviewState,
} from "./reviewValidation.ts";
export type {
  ObservationReviewDecision,
  ReviewDecision,
  ReviewerAssignment,
  ReviewInstanceKey,
} from "./reviewValidation.ts";

const LANGUAGES = ["en", "es"] as const;
const COHORTS = [
  "ai-assisted",
  "competent",
  "second-language",
  "weak",
] as const;

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
  renderer: typeof renderCoachMessage = renderCoachMessage,
) {
  const canonicalAssignments = canonicalSort(assignments);
  const canonicalDecisions = canonicalSort(decisions);
  const canonicalObservationDecisions = canonicalSort(observationDecisions);
  const reviewState = validateReviewState(
    canonicalAssignments,
    canonicalDecisions,
    canonicalObservationDecisions,
    renderer,
  );
  const requirements = createReviewRequirements(renderer);
  const acceptedObservationKeys = reviewState === "complete"
    ? dualAcceptedObservationKeys(
      canonicalAssignments,
      canonicalObservationDecisions,
      requirements,
    )
    : null;
  const fixtureResults = COACH_CORPUS.map((fixture) => {
    const issues = analyzeWriting({
      text: fixture.text,
      documentLanguage: fixture.documentLanguage,
      documentStart: 0,
      protectedSpans: [],
    });
    const expectedObservations = acceptedObservationKeys === null
      ? fixture.proposedObservations
      : fixture.proposedObservations.filter((observation) =>
        acceptedObservationKeys.has(`${fixture.id}\0${observation.id}`)
      );
    const matching = matchIssues(issues, expectedObservations);
    const instances = issues.flatMap((item, index) =>
      LANGUAGES.map((uiLocale) =>
        createReviewInstance(fixture.id, item, index, uiLocale, renderer)
      )
    );
    return { fixture, expectedObservations, issues, matching, instances };
  });
  const countsFor = (
    predicate: (result: typeof fixtureResults[number]) => boolean,
    category?: CoachCategory,
  ): CellCounts => {
    const selected = fixtureResults.filter((result) => predicate(result));
    const emitted = selected.flatMap((result) =>
      result.issues.filter((item) => !category || item.category === category)
    );
    const expected = selected.flatMap((result) =>
      result.expectedObservations.filter((item) =>
        !category || item.category === category
      )
    );
    const matched = selected.flatMap((result) =>
      result.matching.matches.filter((match) => {
        const item = result.issues[match.emittedIndex];
        return item && (!category || item.category === category);
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
    countsFor((result) =>
      (!documentLanguage ||
        result.fixture.documentLanguage === documentLanguage) &&
      (!cohort || result.fixture.cohort === cohort), category);
  const global = sumCounts([cell("en"), cell("es")]);
  const usefulCount =
    requirements.questions.filter((instance) =>
      isDualUseful(instance, canonicalAssignments, canonicalDecisions)
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
          isDualUseful(instance, canonicalAssignments, canonicalDecisions)
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
    return {
      rate: basisPointRate(
        results.filter((result) => result.matching.unmatchedEmitted.length > 0)
          .length,
        results.length,
      ),
      unmatchedIssueCount: results.reduce(
        (sum, result) => sum + result.matching.unmatchedEmitted.length,
        0,
      ),
    };
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
  const supported = byLanguageCategory.every(({
    documentLanguage,
    category,
    counts,
  }) =>
    COACH_CORPUS.reduce(
        (count, fixture) =>
          count + (fixture.documentLanguage === documentLanguage
            ? fixture.proposedObservations.filter((item) =>
              item.category === category
            ).length
            : 0),
        0,
      ) >= 8 && counts.emitted >= 8
  );
  const reviewedSupport = reviewState === "complete" &&
    byLanguageCategory.every(({ counts }) => counts.expected >= 8);
  const falsePositiveRates = LANGUAGES.flatMap((documentLanguage) => [
    {
      documentLanguage,
      cohort: "competent" as const,
      ...falsePositiveRate(documentLanguage, "competent"),
    },
    {
      documentLanguage,
      cohort: "second-language" as const,
      ...falsePositiveRate(documentLanguage, "second-language"),
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
  const reviewerSlots = REVIEWER_SLOTS.map((slot) =>
    canonicalAssignments.find((assignment) => assignment.slot === slot.slot) ??
      slot
  );
  const digestInput = {
    corpus: COACH_CORPUS,
    outputs: fixtureResults.map(({ fixture, issues }) => ({
      fixtureId: fixture.id,
      issues,
    })),
    renderCatalog: requirements.questions,
    reviewerSlots,
    decisions: canonicalDecisions,
    observationDecisions: canonicalObservationDecisions,
  };
  return {
    schemaVersion: "writing-coach-evaluation-v1" as const,
    coachVersion: 1,
    corpusVersion: COACH_CORPUS_VERSION,
    catalogVersion: COACH_RENDER_CATALOG_VERSION,
    digest: digestCanonicalValue(digestInput),
    status,
    reviewerSlots,
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

import { COACH_CATEGORIES } from "./types.ts";

const LANGUAGES = ["en", "es"] as const;
const UI_LOCALES = ["en", "es"] as const;

export const REVIEW_CONTRACT = Object.freeze(
  {
    categories: COACH_CATEGORIES,
    rendering: {
      localeAuthority: "ui-locale",
      explanation: { sentences: 1, maxUtf16: 180 },
      learningQuestion: { sentences: 1, interrogative: true, maxUtf16: 180 },
    },
    thresholds: {
      fragmentMinimumTokens: 8,
      clarityEnglishTokensAbove: 45,
      claritySpanishTokensAbove: 50,
      clarityClauseCuesAtLeast: 3,
      repeatedPhraseTokensAtLeast: 4,
      repeatedOpeningTokens: 3,
      repeatedOpeningSentences: 3,
    },
    protection: "discard-any-nonempty-intersection-before-deduplication",
    overlap: "exact-collapse-then-shortest-span-ranking-within-category",
    order: "from-to-category-rule-id",
    matching:
      "exact-span-intersection-boundary-distance-emitted-order-expected-id",
    formulas: {
      precision: "matched-emissions/all-emissions",
      exactSpan: "exact-range-pairs/category-matched-emissions",
      coverage: "matched-expectations/all-expectations",
      falsePositivePassages:
        "passages-with-unmatched-emission/all-cohort-passages",
      usefulness: "dual-useful/required-rendered-instances",
      micro: "sum-numerators/sum-denominators",
      macro: "unweighted-required-cell-rates",
    },
    rounding: "integer-half-up-basis-points",
    aggregateSchema: "writing-coach-evaluation-v1",
    requiredLanguageCategoryCells: LANGUAGES.flatMap((documentLanguage) =>
      COACH_CATEGORIES.map((category) => ({ documentLanguage, category }))
    ),
    requiredQuestionCells: LANGUAGES.flatMap((documentLanguage) =>
      COACH_CATEGORIES.flatMap((category) =>
        UI_LOCALES.map((uiLocale) => ({ documentLanguage, category, uiLocale }))
      )
    ),
  } as const,
);

export const CORPUS_PROVENANCE_POLICY = Object.freeze(
  {
    accepted: [
      "project-authored-mit",
      "compatible-spdx-with-source-and-attribution",
    ],
    excluded: [
      "student-submission",
      "personal-data",
      "apa-manual-text",
      "unresolved-model-output-rights",
    ],
    deIdentificationRequired: true,
  } as const,
);

export const CORPUS_PROVENANCE_LEDGER = Object.freeze(
  [
    {
      id: "tesina-lt03-synthetic-v1",
      origin: "Project-authored synthetic LT-03 evaluation prose",
      license: "MIT",
      sourceUrl: null,
      attribution: "Tesina contributors",
      deIdentified: true,
      containsStudentSubmission: false,
      containsPersonalData: false,
      containsApaManualText: false,
      containsUnresolvedModelOutput: false,
    },
  ] as const,
);

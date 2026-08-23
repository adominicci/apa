import { describe, expect, it } from "vitest";
import {
  CORPUS_PROVENANCE_LEDGER,
  CORPUS_PROVENANCE_POLICY,
  REVIEW_CONTRACT,
} from "./reviewMetadata.ts";
import {
  COACH_CORPUS,
  renderCoachMessage,
  REVIEWER_SLOTS,
} from "./fixtures.ts";
import { COACH_CATEGORIES } from "./types.ts";

describe("coach review inputs", () => {
  it("freezes the approved rubric, algorithms, formulas, and cells as test-readable data", () => {
    expect(REVIEW_CONTRACT.categories).toEqual([
      "specificity",
      "evidence",
      "clarity",
      "economy",
      "repetition",
      "voice",
    ]);
    expect(REVIEW_CONTRACT.thresholds).toEqual({
      fragmentMinimumTokens: 8,
      clarityEnglishTokensAbove: 45,
      claritySpanishTokensAbove: 50,
      clarityClauseCuesAtLeast: 3,
      repeatedPhraseTokensAtLeast: 4,
      repeatedOpeningTokens: 3,
      repeatedOpeningSentences: 3,
    });
    expect(REVIEW_CONTRACT.aggregateSchema).toBe("writing-coach-evaluation-v1");
    expect(REVIEW_CONTRACT.rounding).toBe("integer-half-up-basis-points");
    expect(REVIEW_CONTRACT.requiredLanguageCategoryCells).toHaveLength(12);
    expect(REVIEW_CONTRACT.requiredQuestionCells).toHaveLength(24);
    expect(REVIEW_CONTRACT.rendering).toEqual({
      localeAuthority: "ui-locale",
      explanation: { sentences: 1, maxUtf16: 180 },
      learningQuestion: { sentences: 1, interrogative: true, maxUtf16: 180 },
    });
  });

  it("admits only redistributable, de-identified fixture sources", () => {
    expect(CORPUS_PROVENANCE_POLICY).toEqual({
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
    });
    expect(CORPUS_PROVENANCE_LEDGER).toEqual([expect.objectContaining({
      license: "MIT",
      deIdentified: true,
      containsStudentSubmission: false,
      containsPersonalData: false,
      containsApaManualText: false,
      containsUnresolvedModelOutput: false,
    })]);
  });
});

describe("proposed bilingual corpus", () => {
  it("contains eight fixtures in every language and review-only cohort cell", () => {
    for (const language of ["en", "es"] as const) {
      for (
        const cohort of [
          "weak",
          "competent",
          "ai-assisted",
          "second-language",
        ] as const
      ) {
        expect(
          COACH_CORPUS.filter((fixture) =>
            fixture.documentLanguage === language && fixture.cohort === cohort
          ),
        ).toHaveLength(8);
        expect(
          new Set(
            COACH_CORPUS.filter((fixture) =>
              fixture.documentLanguage === language && fixture.cohort === cohort
            ).map((fixture) => fixture.text),
          ).size,
        ).toBe(8);
      }
    }
    expect(new Set(COACH_CORPUS.map((fixture) => fixture.id)).size).toBe(
      COACH_CORPUS.length,
    );
  });

  it("contains eight proposed exact positives per language and category with auditable provenance", () => {
    for (const language of ["en", "es"] as const) {
      for (const category of COACH_CATEGORIES) {
        const observations = COACH_CORPUS.flatMap((fixture) =>
          fixture.documentLanguage === language
            ? fixture.proposedObservations
            : []
        ).filter((observation) => observation.category === category);
        expect(observations).toHaveLength(8);
        expect(
          observations.every(({ from, to }) =>
            Number.isInteger(from) && from < to
          ),
        ).toBe(true);
      }
    }
    expect(
      COACH_CORPUS.every((fixture) =>
        fixture.origin === "tesina-lt03-synthetic-v1" &&
        fixture.license === "MIT" &&
        fixture.deIdentified &&
        (fixture.expectedClean || fixture.proposedObservations.length > 0)
      ),
    ).toBe(true);
  });

  it("defines exactly two unassigned human reviewer slots", () => {
    expect(REVIEWER_SLOTS).toEqual([
      {
        slot: 1,
        role: "independent-bilingual-reviewer",
        reviewerId: null,
        bilingualAttestation: null,
        independenceAttestation: null,
      },
      {
        slot: 2,
        role: "independent-bilingual-reviewer",
        reviewerId: null,
        bilingualAttestation: null,
        independenceAttestation: null,
      },
    ]);
  });

  it("renders every descriptor naturally in each evaluation UI locale", () => {
    for (const category of COACH_CATEGORIES) {
      for (const uiLocale of ["en", "es"] as const) {
        const explanation = renderCoachMessage({
          id: `coach.${category}.explanation`,
          params: { observedText: "sample" },
        }, uiLocale);
        const question = renderCoachMessage({
          id: `coach.${category}.question`,
          params: { observedText: "sample" },
        }, uiLocale);
        expect(explanation.length).toBeLessThanOrEqual(180);
        expect(explanation.match(/[.!?]/gu)).toHaveLength(1);
        expect(question.length).toBeLessThanOrEqual(180);
        expect(question.endsWith("?")).toBe(true);
        expect(question.match(/[?]/gu)).toHaveLength(1);
      }
    }
  });
});

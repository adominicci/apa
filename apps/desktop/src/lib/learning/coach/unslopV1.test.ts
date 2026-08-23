import { describe, expect, it } from "vitest";
import {
  auditUnslopV1,
  correctionEligibility,
  UNSLOP_POLICY_VERSION,
} from "./unslopV1.ts";

describe("immutable unslopV1 audit", () => {
  it("requires the exact policy and explicit generated-content language", () => {
    expect(UNSLOP_POLICY_VERSION).toBe("unslopV1");
    expect(() =>
      auditUnslopV1({
        text: "Generated feedback.",
        contentLanguage: "fr" as "en",
      })
    )
      .toThrowError("unsupported-content-language");
  });

  it.each(
    [
      [
        "en",
        "It is important to note that the result changed.",
        "canned-framing",
        "It is important to note that",
      ],
      [
        "en",
        "## A Comprehensive Exploration of the Result",
        "heading-inflation",
        "A Comprehensive Exploration of",
      ],
      [
        "en",
        "In my experience, the result changed.",
        "experiential-claim",
        "In my experience",
      ],
      [
        "en",
        "The result is super cool for readers.",
        "reviewed-slang",
        "super cool",
      ],
      [
        "en",
        "The result could of changed earlier.",
        "nonstandard-language",
        "could of",
      ],
      [
        "es",
        "Cabe señalar que el resultado cambió.",
        "canned-framing",
        "Cabe señalar que",
      ],
      [
        "es",
        "## Una exploración integral del resultado",
        "heading-inflation",
        "Una exploración integral",
      ],
      [
        "es",
        "En mi experiencia, el resultado cambió.",
        "experiential-claim",
        "En mi experiencia",
      ],
      [
        "es",
        "El resultado quedó súper chévere.",
        "reviewed-slang",
        "súper chévere",
      ],
      [
        "es",
        "Habían muchas razones en el informe.",
        "nonstandard-language",
        "Habían muchas",
      ],
    ] as const,
  )(
    "returns the exact %s observable match",
    (contentLanguage, text, code, observed) => {
      expect(auditUnslopV1({ text: `😀 ${text}`, contentLanguage }).violations)
        .toContainEqual({
          code,
          from: 3 + text.indexOf(observed),
          to: 3 + text.indexOf(observed) + observed.length,
          observedText: observed,
        });
    },
  );

  it("finds exact adjacent repetition in deterministic range order", () => {
    const text = "The result changed. The result changed.";
    expect(auditUnslopV1({ text, contentLanguage: "en" }).violations)
      .toContainEqual({
        code: "adjacent-repetition",
        from: 20,
        to: 39,
        observedText: "The result changed.",
      });
  });

  it.each(
    [
      ["The result changed after the measured intervention.", "en"],
      ["El resultado cambió después de la intervención medida.", "es"],
    ] as const,
  )("leaves competent generated text unchanged", (text, contentLanguage) => {
    expect(auditUnslopV1({ text, contentLanguage })).toEqual({
      policyVersion: "unslopV1",
      violations: [],
    });
  });
});

describe("bounded correction eligibility", () => {
  it("discards initial schema or grounding failures without style correction", () => {
    expect(
      correctionEligibility({
        phase: "initial",
        schemaValid: false,
        grounded: true,
        styleCompliant: false,
      }),
    )
      .toEqual({ disposition: "discard", styleAttemptsAuthorized: 0 });
    expect(
      correctionEligibility({
        phase: "initial",
        schemaValid: true,
        grounded: false,
        styleCompliant: false,
      }),
    )
      .toEqual({ disposition: "discard", styleAttemptsAuthorized: 0 });
  });

  it("authorizes one attempt only for an initially valid grounded style failure", () => {
    expect(
      correctionEligibility({
        phase: "initial",
        schemaValid: true,
        grounded: true,
        styleCompliant: false,
      }),
    )
      .toEqual({
        disposition: "eligible-style-correction",
        styleAttemptsAuthorized: 1,
      });
    expect(
      correctionEligibility({
        phase: "initial",
        schemaValid: true,
        grounded: true,
        styleCompliant: true,
      }),
    )
      .toEqual({ disposition: "accept", styleAttemptsAuthorized: 0 });
  });

  it("reruns every validation after correction and never authorizes a second attempt", () => {
    expect(
      correctionEligibility({
        phase: "corrected",
        schemaValid: true,
        grounded: true,
        styleCompliant: true,
      }),
    )
      .toEqual({ disposition: "accept", styleAttemptsAuthorized: 0 });
    for (
      const state of [
        { schemaValid: false, grounded: true, styleCompliant: true },
        { schemaValid: true, grounded: false, styleCompliant: true },
        { schemaValid: true, grounded: true, styleCompliant: false },
      ]
    ) {
      expect(correctionEligibility({ phase: "corrected", ...state }))
        .toEqual({ disposition: "discard", styleAttemptsAuthorized: 0 });
    }
  });
});

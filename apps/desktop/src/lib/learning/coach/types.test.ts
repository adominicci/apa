import { describe, expect, expectTypeOf, it } from "vitest";
import type { DocLocale } from "@tesina/engine";
import {
  COACH_CATEGORIES,
  COACH_CONTRACT_VERSION,
  CoachInputError,
  type CoachMessageDescriptor,
  validateWritingCoachRequest,
  type WritingCoachIssue,
  type WritingCoachRequest,
} from "./types.ts";

describe("writing-coach public contract", () => {
  it("uses the canonical locale and exact closed issue shape", () => {
    expect(COACH_CONTRACT_VERSION).toBe(1);
    expect(COACH_CATEGORIES).toEqual([
      "specificity",
      "evidence",
      "clarity",
      "economy",
      "repetition",
      "voice",
    ]);
    expectTypeOf<WritingCoachRequest["documentLanguage"]>().toEqualTypeOf<
      DocLocale
    >();
    expectTypeOf<CoachMessageDescriptor<"coach.evidence.question">["params"]>()
      .toEqualTypeOf<{ observedText: string }>();
    expectTypeOf<WritingCoachIssue>().toMatchTypeOf<{
      observedText: string;
      source: "deterministic";
    }>();
  });

  it.each([
    [{
      text: "ok",
      documentLanguage: "en",
      documentStart: -1,
      protectedSpans: [],
    }, "invalid-document-start"],
    [{
      text: "ok",
      documentLanguage: "en",
      documentStart: 1.5,
      protectedSpans: [],
    }, "invalid-document-start"],
    [{
      text: "ok",
      documentLanguage: "fr",
      documentStart: 0,
      protectedSpans: [],
    }, "unsupported-document-language"],
    [{
      text: "ok",
      documentLanguage: "en",
      documentStart: Number.MAX_SAFE_INTEGER,
      protectedSpans: [],
    }, "unsafe-document-end"],
  ])("rejects invalid request %#", (request, code) => {
    expect(() => validateWritingCoachRequest(request)).toThrowError(
      expect.objectContaining({ name: "CoachInputError", code }),
    );
  });

  it("caps immutable snapshots at 65,536 UTF-16 code units", () => {
    const valid = validateWritingCoachRequest({
      text: "x".repeat(65_536),
      documentLanguage: "en",
      documentStart: 0,
      protectedSpans: [],
    });
    expect(valid.text.length).toBe(65_536);
    expect(() =>
      validateWritingCoachRequest({ ...valid, text: `${valid.text}x` })
    )
      .toThrowError(expect.objectContaining({ code: "text-too-long" }));
  });

  it.each([
    [{ from: 9, to: 11, kind: "citation" }, "protected-span-outside-snapshot"],
    [{ from: 10, to: 10, kind: "quotation" }, "invalid-protected-span"],
    [
      { from: 10, to: 13, kind: "source-title" },
      "protected-span-outside-snapshot",
    ],
    [
      { from: 11, to: 12, kind: "proper-name" },
      "protected-span-splits-surrogate",
    ],
  ])("rejects invalid protected span %#", (span, code) => {
    expect(() =>
      validateWritingCoachRequest({
        text: "😀",
        documentLanguage: "es",
        documentStart: 10,
        protectedSpans: [span],
      })
    ).toThrowError(expect.objectContaining({ code }));
  });

  it("returns one stable programmer-facing error class", () => {
    try {
      validateWritingCoachRequest(null);
    } catch (error) {
      expect(error).toBeInstanceOf(CoachInputError);
      expect((error as CoachInputError).code).toBe("invalid-request");
    }
  });
});

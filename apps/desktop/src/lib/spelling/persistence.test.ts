import { describe, expect, it } from "vitest";
import { createEmptyEssay } from "$lib/model/essay";
import { essaySemanticDigest } from "$lib/portable/semantic";
import {
  addDocumentIgnore,
  assertCanonicalEssaySpelling,
  effectiveDocumentIgnores,
  sanitizeEssaySpelling,
} from "./persistence.ts";

describe("essay spelling persistence", () => {
  it("keeps older essays field-free and sanitizes only malformed optional data", () => {
    const older = createEmptyEssay("en", "2026-08-22T00:00:00.000Z");
    expect(sanitizeEssaySpelling(older)).not.toHaveProperty("spelling");

    const malformed = {
      ...older,
      spelling: {
        documentIgnores: {
          en: [" first ", "FIRST", "two words", "second"],
          es: [" Cafe\u0301 ", "CAFÉ"],
        },
      },
    };
    const sanitized = sanitizeEssaySpelling(malformed);
    expect(sanitized.schemaVersion).toBe(2);
    expect(sanitized.spelling?.documentIgnores).toEqual({
      en: ["first", "second"],
      es: ["Café"],
    });
    expect(malformed.spelling.documentIgnores.en[0]).toBe(" first ");
  });

  it.each([null, "not-an-object", [], 42])(
    "sanitizes a malformed direct-load essay.spelling shape in memory: %j",
    (spelling) => {
      const essay = Object.assign(createEmptyEssay("en"), { spelling });
      expect(sanitizeEssaySpelling(essay as never).spelling).toEqual({
        documentIgnores: {},
      });
    },
  );

  it("applies trusted document mutations atomically and language-locally", () => {
    const essay = createEmptyEssay("es");
    expect(addDocumentIgnore(essay, " Cafe\u0301 ", "es").status).toBe("added");
    expect(addDocumentIgnore(essay, "CAFÉ", "es").status).toBe("duplicate");
    expect(addDocumentIgnore(essay, "two words", "es").status).toBe("invalid");
    expect(effectiveDocumentIgnores(essay, "es")).toEqual(["Café"]);
    expect(effectiveDocumentIgnores(essay, "en")).toEqual([]);
  });

  it("rejects malformed untrusted archive values instead of sanitizing", () => {
    const essay = createEmptyEssay("en");
    essay.spelling = { documentIgnores: { en: [" canonical "] } };
    expect(() => assertCanonicalEssaySpelling(essay)).toThrow(
      "documentIgnores.en",
    );
    essay.spelling.documentIgnores!.en = ["canonical"];
    expect(() => assertCanonicalEssaySpelling(essay)).not.toThrow();
  });

  it.each(["not-an-object", [], 42])(
    "rejects a non-object documentIgnores shape: %j",
    (documentIgnores) => {
      const essay = createEmptyEssay("en") as unknown as Record<
        string,
        unknown
      >;
      essay.spelling = { documentIgnores };
      expect(() => assertCanonicalEssaySpelling(essay as never)).toThrow(
        "documentIgnores",
      );
    },
  );

  it.each([
    { spelling: "not-an-object" },
    { spelling: [] },
    { spelling: 42 },
    { spelling: { documentIgnores: { en: "not-an-array" } } },
    { spelling: { documentIgnores: { en: {} } } },
    { spelling: { documentIgnores: { es: [42] } } },
  ])("rejects every malformed nested spelling shape: %j", (patch) => {
    const essay = Object.assign(createEmptyEssay("en"), patch);
    expect(() => assertCanonicalEssaySpelling(essay as never)).toThrow(
      "malformed essay.spelling",
    );
  });

  it("includes canonical document ignores in portable semantic identity", async () => {
    const plain = createEmptyEssay("en", "2026-08-22T00:00:00.000Z");
    const ignored = structuredClone(plain);
    ignored.spelling = { documentIgnores: { en: ["Tesina"] } };
    expect(await essaySemanticDigest(plain)).not.toBe(
      await essaySemanticDigest(ignored),
    );
  });
});

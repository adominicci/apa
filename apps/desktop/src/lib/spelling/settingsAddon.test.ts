import { describe, expect, it } from "vitest";
import * as ordinary from "$lib/editor/NoopSpellingSettings";
import * as proof from "$lib/spelling/ProofSpellingSettings";

describe("compile-time spelling settings seam", () => {
  it("omits spelling from ordinary settings serialization", () => {
    const state = ordinary.loadSpellingSettings({
      enabled: false,
      personalDictionaries: { en: ["word"] },
    });
    expect(ordinary.serializeSpellingSettings(state)).toBeUndefined();
  });

  it("serializes canonical spelling state only in the exact proof adapter", () => {
    const state = proof.loadSpellingSettings({
      enabled: false,
      personalDictionaries: { en: [" Word ", "WORD"] },
    });
    expect(proof.serializeSpellingSettings(state)).toEqual({
      enabled: false,
      personalDictionaries: { en: ["Word"] },
    });
  });
});

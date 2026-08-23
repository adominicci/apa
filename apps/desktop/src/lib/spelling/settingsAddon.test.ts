import { describe, expect, it } from "vitest";
import * as ordinary from "$lib/editor/NoopSpellingSettings";
import * as proof from "$lib/spelling/ProofSpellingSettings";

describe("compile-time spelling settings seam", () => {
  it("preserves loaded spelling inertly but creates none in ordinary settings", () => {
    const spelling = {
      enabled: false,
      personalDictionaries: { en: ["word"] },
    };
    const loaded = ordinary.loadSpellingSettings(spelling);
    expect(ordinary.serializeSpellingSettings(loaded)).toEqual(spelling);
    expect(
      ordinary.serializeSpellingSettings(
        ordinary.loadSpellingSettings(undefined),
      ),
    ).toBeUndefined();
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

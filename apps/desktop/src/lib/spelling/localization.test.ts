import { describe, expect, it } from "vitest";
import { m } from "$lib/paraglide/messages";

describe("spelling localization keeps UI locale separate from document language", () => {
  it("names a missing Spanish dictionary in English UI", () => {
    expect(m.spelling_missing_dictionary(
      { language: m.spelling_language_es(undefined, { locale: "en" }) },
      { locale: "en" },
    )).toBe("The Spanish system dictionary is not installed.");
  });

  it("names a missing English dictionary in Spanish UI", () => {
    expect(m.spelling_missing_dictionary(
      { language: m.spelling_language_en(undefined, { locale: "es" }) },
      { locale: "es" },
    )).toBe("El diccionario del sistema para inglés no está instalado.");
  });
});

import { describe, expect, it } from "vitest";
import { m } from "$lib/paraglide/messages";
import { readFile } from "node:fs/promises";

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

  it("keeps the real editor title and reference surfaces on document-language localization", async () => {
    const root = new URL("../../../", import.meta.url);
    const [addon, editorScreen] = await Promise.all([
      readFile(
        new URL("src/lib/spelling/SpellingExperienceEditorAddon.svelte", root),
        "utf8",
      ),
      readFile(new URL("src/lib/components/EditorScreen.svelte", root), "utf8"),
    ]);
    expect(addon).not.toContain("Paper title");
    expect(addon).not.toContain("No references");
    expect(editorScreen).not.toContain('"Paper title"');
    expect(editorScreen).not.toContain('"No references"');
  });
});

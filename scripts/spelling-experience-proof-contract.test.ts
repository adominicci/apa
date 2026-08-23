import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const source = (path: string) => readFile(new URL(path, root), "utf8");

describe("LT-02 compile-time proof boundary", () => {
  it("selects the editor spelling proof only for the exact value 1", async () => {
    const config = await source("apps/desktop/svelte.config.js");
    expect(config).toContain(
      'process.env.VITE_TESINA_SPELLING_EXPERIENCE_PROOF === "1"',
    );
    expect(config).toContain("SpellingExperienceProofPage.svelte");
    expect(config).toMatch(
      /spellingExperienceProof\s*\?\s*"\.\/src\/lib\/spelling\/SpellingExperienceProofPage\.svelte"/,
    );
  });

  it("keeps ordinary editor and settings entries free of proof imports and IPC calls", async () => {
    const [appPage, editorScreen, settings] = await Promise.all([
      source("apps/desktop/src/lib/components/AppPage.svelte"),
      source("apps/desktop/src/lib/components/EditorScreen.svelte"),
      source("apps/desktop/src/lib/state/uiLocale.svelte.ts"),
    ]);
    for (const ordinary of [appPage, editorScreen, settings]) {
      expect(ordinary).not.toContain("SpellingExperienceProofPage");
      expect(ordinary).not.toContain("spelling_capability");
      expect(ordinary).not.toContain("spelling_check");
      expect(ordinary).not.toContain("attachSpellingEditorAdapter");
    }
  });
});

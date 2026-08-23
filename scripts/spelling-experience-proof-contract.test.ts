import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const source = (path: string) => readFile(new URL(path, root), "utf8");

describe("LT-02 compile-time proof boundary", () => {
  it("selects a real-EditorScreen spelling addon only for the exact value 1", async () => {
    const config = await source("apps/desktop/svelte.config.js");
    expect(config).toContain(
      'process.env.VITE_TESINA_SPELLING_EXPERIENCE_PROOF === "1"',
    );
    expect(config).toContain("SpellingExperienceEditorAddon.svelte");
    expect(config).toMatch(
      /"\$tesina-editor-addon": spellingExperienceProof\s*\?\s*"\.\/src\/lib\/spelling\/SpellingExperienceEditorAddon\.svelte"\s*:\s*"\.\/src\/lib\/editor\/NoopEditorAddon\.svelte"/,
    );
    expect(config).toMatch(
      /"\$tesina-spelling-settings": spellingExperienceProof\s*\?\s*"\.\/src\/lib\/spelling\/ProofSpellingSettings\.ts"\s*:\s*"\.\/src\/lib\/editor\/NoopSpellingSettings\.ts"/,
    );
    expect(config).not.toMatch(
      /spellingExperienceProof\s*\?\s*"\.\/src\/lib\/spelling\/SpellingExperienceProofPage\.svelte"/,
    );
  });

  it("keeps ordinary editor and settings entries free of proof imports and IPC calls", async () => {
    const [appPage, editorScreen, settings, noopAddon, noopSettings] =
      await Promise.all([
        source("apps/desktop/src/lib/components/AppPage.svelte"),
        source("apps/desktop/src/lib/components/EditorScreen.svelte"),
        source("apps/desktop/src/lib/state/uiLocale.svelte.ts"),
        source("apps/desktop/src/lib/editor/NoopEditorAddon.svelte"),
        source("apps/desktop/src/lib/editor/NoopSpellingSettings.ts"),
      ]);
    expect(editorScreen).toContain('from "$tesina-editor-addon"');
    expect(settings).toContain('from "$tesina-spelling-settings"');
    expect(appPage).toContain("{#key currentEssayKey}");
    for (const ordinary of [appPage, settings, noopAddon, noopSettings]) {
      expect(ordinary).not.toContain("SpellingExperienceProofPage");
      expect(ordinary).not.toContain("spelling_capability");
      expect(ordinary).not.toContain("spelling_check");
      expect(ordinary).not.toContain("attachSpellingEditorAdapter");
    }
  });

  it("keeps device dictionary state outside essay and library export assembly", async () => {
    const exportSources = await Promise.all([
      source("apps/desktop/src/lib/persist/archiveService.ts"),
      source("apps/desktop/src/lib/persist/librarySnapshot.ts"),
      source("apps/desktop/src/lib/portable/snapshot.ts"),
    ]);
    for (const exportSource of exportSources) {
      expect(exportSource).not.toContain("uiLocale");
      expect(exportSource).not.toContain("personalDictionaries");
      expect(exportSource).not.toContain("spellingEnabled");
    }
  });
});

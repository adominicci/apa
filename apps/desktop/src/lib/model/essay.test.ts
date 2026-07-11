import { describe, expect, it } from "vitest";
import { createEmptyEssay, essayFromLegacyDraft, summarize } from "./essay.ts";

describe("createEmptyEssay", () => {
  it("creates a sectioned doc with student defaults", () => {
    const essay = createEmptyEssay("es", "2026-07-11T12:00:00.000Z");
    expect(essay.schemaVersion).toBe(2);
    expect(essay.settings.variant).toBe("student");
    expect(essay.settings.documentLanguage).toBe("es");
    expect(essay.titlePage.title).toBe("Ensayo sin título");
    expect(essay.content).toEqual({
      type: "doc",
      content: [{ type: "sectionBody", content: [{ type: "paragraph" }] }],
    });
  });
});

describe("essayFromLegacyDraft", () => {
  it("preserves content and language from the old draft file", () => {
    const content = {
      type: "doc",
      content: [{
        type: "sectionBody",
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: "Hola" }],
        }],
      }],
    };
    const essay = essayFromLegacyDraft(
      { schemaVersion: 1, settings: { documentLanguage: "en" }, content },
      "2026-07-11T12:00:00.000Z",
    );
    expect(essay.content).toBe(content);
    expect(essay.settings.documentLanguage).toBe("en");
    expect(essay.titlePage.title).toBe("Draft");
  });

  it("defaults to Spanish when the draft has no settings", () => {
    const essay = essayFromLegacyDraft({});
    expect(essay.settings.documentLanguage).toBe("es");
    expect(essay.titlePage.title).toBe("Borrador");
  });
});

describe("summarize", () => {
  it("extracts the card fields", () => {
    const essay = createEmptyEssay("es", "2026-07-11T12:00:00.000Z");
    expect(summarize(essay)).toEqual({
      id: essay.id,
      title: "Ensayo sin título",
      updatedAt: "2026-07-11T12:00:00.000Z",
      language: "es",
    });
  });
});

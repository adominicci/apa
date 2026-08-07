import { describe, expect, it } from "vitest";
import {
  createEmptyEssay,
  docPreview,
  essayFromLegacyDraft,
  normalizeForStudentRelease,
  summarize,
} from "./essay.ts";

describe("docPreview", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "sectionBody",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "  Primera   línea del cuerpo. " }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Segunda línea." }],
          },
        ],
      },
    ],
  };

  it("joins and collapses the running text", () => {
    expect(docPreview(doc)).toBe("Primera línea del cuerpo. Segunda línea.");
  });

  it("truncates with an ellipsis past the limit", () => {
    expect(docPreview(doc, 10)).toBe("Primera lí…");
  });

  it("returns empty for a blank doc", () => {
    expect(docPreview(createEmptyEssay("es").content)).toBe("");
  });

  it("never splits a surrogate pair at the cut", () => {
    const emojiDoc = {
      type: "doc",
      content: [{
        type: "sectionBody",
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: "ab😀cd" }],
        }],
      }],
    };
    expect(docPreview(emojiDoc, 3)).toBe("ab😀…");
    expect(docPreview(emojiDoc, 3)).not.toContain("�");
  });

  it("counts code points during the walk, not UTF-16 units", () => {
    // 6 emojis = 12 UTF-16 units but 6 code points: a unit-based walk would
    // stop at maxChars=10 and drop the second paragraph with no ellipsis.
    const emojiDoc = {
      type: "doc",
      content: [{
        type: "sectionBody",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "😀😀😀😀😀😀" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "y más texto" }],
          },
        ],
      }],
    };
    expect(docPreview(emojiDoc, 10)).toBe("😀😀😀😀😀😀 y m…");
  });
});

describe("summarize with title-page fields and preview", () => {
  it("includes course, instructor, and a text preview when present", () => {
    const essay = createEmptyEssay("es", "2026-07-11T12:00:00.000Z");
    essay.titlePage.course = "EDU 301";
    essay.titlePage.instructor = "Dra. Solís";
    essay.content = {
      type: "doc",
      content: [
        {
          type: "sectionBody",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Hola mundo." }],
            },
          ],
        },
      ],
    };
    expect(summarize(essay)).toMatchObject({
      course: "EDU 301",
      instructor: "Dra. Solís",
      preview: "Hola mundo.",
    });
  });
});

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

  it("ignores the dormant professional option in the student-only release", () => {
    const essay = createEmptyEssay(
      "en",
      "2026-07-11T12:00:00.000Z",
      "professional",
    );

    expect(essay.settings.variant).toBe("student");
    expect(essay.schemaVersion).toBe(2);
  });
});

describe("normalizeForStudentRelease", () => {
  it("opens a pre-release professional essay as a student paper", () => {
    const essay = createEmptyEssay("en", "2026-07-11T12:00:00.000Z");
    essay.settings.variant = "professional";

    const normalized = normalizeForStudentRelease(essay);

    expect(normalized.settings.variant).toBe("student");
    expect(normalized.schemaVersion).toBe(2);
  });

  it("preserves dormant professional metadata for future compatibility", () => {
    const essay = createEmptyEssay("en", "2026-07-11T12:00:00.000Z");
    essay.settings.variant = "professional";
    essay.settings.runningHead = "LEGACY HEAD";
    essay.titlePage.authorNote = "Legacy note";

    const normalized = normalizeForStudentRelease(essay);

    expect(normalized.settings.runningHead).toBe("LEGACY HEAD");
    expect(normalized.titlePage.authorNote).toBe("Legacy note");
    expect(essay.settings.variant).toBe("professional");
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
      words: 0,
      preview: "",
    });
  });
});

/**
 * Regression tests for the additive import-provenance fields (task 5.1):
 * `importedAt` and `sourceEssayId` are optional under schema version 2, so
 * every pre-existing essay keeps loading and summarizing unchanged, while an
 * imported copy carries both fields through a JSON persist round trip.
 */
import { describe, expect, it } from "vitest";
import {
  createEmptyEssay,
  type Essay,
  normalizeForStudentRelease,
  summarize,
} from "./essay.ts";

const NOW = "2026-08-08T12:00:00.000Z";

function oldEssay(): Essay {
  const essay = createEmptyEssay("es", "2026-01-01T00:00:00.000Z");
  essay.id = "00000000-0000-4000-8000-000000000001";
  essay.titlePage.title = "Ensayo previo";
  return essay;
}

function importedCopy(): Essay {
  return {
    ...oldEssay(),
    id: "00000000-0000-4000-8000-000000000002",
    importedAt: NOW,
    sourceEssayId: "00000000-0000-4000-8000-000000000001",
  };
}

describe("essay import provenance fields", () => {
  it("keeps schemaVersion 2 for essays with and without the fields", () => {
    expect(oldEssay().schemaVersion).toBe(2);
    expect(importedCopy().schemaVersion).toBe(2);
  });

  it("loads an old persisted essay without the fields unchanged", () => {
    const persisted = JSON.stringify(oldEssay());
    const loaded = JSON.parse(persisted) as Essay;
    expect(loaded).toEqual(oldEssay());
    expect("importedAt" in loaded).toBe(false);
    expect("sourceEssayId" in loaded).toBe(false);
  });

  it("summarizes an old essay exactly as before", () => {
    const summary = summarize(oldEssay());
    expect(summary).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      title: "Ensayo previo",
      updatedAt: "2026-01-01T00:00:00.000Z",
      language: "es",
      words: 0,
      preview: "",
    });
  });

  it("summarizes an imported copy identically to a plain essay", () => {
    const plain = { ...importedCopy() } as Essay & Record<string, unknown>;
    delete plain["importedAt"];
    delete plain["sourceEssayId"];
    expect(summarize(importedCopy())).toEqual(summarize(plain));
  });

  it("persists both provenance fields through a JSON round trip", () => {
    const loaded = JSON.parse(JSON.stringify(importedCopy())) as Essay;
    expect(loaded.importedAt).toBe(NOW);
    expect(loaded.sourceEssayId).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("does not invent the fields when serializing an old essay", () => {
    const persisted = JSON.stringify(oldEssay());
    expect(persisted).not.toContain("importedAt");
    expect(persisted).not.toContain("sourceEssayId");
  });

  it("preserves the fields through normalizeForStudentRelease", () => {
    const normalized = normalizeForStudentRelease(importedCopy());
    expect(normalized.importedAt).toBe(NOW);
    expect(normalized.sourceEssayId).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
  });
});

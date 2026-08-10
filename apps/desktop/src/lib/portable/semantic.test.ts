/**
 * Semantic-identity digests (task 5.2, design §5): persistence and import
 * provenance timestamps never create false essay conflicts, while every
 * genuinely semantic field does change the digest.
 */
import { describe, expect, it } from "vitest";
import type { Reference } from "@tesina/engine";
import type { Essay } from "$lib/model/essay";
import type { RefCollection } from "$lib/model/collections";
import { fixtureUuid } from "./fixtures/libraries.ts";
import {
  collectionDigest,
  essaySemanticDigest,
  referenceDigest,
} from "./semantic.ts";

function reference(n: number): Reference {
  return {
    type: "journalArticle",
    id: fixtureUuid(1, n),
    authors: [{ kind: "person", family: `Autora${n}`, given: "M." }],
    date: { year: 2020 },
    title: `Estudio ${n}`,
    journal: "Revista Sintética",
  };
}

function baseEssay(): Essay {
  return {
    schemaVersion: 2,
    id: fixtureUuid(2, 1),
    createdAt: "2026-01-15T12:00:00.000Z",
    updatedAt: "2026-01-15T12:00:00.000Z",
    settings: {
      documentLanguage: "es",
      variant: "student",
      font: "times-new-roman-12",
      paperSize: "us-letter",
      includeUncitedReferences: false,
    },
    titlePage: {
      title: "Ensayo semántico",
      authors: ["Estudiante Ejemplo"],
      affiliations: ["Universidad Sintética"],
    },
    content: {
      type: "doc",
      content: [{
        type: "sectionBody",
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: "Cuerpo del ensayo." }],
        }],
      }],
    },
    referencesSnapshot: [reference(1)],
  };
}

describe("essaySemanticDigest", () => {
  it("ignores updatedAt", async () => {
    const changed = { ...baseEssay(), updatedAt: "2027-12-31T23:59:59.000Z" };
    expect(await essaySemanticDigest(changed)).toBe(
      await essaySemanticDigest(baseEssay()),
    );
  });

  it("ignores importedAt and sourceEssayId", async () => {
    const changed: Essay = {
      ...baseEssay(),
      importedAt: "2027-01-01T00:00:00.000Z",
      sourceEssayId: fixtureUuid(2, 99),
    };
    expect(await essaySemanticDigest(changed)).toBe(
      await essaySemanticDigest(baseEssay()),
    );
  });

  it("changes when the title page changes", async () => {
    const changed = {
      ...baseEssay(),
      titlePage: { ...baseEssay().titlePage, title: "Otro título" },
    };
    expect(await essaySemanticDigest(changed)).not.toBe(
      await essaySemanticDigest(baseEssay()),
    );
  });

  it("changes when settings change", async () => {
    const changed: Essay = {
      ...baseEssay(),
      settings: { ...baseEssay().settings, documentLanguage: "en" },
    };
    expect(await essaySemanticDigest(changed)).not.toBe(
      await essaySemanticDigest(baseEssay()),
    );
  });

  it("changes when the document content changes", async () => {
    const changed = {
      ...baseEssay(),
      content: {
        type: "doc",
        content: [{ type: "sectionBody", content: [{ type: "paragraph" }] }],
      },
    };
    expect(await essaySemanticDigest(changed)).not.toBe(
      await essaySemanticDigest(baseEssay()),
    );
  });

  it("changes when createdAt changes", async () => {
    const changed = { ...baseEssay(), createdAt: "2025-01-01T00:00:00.000Z" };
    expect(await essaySemanticDigest(changed)).not.toBe(
      await essaySemanticDigest(baseEssay()),
    );
  });

  it("changes when the references snapshot changes", async () => {
    const changed = { ...baseEssay(), referencesSnapshot: [reference(2)] };
    expect(await essaySemanticDigest(changed)).not.toBe(
      await essaySemanticDigest(baseEssay()),
    );
  });

  it("changes when the id changes", async () => {
    const changed = { ...baseEssay(), id: fixtureUuid(2, 2) };
    expect(await essaySemanticDigest(changed)).not.toBe(
      await essaySemanticDigest(baseEssay()),
    );
  });
});

describe("referenceDigest", () => {
  it("is stable across property insertion order", async () => {
    const base = reference(1) as unknown as Record<string, unknown>;
    const shuffled: Record<string, unknown> = {};
    for (const key of Object.keys(base).sort().reverse()) {
      shuffled[key] = base[key];
    }
    expect(await referenceDigest(shuffled as unknown as Reference)).toBe(
      await referenceDigest(reference(1)),
    );
  });

  it("changes with any content field", async () => {
    const changed = { ...reference(1), title: "Título distinto" };
    expect(await referenceDigest(changed)).not.toBe(
      await referenceDigest(reference(1)),
    );
  });

  it("changes with the id", async () => {
    const changed = { ...reference(1), id: fixtureUuid(1, 50) };
    expect(await referenceDigest(changed)).not.toBe(
      await referenceDigest(reference(1)),
    );
  });
});

describe("collectionDigest", () => {
  const base: RefCollection = {
    id: fixtureUuid(3, 1),
    name: "Colección",
    refIds: [fixtureUuid(1, 1), fixtureUuid(1, 2)],
  };

  it("ignores member order and duplicates", async () => {
    const shuffled: RefCollection = {
      ...base,
      refIds: [fixtureUuid(1, 2), fixtureUuid(1, 1), fixtureUuid(1, 2)],
    };
    expect(await collectionDigest(shuffled)).toBe(await collectionDigest(base));
  });

  it("changes with the name", async () => {
    const changed = { ...base, name: "Otra colección" };
    expect(await collectionDigest(changed)).not.toBe(
      await collectionDigest(base),
    );
  });

  it("changes with the membership", async () => {
    const changed = { ...base, refIds: [fixtureUuid(1, 1)] };
    expect(await collectionDigest(changed)).not.toBe(
      await collectionDigest(base),
    );
  });

  it("changes with the id", async () => {
    const changed = { ...base, id: fixtureUuid(3, 2) };
    expect(await collectionDigest(changed)).not.toBe(
      await collectionDigest(base),
    );
  });
});

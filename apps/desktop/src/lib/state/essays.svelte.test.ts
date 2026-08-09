import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyEssay, type Essay, summarize } from "$lib/model/essay";
import { LatestLaunch, type LaunchValue } from "$lib/state/latestLaunch";

const persistence = vi.hoisted(() => {
  Object.defineProperty(globalThis, "$state", {
    configurable: true,
    value: <T>(initial: T): T => initial,
  });

  return {
    files: new Map<string, unknown>(),
    writeJsonAtomic: vi.fn(),
  };
});

vi.mock("$lib/persist/atomic", () => ({
  fileExists: vi.fn(() => Promise.resolve(false)),
  listJsonFiles: vi.fn((directory: string) =>
    Promise.resolve(
      [...persistence.files.keys()]
        .filter((path) => path.startsWith(`${directory}/`))
        .map((path) => path.slice(directory.length + 1))
        .filter((name) => name.endsWith(".json") && !name.includes("/")),
    )
  ),
  readJson: vi.fn((path: string) => {
    const value = persistence.files.get(path);
    return Promise.resolve(
      value === undefined ? null : structuredClone(value),
    );
  }),
  removeFile: vi.fn((path: string) => {
    persistence.files.delete(path);
    return Promise.resolve();
  }),
  writeJsonAtomic: persistence.writeJsonAtomic.mockImplementation(
    (path: string, value: unknown) => {
      persistence.files.set(path, structuredClone(value));
      return Promise.resolve();
    },
  ),
}));

import { essays } from "./essays.svelte.ts";

// Frozen pre-pagination schema-v2 bytes. Keep this independent from today's
// factory so a future default cannot silently rewrite the compatibility case.
const PRE_PAGINATION_SCHEMA_V2_JSON =
  `{"schemaVersion":2,"id":"old-schema-two","createdAt":"2025-01-02T03:04:05.000Z","updatedAt":"2025-01-02T03:04:05.000Z","settings":{"documentLanguage":"en","variant":"student","font":"times-new-roman-12","paperSize":"us-letter","includeUncitedReferences":false},"titlePage":{"title":"Archived schema-two paper","authors":["Taylor Example"],"affiliations":["Invented College"]},"content":{"type":"doc","content":[{"type":"sectionBody","content":[{"type":"paragraph","content":[{"type":"text","text":"Authored before live pagination."}]},{"type":"figure","content":[{"type":"figureTitle","content":[{"type":"text","text":"A preserved figure"}]},{"type":"figureImage","attrs":{"src":"essays/assets/old-schema-two/figure.png","alt":"invented chart"}},{"type":"figureNote"}]}]}]},"referencesSnapshot":[{"id":"old-reference","type":"website","authors":[{"kind":"group","name":"Invented Archive"}],"date":{"year":2024},"title":"A preserved source","url":"https://example.test/source"}]}`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function professionalEssay(): Essay {
  const essay = createEmptyEssay("en", "2026-08-07T12:00:00.000Z");
  essay.settings.variant = "professional";
  essay.settings.runningHead = "LEGACY HEAD";
  essay.titlePage.authorNote = "Legacy note";
  return essay;
}

beforeEach(() => {
  persistence.files.clear();
  persistence.writeJsonAtomic.mockClear();
  essays.summaries = [];
  essays.loaded = false;
});

describe("student-release persistence boundary", () => {
  it("reopens old and current schema-version 2 papers without pagination drift", async () => {
    const oldEssay = JSON.parse(PRE_PAGINATION_SCHEMA_V2_JSON) as Essay;

    const currentEssay = createEmptyEssay(
      "es",
      "2026-08-08T12:00:00.000Z",
    );
    currentEssay.id = "current-schema-two";
    currentEssay.settings.wordGoal = 3200;
    currentEssay.content = {
      type: "doc",
      content: [{
        type: "sectionBody",
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: "Texto actual conservado." }],
        }],
      }],
    };

    for (const essay of [oldEssay, currentEssay]) {
      persistence.files.set(`essays/${essay.id}.json`, structuredClone(essay));
    }

    await essays.loadIndex();
    expect(essays.summaries.map((summary) => summary.id).sort()).toEqual([
      "current-schema-two",
      "old-schema-two",
    ]);

    for (const original of [oldEssay, currentEssay]) {
      const originalContent = JSON.stringify(original.content);
      const originalReferences = JSON.stringify(original.referencesSnapshot);
      const reopened = await essays.load(original.id);
      expect(reopened?.schemaVersion).toBe(2);
      expect(JSON.stringify(reopened?.content)).toBe(originalContent);
      expect(JSON.stringify(reopened?.referencesSnapshot)).toBe(
        originalReferences,
      );

      await essays.persist(reopened!);
      const stored = persistence.files.get(
        `essays/${original.id}.json`,
      ) as Essay;
      const storedJson = JSON.stringify(stored);
      expect(stored.schemaVersion).toBe(2);
      expect(JSON.stringify(stored.content)).toBe(originalContent);
      expect(JSON.stringify(stored.referencesSnapshot)).toBe(
        originalReferences,
      );
      expect(storedJson).not.toMatch(
        /"(?:pagination|pageStarts|pageGaps|pageCount|pageNumber)"/,
      );
    }

    const savedOld = JSON.stringify(
      persistence.files.get("essays/old-schema-two.json"),
    );
    expect(savedOld.match(/old-reference/g)).toHaveLength(1);
    expect(savedOld.match(/essays\/assets\/old-schema-two\/figure\.png/g))
      .toHaveLength(1);
    expect(savedOld.match(/A preserved figure/g)).toHaveLength(1);
  });

  it("persists and reopens an authored fallback edit with its missing asset path", async () => {
    const fallbackEssay = JSON.parse(
      PRE_PAGINATION_SCHEMA_V2_JSON,
    ) as Essay;
    fallbackEssay.id = "fallback-autosave-proof";
    const bodyParagraph = (fallbackEssay.content as {
      content: Array<
        { content: Array<{ content?: Array<{ text?: string }> }> }
      >;
    }).content[0]!.content[0]!;
    bodyParagraph.content![0]!.text =
      "Authored before live pagination. Edited while pagination was unavailable.";
    const exactAuthoredContent = JSON.stringify(fallbackEssay.content);

    await essays.persist(fallbackEssay);
    const reopened = await essays.load(fallbackEssay.id);

    expect(JSON.stringify(reopened?.content)).toBe(exactAuthoredContent);
    const reopenedJson = JSON.stringify(reopened);
    expect(reopenedJson.match(/Edited while pagination was unavailable/g))
      .toHaveLength(1);
    expect(reopenedJson.match(/essays\/assets\/old-schema-two\/figure\.png/g))
      .toHaveLength(1);
    expect(reopenedJson).not.toMatch(
      /"(?:pagination|pageStarts|pageGaps|pageCount|pageNumber)"/,
    );
  });

  it.each([
    ["legacy", 1],
    ["future", 3],
    ["missing", undefined],
  ])(
    "drops a %s schema version through the direct load path",
    async (_, version) => {
      const stored = professionalEssay() as unknown as {
        id: string;
        schemaVersion?: number;
      };
      if (version === undefined) {
        delete stored.schemaVersion;
      } else {
        stored.schemaVersion = version;
      }
      const path = `essays/${stored.id}.json`;
      persistence.files.set(path, stored);

      expect(await essays.load(stored.id)).toBeNull();
      expect(
        (persistence.files.get(path) as { schemaVersion?: number })
          .schemaVersion,
      ).toBe(version);
    },
  );

  it("loads a professional file in student mode without deleting dormant metadata", async () => {
    const stored = professionalEssay();
    persistence.files.set(`essays/${stored.id}.json`, stored);

    const loaded = await essays.load(stored.id);

    expect(loaded?.settings.variant).toBe("student");
    expect(loaded?.settings.runningHead).toBe("LEGACY HEAD");
    expect(loaded?.titlePage.authorNote).toBe("Legacy note");
    expect(stored.settings.variant).toBe("professional");
    expect(stored.settings.runningHead).toBe("LEGACY HEAD");
    expect(stored.titlePage.authorNote).toBe("Legacy note");
  });

  it("persists a professional-shaped essay as student without deleting dormant metadata", async () => {
    const active = professionalEssay();

    await essays.persist(active);

    const written = persistence.files.get(`essays/${active.id}.json`) as Essay;
    expect(written.settings.variant).toBe("student");
    expect(written.settings.runningHead).toBe("LEGACY HEAD");
    expect(written.titlePage.authorNote).toBe("Legacy note");
    expect(active.settings.variant).toBe("student");
  });
});

describe("essay launch persistence", () => {
  it("removes the exact blank essay created by a superseded launch", async () => {
    const existing = createEmptyEssay("en", "2026-08-07T12:00:00.000Z");
    existing.id = "existing-paper";
    persistence.files.set(`essays/${existing.id}.json`, existing);
    essays.summaries = [summarize(existing)];

    const pendingWrite = deferred<void>();
    persistence.writeJsonAtomic.mockImplementationOnce(
      (path: string, value: unknown) => {
        persistence.files.set(path, structuredClone(value));
        return pendingWrite.promise;
      },
    );
    const launches = new LatestLaunch();
    const applied: LaunchValue<Essay>[] = [];

    const createRequest = launches.run(
      true,
      () => essays.create("es"),
      (launch) => applied.push(launch),
      (created) => essays.remove(created.id),
    );
    const createdPath = [...persistence.files.keys()].find((path) =>
      path !== `essays/${existing.id}.json`
    );
    expect(createdPath).toMatch(/^essays\/.+\.json$/);

    await launches.run(
      false,
      () => essays.load(existing.id),
      (launch) => applied.push(launch),
    );
    pendingWrite.resolve();
    await createRequest;

    expect(applied).toEqual([{ value: existing, newlyCreated: false }]);
    expect(persistence.files.has(createdPath!)).toBe(false);
    expect(essays.summaries.map((summary) => summary.id)).toEqual([
      existing.id,
    ]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyEssay, type Essay } from "$lib/model/essay";

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
  listJsonFiles: vi.fn(() => Promise.resolve([])),
  readJson: vi.fn((path: string) => {
    const value = persistence.files.get(path);
    return Promise.resolve(
      value === undefined ? null : structuredClone(value),
    );
  }),
  removeFile: vi.fn(() => Promise.resolve()),
  writeJsonAtomic: persistence.writeJsonAtomic.mockImplementation(
    (path: string, value: unknown) => {
      persistence.files.set(path, structuredClone(value));
      return Promise.resolve();
    },
  ),
}));

import { essays } from "./essays.svelte.ts";

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

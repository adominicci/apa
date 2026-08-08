import { describe, expect, it } from "vitest";
import {
  ARCHIVE_LIMITS,
  assertJsonWithinLimits,
  LimitError,
} from "./limits.ts";
import { buildZip, extractZipEntry, readZipEntries } from "./zip.ts";
import {
  emptyLibraryFixture,
  figureHeavyLibraryFixture,
  largeTextLibraryFixture,
  type LibraryFixture,
} from "./fixtures/libraries.ts";

/**
 * Tasks 1.3/1.4: the numeric limits are chosen from these representative
 * fixtures — each supported profile must pass with a wide margin while
 * synthetic oversized input is rejected, both by declared preflight values
 * and by observed counters.
 */

const encoder = new TextEncoder();

function fixtureEntries(
  fixture: LibraryFixture,
): { path: string; bytes: Uint8Array }[] {
  const entries = [
    {
      path: "library.json",
      bytes: encoder.encode(JSON.stringify(fixture.library)),
    },
  ];
  for (const essay of fixture.essays) {
    entries.push({
      path: `essays/${essay.id}.json`,
      bytes: encoder.encode(JSON.stringify(essay)),
    });
  }
  for (const [path, bytes] of Object.entries(fixture.assets)) {
    entries.push({ path: path.replace("essays/assets/", "assets/"), bytes });
  }
  return entries;
}

describe("archive limits against representative fixtures", () => {
  const profiles = [
    ["empty", emptyLibraryFixture()],
    ["large-text", largeTextLibraryFixture()],
    ["figure-heavy", figureHeavyLibraryFixture()],
  ] as const;

  for (const [name, fixture] of profiles) {
    it(`accepts the ${name} fixture with at least 4x headroom`, () => {
      const entries = fixtureEntries(fixture);
      const zipped = buildZip(entries, { compress: true });

      expect(zipped.length * 4).toBeLessThanOrEqual(
        ARCHIVE_LIMITS.maxArchiveBytes,
      );
      expect(entries.length * 4).toBeLessThanOrEqual(
        ARCHIVE_LIMITS.maxEntryCount,
      );
      const total = entries.reduce((sum, e) => sum + e.bytes.length, 0);
      expect(total * 4).toBeLessThanOrEqual(
        ARCHIVE_LIMITS.maxTotalExpandedBytes,
      );
      for (const entry of entries) {
        expect(entry.bytes.length * 4).toBeLessThanOrEqual(
          ARCHIVE_LIMITS.maxEntryExpandedBytes,
        );
      }
      expect(fixture.essays.length * 4).toBeLessThanOrEqual(
        ARCHIVE_LIMITS.maxEssays,
      );
      expect(fixture.library.references.length * 4).toBeLessThanOrEqual(
        ARCHIVE_LIMITS.maxReferences,
      );

      // The whole profile must survive bounded intake and extraction.
      const metas = readZipEntries(zipped, ARCHIVE_LIMITS);
      expect(metas.length).toBe(entries.length);
      for (const meta of metas) {
        extractZipEntry(zipped, meta, ARCHIVE_LIMITS);
      }

      // Structured complexity fits every JSON payload in the profile.
      for (const essay of fixture.essays) {
        assertJsonWithinLimits(essay, ARCHIVE_LIMITS);
      }
      assertJsonWithinLimits(fixture.library, ARCHIVE_LIMITS);
    });
  }

  it("legitimate compression of repetitive essay text stays under the ratio cap", () => {
    const entries = fixtureEntries(largeTextLibraryFixture());
    const zipped = buildZip(entries, { compress: true });
    const metas = readZipEntries(zipped, ARCHIVE_LIMITS);
    for (const meta of metas) {
      if (meta.compressedSize === 0) continue;
      const ratio = meta.uncompressedSize / meta.compressedSize;
      expect(ratio).toBeLessThan(ARCHIVE_LIMITS.maxCompressionRatio / 4);
    }
  });

  it("rejects JSON nested deeper than the depth limit", () => {
    let value: unknown = "leaf";
    for (let i = 0; i <= ARCHIVE_LIMITS.maxJsonDepth; i += 1) {
      value = { child: value };
    }
    expect(() => assertJsonWithinLimits(value, ARCHIVE_LIMITS)).toThrow(
      LimitError,
    );
  });

  it("rejects JSON with more nodes than the node limit", () => {
    const limits = { ...ARCHIVE_LIMITS, maxJsonNodes: 100 };
    const value = Array.from({ length: 101 }, (_, i) => i);
    expect(() => assertJsonWithinLimits(value, limits)).toThrow(LimitError);
  });

  it("rejects a single string longer than the string limit", () => {
    const limits = { ...ARCHIVE_LIMITS, maxJsonStringLength: 64 };
    expect(() => assertJsonWithinLimits({ text: "x".repeat(65) }, limits))
      .toThrow(LimitError);
  });

  it("accepts the deepest real fixture document within the depth limit", () => {
    const fixture = figureHeavyLibraryFixture();
    for (const essay of fixture.essays) {
      assertJsonWithinLimits(essay, {
        ...ARCHIVE_LIMITS,
        maxJsonDepth: 32, // documents stay shallow even under a tighter cap
      });
    }
  });
});

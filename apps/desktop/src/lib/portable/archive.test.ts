import { describe, expect, it } from "vitest";
import { buildArchive, readArchiveStructure, sha256Hex } from "./archive.ts";
import { canonicalJsonBytes, canonicalJsonText } from "./canonicalJson.ts";
import { assembleArchiveContent } from "./snapshot.ts";
import { ARCHIVE_LIMITS } from "./limits.ts";
import { buildZip, readZipEntries } from "./zip.ts";
import {
  emptyLibraryFixture,
  figureHeavyLibraryFixture,
  fixtureUuid,
  largeTextLibraryFixture,
} from "./fixtures/libraries.ts";

/** Tasks 2.1–2.6: pure archive contract and deterministic bytes. */

const DEPS = {
  now: () => "2026-01-20T08:30:00.000Z",
  appVersion: "0.1.1",
};

function figureFixtureContent() {
  const fixture = figureHeavyLibraryFixture();
  return assembleArchiveContent({
    essays: fixture.essays,
    library: fixture.library,
    assets: new Map(Object.entries(fixture.assets)),
  });
}

describe("canonical JSON", () => {
  it("orders keys deterministically and independent of insertion order", () => {
    const a = canonicalJsonText({ b: 1, a: { d: 2, c: [3, { z: 4, y: 5 }] } });
    const b = canonicalJsonText({ a: { c: [3, { y: 5, z: 4 }], d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":[3,{"y":5,"z":4}],"d":2},"b":1}');
  });

  it("encodes UTF-8 bytes", () => {
    const bytes = canonicalJsonBytes({ t: "Ensayo español — ñ" });
    expect(new TextDecoder().decode(bytes)).toContain("ñ");
  });
});

describe("manifest contract (task 2.1)", () => {
  it("describes every payload file with byte length and SHA-256", async () => {
    const content = figureFixtureContent();
    const bytes = await buildArchive(content, DEPS);
    const { manifest, files } = await readArchiveStructure(
      bytes,
      ARCHIVE_LIMITS,
    );

    expect(manifest.kind).toBe("tesina-library");
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.encryption).toBeNull();
    expect(manifest.createdAt).toBe("2026-01-20T08:30:00.000Z");
    expect(manifest.appVersion).toBe("0.1.1");
    expect(manifest.backup).toBeUndefined();
    expect(manifest.counts).toEqual({
      essays: 12,
      references: 30,
      collections: 1,
      assets: 36,
    });
    expect(manifest.files.length).toBe(files.size);
    for (const record of manifest.files) {
      const payload = files.get(record.path);
      expect(payload, record.path).toBeDefined();
      expect(payload!.length).toBe(record.byteLength);
      expect(await sha256Hex(payload!)).toBe(record.sha256);
    }
  });

  it("stamps the backup set id only for backup archives", async () => {
    const content = figureFixtureContent();
    const bytes = await buildArchive(content, {
      ...DEPS,
      backupSetId: fixtureUuid(9, 1),
    });
    const { manifest } = await readArchiveStructure(bytes, ARCHIVE_LIMITS);
    expect(manifest.backup).toEqual({ backupSetId: fixtureUuid(9, 1) });
  });

  it("rejects an archive declaring a newer format version", async () => {
    const content = figureFixtureContent();
    const bytes = await buildArchive(content, DEPS);
    const { manifest } = await readArchiveStructure(bytes, ARCHIVE_LIMITS);
    const future = { ...manifest, formatVersion: 2 };
    const futureArchive = buildZip([
      { path: "manifest.json", bytes: canonicalJsonBytes(future) },
      {
        path: "library.json",
        bytes: canonicalJsonBytes({ schemaVersion: 1, references: [] }),
      },
    ], { compress: true });
    await expect(readArchiveStructure(futureArchive, ARCHIVE_LIMITS)).rejects
      .toMatchObject({ code: "archive/format-version" });
  });
});

describe("content scope (tasks 2.3–2.5)", () => {
  it("archives exactly the content set: essays, library, reachable assets", async () => {
    const fixture = figureHeavyLibraryFixture();
    const content = assembleArchiveContent({
      essays: fixture.essays,
      library: fixture.library,
      assets: new Map([
        ...Object.entries(fixture.assets),
        ...Object.entries(fixture.orphanAssets),
      ]),
    });
    const bytes = await buildArchive(content, DEPS);
    const { manifest, files } = await readArchiveStructure(
      bytes,
      ARCHIVE_LIMITS,
    );

    const paths = [...files.keys()];
    expect(paths).toContain("library.json");
    for (const essay of fixture.essays) {
      expect(paths).toContain(`essays/${essay.id}.json`);
    }
    // Orphan assets never enter the archive.
    const orphanId = fixtureUuid(4, 9999);
    expect(paths.some((p) => p.includes(orphanId))).toBe(false);
    // Device data has no entry at all.
    expect(paths.some((p) => p.includes("settings"))).toBe(false);
    expect(paths.some((p) => p.includes("backup"))).toBe(false);
    expect(manifest.counts.assets).toBe(Object.keys(fixture.assets).length);
  });

  it("normalizes archived figure paths to assets/ while local files keep essays/assets/", async () => {
    const content = figureFixtureContent();
    const bytes = await buildArchive(content, DEPS);
    const { files } = await readArchiveStructure(bytes, ARCHIVE_LIMITS);
    const essayPath = [...files.keys()].find((p) => p.startsWith("essays/"))!;
    const essayJson = new TextDecoder().decode(files.get(essayPath)!);
    expect(essayJson).not.toContain("essays/assets/");
    expect(essayJson).toContain('"assets/');
  });

  it("fails the whole export when a source essay is invalid", () => {
    const fixture = figureHeavyLibraryFixture();
    const broken = structuredClone(fixture.essays);
    (broken[3] as { schemaVersion: number }).schemaVersion = 3;
    expect(() =>
      assembleArchiveContent({
        essays: broken,
        library: fixture.library,
        assets: new Map(Object.entries(fixture.assets)),
      })
    ).toThrowError(
      expect.objectContaining({
        code: "archive/invalid-source-essay",
        detail: expect.stringContaining(broken[3].id),
      }),
    );
  });

  it("fails the whole export when a referenced asset is missing", () => {
    const fixture = figureHeavyLibraryFixture();
    const assets = new Map(Object.entries(fixture.assets));
    const [firstPath] = assets.keys();
    assets.delete(firstPath);
    expect(() =>
      assembleArchiveContent({
        essays: fixture.essays,
        library: fixture.library,
        assets,
      })
    ).toThrowError(
      expect.objectContaining({
        code: "archive/missing-source-asset",
        detail: expect.stringContaining(firstPath),
      }),
    );
  });

  it("fails when the shared library declares an unsupported schema", () => {
    const fixture = emptyLibraryFixture();
    expect(() =>
      assembleArchiveContent({
        essays: [],
        library: { ...fixture.library, schemaVersion: 2 as unknown as 1 },
        assets: new Map(),
      })
    ).toThrowError(
      expect.objectContaining({ code: "archive/invalid-source-library" }),
    );
  });
});

describe("deterministic bytes (task 2.5)", () => {
  it("produces identical bytes for identical injected inputs", async () => {
    const first = await buildArchive(figureFixtureContent(), DEPS);
    const second = await buildArchive(figureFixtureContent(), DEPS);
    expect(await sha256Hex(first)).toBe(await sha256Hex(second));
  });

  it("is insensitive to essay and asset input order", async () => {
    const fixture = figureHeavyLibraryFixture();
    const shuffledEssays = [...fixture.essays].reverse();
    const shuffledAssets = new Map(
      Object.entries(fixture.assets).reverse(),
    );
    const a = await buildArchive(
      assembleArchiveContent({
        essays: fixture.essays,
        library: fixture.library,
        assets: new Map(Object.entries(fixture.assets)),
      }),
      DEPS,
    );
    const b = await buildArchive(
      assembleArchiveContent({
        essays: shuffledEssays,
        library: fixture.library,
        assets: shuffledAssets,
      }),
      DEPS,
    );
    expect(await sha256Hex(a)).toBe(await sha256Hex(b));
  });

  it("matches the committed golden digest for every fixture profile", async () => {
    // Cross-process determinism: these constants were produced by a separate
    // process; any ambient nondeterminism (clock, locale, hash order, zip
    // metadata) breaks this test.
    const goldens: Record<string, string> = {
      empty: "8418cbcaf07d5e5022f95f1110f25da29f9b81686a55d73dde967846c3ea50ac",
      "large-text":
        "8cffdd5e95e7a1e4109e30c0c35e8f3b079ae3c478712cfba4caae35cb4003b3",
      "figure-heavy":
        "0d8f2e3140ee19933ab9eaa03324f444cd1381bfb201372ae352e7bc94fc2541",
    };
    const profiles = {
      empty: emptyLibraryFixture(),
      "large-text": largeTextLibraryFixture(),
      "figure-heavy": figureHeavyLibraryFixture(),
    };
    for (const [name, fixture] of Object.entries(profiles)) {
      const bytes = await buildArchive(
        assembleArchiveContent({
          essays: fixture.essays,
          library: fixture.library,
          assets: new Map(Object.entries(fixture.assets)),
        }),
        DEPS,
      );
      expect(`${name}:${await sha256Hex(bytes)}`).toBe(
        `${name}:${goldens[name]}`,
      );
    }
  });
});

describe("highly compressible local content", () => {
  it("stores bomb-ratio entries so its own output passes the reader", async () => {
    // Regression (Codex review): a long pasted run of one character deflates
    // far beyond the reader's ratio cap; the writer must store such entries
    // uncompressed instead of producing an archive it would itself reject.
    const fixture = figureHeavyLibraryFixture();
    const essay = structuredClone(fixture.essays[0]);
    (essay.content as { content: unknown[] }).content.push({
      type: "sectionBody",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "a".repeat(2_000_000) }],
      }],
    });
    const content = assembleArchiveContent({
      essays: [essay],
      library: fixture.library,
      assets: new Map(Object.entries(fixture.assets)),
    });
    const bytes = await buildArchive(content, DEPS);
    const { files } = await readArchiveStructure(bytes, ARCHIVE_LIMITS);
    expect(files.has(`essays/${essay.id}.json`)).toBe(true);
  });
});

describe("reopen gate (task 2.6)", () => {
  it("readArchiveStructure verifies checksums before returning payloads", async () => {
    const bytes = await buildArchive(figureFixtureContent(), DEPS);
    // Corrupt one payload byte inside the first essay entry.
    const entries = readZipEntries(bytes, ARCHIVE_LIMITS);
    const essayEntry = entries.find((e) => e.path.startsWith("essays/"))!;
    const corrupted = bytes.slice();
    const headerSkip = 30 + essayEntry.path.length;
    corrupted[essayEntry.localHeaderOffset + headerSkip + 12] ^= 0xff;
    // Corruption may surface at the ZIP layer (crc/deflate) or, for intact
    // streams, at the manifest checksum comparison — both are pre-payload.
    await expect(readArchiveStructure(corrupted, ARCHIVE_LIMITS)).rejects
      .toMatchObject({ code: expect.stringMatching(/^(zip|archive)\//) });
  });

  it("rejects a manifest that omits or duplicates payload records", async () => {
    const content = figureFixtureContent();
    const bytes = await buildArchive(content, DEPS);
    const { files, manifest } = await readArchiveStructure(
      bytes,
      ARCHIVE_LIMITS,
    );
    const stripped = {
      ...manifest,
      files: manifest.files.slice(1),
    };
    const rebuilt = buildZip([
      { path: "manifest.json", bytes: canonicalJsonBytes(stripped) },
      ...[...files.entries()].map(([path, payload]) => ({
        path,
        bytes: payload,
      })),
    ], { compress: true });
    await expect(readArchiveStructure(rebuilt, ARCHIVE_LIMITS)).rejects
      .toMatchObject({ code: "archive/manifest-mismatch" });
  });
});

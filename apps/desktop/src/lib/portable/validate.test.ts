import { describe, expect, it } from "vitest";
import { buildArchive, sha256Hex } from "./archive.ts";
import { canonicalJsonBytes } from "./canonicalJson.ts";
import { assembleArchiveContent } from "./snapshot.ts";
import { validateArchive } from "./validate.ts";
import { ARCHIVE_LIMITS } from "./limits.ts";
import { buildZip } from "./zip.ts";
import type { LibraryArchiveManifestV1 } from "./types.ts";
import {
  figureHeavyLibraryFixture,
  fixtureUuid,
} from "./fixtures/libraries.ts";
import { gifBytes, pngBytes } from "./fixtures/images.ts";

/** Tasks 3.1/3.3/3.4/3.5: semantic validation of untrusted archives. */

const DEPS = { now: () => "2026-01-20T08:30:00.000Z", appVersion: "0.1.1" };

async function goldenArchive(): Promise<Uint8Array> {
  const fixture = figureHeavyLibraryFixture();
  return await buildArchive(
    assembleArchiveContent({
      essays: fixture.essays,
      library: fixture.library,
      assets: new Map(Object.entries(fixture.assets)),
    }),
    DEPS,
  );
}

/**
 * Rebuilds an archive from tampered payloads with a self-consistent manifest
 * (correct lengths/checksums), so structural checks pass and only semantic
 * validation can catch the problem. `patchManifest` may then skew manifest
 * fields deliberately.
 */
async function rebuildArchive(
  files: Map<string, Uint8Array>,
  patchManifest?: (m: LibraryArchiveManifestV1) => LibraryArchiveManifestV1,
): Promise<Uint8Array> {
  const paths = [...files.keys()].sort((a, b) => {
    const rank = (p: string) =>
      p === "library.json" ? 0 : p.startsWith("essays/") ? 1 : 2;
    return rank(a) - rank(b) || (a < b ? -1 : 1);
  });
  const essays = paths.filter((p) => p.startsWith("essays/"));
  const assets = paths.filter((p) => p.startsWith("assets/"));
  const library = files.get("library.json");
  const parsedLibrary = library
    ? JSON.parse(new TextDecoder().decode(library))
    : { references: [], collections: [] };
  let manifest: LibraryArchiveManifestV1 = {
    kind: "tesina-library",
    formatVersion: 1,
    createdAt: DEPS.now(),
    appVersion: DEPS.appVersion,
    encryption: null,
    counts: {
      essays: essays.length,
      references: parsedLibrary.references?.length ?? 0,
      collections: parsedLibrary.collections?.length ?? 0,
      assets: assets.length,
    },
    files: await Promise.all(paths.map(async (path) => ({
      path,
      mediaType: path.endsWith(".json")
        ? "application/json"
        : path.endsWith(".png")
        ? "image/png"
        : path.endsWith(".jpg")
        ? "image/jpeg"
        : path.endsWith(".gif")
        ? "image/gif"
        : path.endsWith(".bmp")
        ? "image/bmp"
        : "application/octet-stream",
      byteLength: files.get(path)!.length,
      sha256: await sha256Hex(files.get(path)!),
    }))),
  };
  if (patchManifest) manifest = patchManifest(manifest);
  return buildZip([
    { path: "manifest.json", bytes: canonicalJsonBytes(manifest) },
    ...paths.map((path) => ({ path, bytes: files.get(path)! })),
  ], { compress: true });
}

async function goldenFiles(): Promise<Map<string, Uint8Array>> {
  const bytes = await goldenArchive();
  const { readArchiveStructure } = await import("./archive.ts");
  const { files } = await readArchiveStructure(bytes, ARCHIVE_LIMITS);
  return files;
}

function mutateEssay(
  files: Map<string, Uint8Array>,
  mutate: (essay: Record<string, unknown>) => void,
): Map<string, Uint8Array> {
  const out = new Map(files);
  const path = [...out.keys()].find((p) => p.startsWith("essays/"))!;
  const essay = JSON.parse(new TextDecoder().decode(out.get(path)!));
  mutate(essay);
  out.set(path, canonicalJsonBytes(essay));
  return out;
}

async function expectCode(bytes: Uint8Array, code: string): Promise<void> {
  await expect(validateArchive(bytes, ARCHIVE_LIMITS)).rejects.toMatchObject({
    code,
  });
}

describe("validateArchive accepts the golden profile", () => {
  it("returns parsed essays, library, and measured assets", async () => {
    const result = await validateArchive(await goldenArchive(), ARCHIVE_LIMITS);
    expect(result.essays.length).toBe(12);
    expect(result.library.references.length).toBe(30);
    expect(result.assets.size).toBe(36);
    for (const asset of result.assets.values()) {
      expect(asset.width).toBeGreaterThan(0);
      expect(asset.height).toBeGreaterThan(0);
    }
  });
});

describe("container and grammar rejections (task 3.1)", () => {
  it("rejects an unknown top-level entry", async () => {
    const files = await goldenFiles();
    files.set("settings.json", canonicalJsonBytes({ leak: true }));
    await expectCode(await rebuildArchive(files), "validate/entry-path");
  });

  it("rejects a multi-dot asset extension", async () => {
    const files = await goldenFiles();
    files.set(
      `assets/${fixtureUuid(4, 500)}.tar.png`,
      pngBytes(4, 4),
    );
    await expectCode(await rebuildArchive(files), "validate/entry-path");
  });

  it("rejects an uppercase essay filename", async () => {
    const files = await goldenFiles();
    const anyEssay = [...files.keys()].find((p) => p.startsWith("essays/"))!;
    const payload = files.get(anyEssay)!;
    files.delete(anyEssay);
    files.set(anyEssay.toUpperCase().replace("ESSAYS", "essays"), payload);
    await expectCode(await rebuildArchive(files), "validate/entry-path");
  });

  it("rejects a missing manifest", async () => {
    const files = await goldenFiles();
    const bytes = buildZip(
      [...files.entries()].map(([path, payload]) => ({ path, bytes: payload })),
      { compress: true },
    );
    await expectCode(bytes, "archive/manifest-missing");
  });
});

describe("JSON shape and identifier rejections (task 3.3)", () => {
  it("rejects an essay schema version other than 2", async () => {
    const files = mutateEssay(await goldenFiles(), (e) => {
      e.schemaVersion = 3;
    });
    await expectCode(await rebuildArchive(files), "validate/essay-schema");
  });

  it("rejects a filename/payload essay id mismatch", async () => {
    const files = mutateEssay(await goldenFiles(), (e) => {
      e.id = fixtureUuid(2, 4000);
    });
    await expectCode(await rebuildArchive(files), "validate/essay-id-mismatch");
  });

  it("rejects a non-canonical imported sourceEssayId", async () => {
    const files = mutateEssay(await goldenFiles(), (e) => {
      e.sourceEssayId = "NOT-A-UUID";
    });
    await expectCode(await rebuildArchive(files), "validate/identifier");
  });

  it("rejects incomplete title-page and settings objects", async () => {
    const files = mutateEssay(await goldenFiles(), (e) => {
      e.titlePage = {};
      e.settings = {};
    });
    await expectCode(await rebuildArchive(files), "validate/essay-schema");
  });

  it("rejects unsupported settings enum values", async () => {
    const files = mutateEssay(await goldenFiles(), (e) => {
      (e.settings as Record<string, unknown>).documentLanguage = "fr";
    });
    await expectCode(await rebuildArchive(files), "validate/essay-schema");
  });

  it("rejects a ProseMirror document with an unsupported node", async () => {
    const files = mutateEssay(await goldenFiles(), (e) => {
      e.content = {
        type: "doc",
        content: [{
          type: "sectionBody",
          content: [{ type: "script", attrs: { src: "evil" } }],
        }],
      };
    });
    await expectCode(await rebuildArchive(files), "validate/essay-schema");
  });

  it("rejects malformed figure image attributes", async () => {
    const files = mutateEssay(await goldenFiles(), (essay) => {
      const walk = (value: unknown): boolean => {
        if (!value || typeof value !== "object") return false;
        const node = value as {
          type?: string;
          attrs?: unknown;
          content?: unknown[];
        };
        if (node.type === "figureImage") {
          node.attrs = { src: null, alt: 42 };
          return true;
        }
        return node.content?.some(walk) ?? false;
      };
      if (!walk(essay.content)) throw new Error("fixture has no figure");
    });
    await expectCode(await rebuildArchive(files), "validate/essay-schema");
  });

  it("rejects a non-string equation LaTeX attribute", async () => {
    const files = mutateEssay(await goldenFiles(), (essay) => {
      essay.content = {
        type: "doc",
        content: [{
          type: "sectionBody",
          content: [{ type: "apaEquation", attrs: { latex: { raw: "x" } } }],
        }],
      };
    });
    await expectCode(await rebuildArchive(files), "validate/essay-schema");
  });

  it("rejects unsafe table spans and malformed column widths", async () => {
    for (
      const attrs of [
        { colspan: 1_000_000, rowspan: 1, colwidth: null },
        { colspan: 2, rowspan: 1, colwidth: [120] },
        { colspan: 1, rowspan: 1, colwidth: [-1] },
      ]
    ) {
      const files = mutateEssay(await goldenFiles(), (essay) => {
        essay.content = {
          type: "doc",
          content: [{
            type: "sectionBody",
            content: [{
              type: "apaTable",
              content: [
                { type: "tableTitle" },
                {
                  type: "table",
                  content: [{
                    type: "tableRow",
                    content: [{
                      type: "tableCell",
                      attrs,
                      content: [{ type: "paragraph" }],
                    }],
                  }],
                },
                { type: "tableNote" },
              ],
            }],
          }],
        };
      });
      await expectCode(await rebuildArchive(files), "validate/essay-schema");
    }
  });

  it("rejects a table whose aggregate logical grid is too wide", async () => {
    const cells = Array.from({ length: 11 }, () => ({
      type: "tableCell",
      attrs: { colspan: 1_000, rowspan: 1, colwidth: null },
      content: [{ type: "paragraph" }],
    }));
    const files = mutateEssay(await goldenFiles(), (essay) => {
      essay.content = {
        type: "doc",
        content: [{
          type: "sectionBody",
          content: [{
            type: "apaTable",
            content: [
              { type: "tableTitle" },
              {
                type: "table",
                content: [{ type: "tableRow", content: cells }],
              },
              { type: "tableNote" },
            ],
          }],
        }],
      };
    });

    await expectCode(await rebuildArchive(files), "validate/essay-schema");
  });

  it("rejects a malformed shared library", async () => {
    const files = await goldenFiles();
    files.set(
      "library.json",
      canonicalJsonBytes({ schemaVersion: 1, references: "nope" }),
    );
    await expectCode(await rebuildArchive(files), "validate/library-schema");
  });

  it("rejects incomplete and unsupported reference variants", async () => {
    const files = await goldenFiles();
    const library = JSON.parse(
      new TextDecoder().decode(files.get("library.json")!),
    );
    library.references[0] = {
      id: library.references[0].id,
      type: "madeUpSource",
      title: "Incomplete",
    };
    files.set("library.json", canonicalJsonBytes(library));
    await expectCode(await rebuildArchive(files), "validate/library-schema");
  });

  it("rejects duplicate reference ids in the shared library", async () => {
    const files = await goldenFiles();
    const library = JSON.parse(
      new TextDecoder().decode(files.get("library.json")!),
    );
    library.references.push({
      ...library.references[0],
      title: "Conflicting duplicate reference",
    });
    files.set("library.json", canonicalJsonBytes(library));

    await expectCode(await rebuildArchive(files), "validate/library-schema");
  });

  it("rejects malformed snapshot references", async () => {
    const files = mutateEssay(await goldenFiles(), (essay) => {
      const references = essay.referencesSnapshot as Record<string, unknown>[];
      references[0] = {
        id: references[0]!.id,
        type: "book",
        title: "Missing authors and date",
      };
    });
    await expectCode(await rebuildArchive(files), "validate/essay-schema");
  });

  it("rejects malformed citation attributes", async () => {
    const files = mutateEssay(await goldenFiles(), (essay) => {
      const doc = essay.content as { content: unknown[] };
      const walk = (value: unknown): boolean => {
        if (!value || typeof value !== "object") return false;
        const node = value as {
          type?: string;
          attrs?: unknown;
          content?: unknown[];
        };
        if (node.type === "citation") {
          node.attrs = { items: null, mode: "parenthetical" };
          return true;
        }
        return node.content?.some(walk) ?? false;
      };
      if (!walk(doc)) throw new Error("fixture has no citation");
    });
    await expectCode(await rebuildArchive(files), "validate/essay-schema");
  });

  it("rejects a collection with a malformed member list", async () => {
    const files = await goldenFiles();
    const library = JSON.parse(
      new TextDecoder().decode(files.get("library.json")!),
    );
    library.collections[0].refIds = "all";
    files.set("library.json", canonicalJsonBytes(library));
    await expectCode(await rebuildArchive(files), "validate/library-schema");
  });

  it("rejects a non-canonical reference identifier", async () => {
    const files = await goldenFiles();
    const library = JSON.parse(
      new TextDecoder().decode(files.get("library.json")!),
    );
    // Fixture UUIDs are digit-only, so uppercase them explicitly via a hex id.
    library.references[0].id = "0F8FAD5B-D9CB-469F-A165-70867728950E";
    files.set("library.json", canonicalJsonBytes(library));
    await expectCode(await rebuildArchive(files), "validate/identifier");
  });

  it("rejects manifest counts that disagree with the payload", async () => {
    const files = await goldenFiles();
    const bytes = await rebuildArchive(files, (m) => ({
      ...m,
      counts: { ...m.counts, essays: m.counts.essays + 1 },
    }));
    await expectCode(bytes, "validate/counts-mismatch");
  });

  it("rejects JSON beyond the complexity limits", async () => {
    let deep: unknown = "x";
    for (let i = 0; i <= ARCHIVE_LIMITS.maxJsonDepth; i += 1) {
      deep = { d: deep };
    }
    const files = mutateEssay(await goldenFiles(), (e) => {
      e.content = deep;
    });
    await expectCode(await rebuildArchive(files), "validate/json-limits");
  });
});

describe("image validation (task 3.3)", () => {
  it("rejects a signature that disagrees with the extension", async () => {
    const files = await goldenFiles();
    const jpgPath = [...files.keys()].find((p) => p.endsWith(".jpg"))!;
    files.set(jpgPath, pngBytes(8, 8));
    await expectCode(await rebuildArchive(files), "validate/image-signature");
  });

  it("rejects a manifest media type that disagrees with the extension", async () => {
    const files = await goldenFiles();
    const pngPath = [...files.keys()].find((p) => p.endsWith(".png"))!;
    const bytes = await rebuildArchive(files, (m) => ({
      ...m,
      files: m.files.map((f) =>
        f.path === pngPath ? { ...f, mediaType: "image/jpeg" } : f
      ),
    }));
    await expectCode(bytes, "validate/media-type");
  });

  it("rejects an unsupported figure extension", async () => {
    const files = await goldenFiles();
    files.set(`assets/${fixtureUuid(4, 700)}.tif`, pngBytes(4, 4));
    await expectCode(await rebuildArchive(files), "validate/asset-extension");
  });

  it("rejects dimensions beyond the limit", async () => {
    const files = await goldenFiles();
    const pngPath = [...files.keys()].find((p) => p.endsWith(".png"))!;
    files.set(pngPath, pngBytes(ARCHIVE_LIMITS.maxImageDimension + 1, 4));
    await expectCode(await rebuildArchive(files), "validate/image-limit");
  });

  it("rejects a frame count beyond the limit", async () => {
    const files = await goldenFiles();
    const gifPath = [...files.keys()].find((p) => p.endsWith(".gif"))!;
    files.set(gifPath, gifBytes(4, 4, 12));
    const bytes = await rebuildArchive(files);
    await expect(
      validateArchive(bytes, { ...ARCHIVE_LIMITS, maxImageFrames: 8 }),
    ).rejects.toMatchObject({ code: "validate/image-limit" });
  });

  it("rejects cumulative decoded pixels beyond the limit", async () => {
    const bytes = await rebuildArchive(await goldenFiles());
    await expect(
      validateArchive(bytes, {
        ...ARCHIVE_LIMITS,
        maxTotalDecodedPixels: 1_000,
      }),
    ).rejects.toMatchObject({ code: "validate/image-limit" });
  });
});

describe("relationship validation (task 3.3 + amended spec)", () => {
  it("rejects an essay figure pointing at a missing asset", async () => {
    const files = await goldenFiles();
    const gone = [...files.keys()].find((p) => p.startsWith("assets/"))!;
    files.delete(gone);
    await expectCode(await rebuildArchive(files), "validate/missing-asset");
  });

  it("rejects a citation that resolves nowhere in the archive", async () => {
    const files = mutateEssay(await goldenFiles(), (e) => {
      const doc = e.content as {
        content: {
          content: {
            type: string;
            attrs?: unknown;
            content?: { type: string; attrs?: unknown }[];
          }[];
        }[];
      };
      doc.content[0].content.push({
        type: "paragraph",
        content: [{
          type: "citation",
          attrs: {
            items: [{ refId: fixtureUuid(1, 9990) }],
            mode: "parenthetical",
          },
        }],
      });
      e.referencesSnapshot = [];
    });
    await expectCode(
      await rebuildArchive(files),
      "validate/unresolved-citation",
    );
  });

  it("accepts a citation resolved only by the essay's own snapshot", async () => {
    // Reference 13 is cited by essay 11 (snapshot carries a copy) and sits in
    // no collection; removing it from the shared library must still validate
    // because the essay's denormalized snapshot resolves the citation.
    const files = await goldenFiles();
    const library = JSON.parse(
      new TextDecoder().decode(files.get("library.json")!),
    );
    const removedId = fixtureUuid(1, 13);
    library.references = library.references.filter(
      (r: { id: string }) => r.id !== removedId,
    );
    files.set("library.json", canonicalJsonBytes(library));
    const result = await validateArchive(
      await rebuildArchive(files),
      ARCHIVE_LIMITS,
    );
    expect(result.library.references.some((r) => r.id === removedId)).toBe(
      false,
    );
  });

  it("rejects a collection member that resolves nowhere", async () => {
    const files = await goldenFiles();
    const library = JSON.parse(
      new TextDecoder().decode(files.get("library.json")!),
    );
    library.collections[0].refIds.push(fixtureUuid(1, 9991));
    files.set("library.json", canonicalJsonBytes(library));
    await expectCode(
      await rebuildArchive(files),
      "validate/unresolved-collection-member",
    );
  });
});

describe("entry mutation sweep (task 3.5)", () => {
  it("rejects every archive with one corrupted entry payload", async () => {
    const pristine = await goldenArchive();
    const { readZipEntries } = await import("./zip.ts");
    const entries = readZipEntries(pristine, ARCHIVE_LIMITS);
    for (const entry of entries) {
      const corrupted = pristine.slice();
      const dataStart = entry.localHeaderOffset + 30 + entry.path.length;
      const target = dataStart + Math.floor(entry.compressedSize / 2);
      corrupted[target] ^= 0x55;
      await expect(
        validateArchive(corrupted, ARCHIVE_LIMITS),
        `entry ${entry.path} should fail closed`,
      ).rejects.toMatchObject({
        code: expect.stringMatching(/^(zip|archive|validate|limits)\//),
      });
    }
  });
});

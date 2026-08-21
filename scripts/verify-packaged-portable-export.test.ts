import { describe, expect, it } from "vitest";
import { buildArchive } from "../apps/desktop/src/lib/portable/archive.ts";
import { fullLibraryFixture } from "../apps/desktop/src/lib/portable/fixtures/libraries.ts";
import { pngBytes } from "../apps/desktop/src/lib/portable/fixtures/images.ts";
import { assembleArchiveContent } from "../apps/desktop/src/lib/portable/snapshot.ts";
import {
  verifyPackagedPortableExport,
} from "./verify-packaged-portable-export.ts";

const APP_VERSION = "0.1.19";

async function fixtureArchive(
  mutate?: (content: ReturnType<typeof assembleArchiveContent>) => void,
): Promise<Uint8Array> {
  const fixture = fullLibraryFixture();
  const content = assembleArchiveContent({
    essays: fixture.essays,
    library: fixture.library,
    assets: new Map(Object.entries(fixture.assets)),
  });
  mutate?.(content);
  return await buildArchive(content, {
    now: () => "2026-08-18T12:00:00.000Z",
    appVersion: APP_VERSION,
  });
}

describe("packaged portable export verification", () => {
  it("accepts the exact full persisted-library fixture", async () => {
    const result = await verifyPackagedPortableExport(
      await fixtureArchive(),
      fullLibraryFixture(),
      APP_VERSION,
    );

    expect(result).toMatchObject({
      passed: true,
      counts: { essays: 16, references: 30, collections: 1, assets: 38 },
      relationships: { citationNodes: 54, citationItems: 63, figures: 38 },
    });
  });

  it("rejects valid archives whose figure bytes differ from persisted data", async () => {
    const bytes = await fixtureArchive((content) => {
      const path = [...content.assets.keys()].find((candidate) =>
        candidate.endsWith(".png")
      )!;
      content.assets.set(path, pngBytes(31, 29));
    });

    await expect(verifyPackagedPortableExport(
      bytes,
      fullLibraryFixture(),
      APP_VERSION,
    )).rejects.toThrow("figure bytes");
  });

  it("rejects changed references and collections even when the archive validates", async () => {
    const changedReference = await fixtureArchive((content) => {
      content.library.references[0] = {
        ...content.library.references[0],
        title: "Changed reference",
      };
    });
    await expect(verifyPackagedPortableExport(
      changedReference,
      fullLibraryFixture(),
      APP_VERSION,
    )).rejects.toThrow("shared references");

    const changedCollection = await fixtureArchive((content) => {
      const collection = content.library.collections![0]!;
      content.library.collections![0] = {
        ...collection,
        refIds: [...collection.refIds].reverse(),
      };
    });
    await expect(verifyPackagedPortableExport(
      changedCollection,
      fullLibraryFixture(),
      APP_VERSION,
    )).rejects.toThrow("collections");
  });

  it("rejects an otherwise valid archive that includes an orphan asset", async () => {
    const fixture = fullLibraryFixture();
    const orphan = Object.entries(fixture.orphanAssets)[0]!;
    const bytes = await fixtureArchive((content) => {
      content.assets.set(orphan[0].replace("essays/", ""), orphan[1]);
    });

    await expect(verifyPackagedPortableExport(
      bytes,
      fixture,
      APP_VERSION,
    )).rejects.toThrow("manifest counts");
  });
});

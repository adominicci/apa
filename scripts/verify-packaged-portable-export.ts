import type { LibraryFixture } from "../apps/desktop/src/lib/portable/fixtures/libraries.ts";
import { canonicalJsonText } from "../apps/desktop/src/lib/portable/canonicalJson.ts";
import { ARCHIVE_LIMITS } from "../apps/desktop/src/lib/portable/limits.ts";
import { assembleArchiveContent } from "../apps/desktop/src/lib/portable/snapshot.ts";
import { validateArchive } from "../apps/desktop/src/lib/portable/validate.ts";
import { inspectPortableLibraryEvidence } from "./inspect-portable-library-evidence.ts";

export interface PackagedPortableExportEvidence {
  passed: true;
  evidence: "packaged-portable-export-reopen";
  counts: {
    essays: number;
    references: number;
    collections: number;
    assets: number;
  };
  relationships: {
    citationNodes: number;
    citationItems: number;
    figures: number;
  };
  assetBytes: number;
  assetAggregateSha256: string;
}

function equalJson(left: unknown, right: unknown): boolean {
  return canonicalJsonText(left) === canonicalJsonText(right);
}

function requireEqual(label: string, left: unknown, right: unknown): void {
  if (!equalJson(left, right)) {
    throw new Error(`packaged portable export changed ${label}`);
  }
}

/** Independently reopens the package-produced archive and checks exact data. */
export async function verifyPackagedPortableExport(
  bytes: Uint8Array,
  fixture: LibraryFixture,
  appVersion: string,
): Promise<PackagedPortableExportEvidence> {
  const validated = await validateArchive(bytes, ARCHIVE_LIMITS);
  const expected = assembleArchiveContent({
    essays: fixture.essays,
    library: fixture.library,
    assets: new Map(Object.entries(fixture.assets)),
  });
  const expectedCounts = {
    essays: expected.essays.length,
    references: expected.library.references.length,
    collections: expected.library.collections?.length ?? 0,
    assets: expected.assets.size,
  };

  requireEqual("manifest counts", validated.manifest.counts, expectedCounts);
  if (validated.manifest.appVersion !== appVersion) {
    throw new Error("packaged portable export used the wrong app version");
  }
  if (validated.manifest.backup !== undefined) {
    throw new Error(
      "packaged portable export was incorrectly marked as a backup",
    );
  }
  requireEqual(
    "shared references",
    validated.library.references,
    expected.library.references,
  );
  requireEqual(
    "collections",
    validated.library.collections,
    expected.library.collections ?? [],
  );
  requireEqual("essays and citations", validated.essays, expected.essays);

  const actualPaths = [...validated.assets.keys()].sort();
  const expectedPaths = [...expected.assets.keys()].sort();
  requireEqual("figure asset paths", actualPaths, expectedPaths);
  for (const path of expectedPaths) {
    const actual = validated.assets.get(path)?.bytes;
    const expectedBytes = expected.assets.get(path);
    if (
      actual === undefined || expectedBytes === undefined ||
      actual.byteLength !== expectedBytes.byteLength ||
      actual.some((byte, index) => byte !== expectedBytes[index])
    ) {
      throw new Error(`packaged portable export changed figure bytes: ${path}`);
    }
  }

  const inspected = await inspectPortableLibraryEvidence(bytes);
  return {
    passed: true,
    evidence: "packaged-portable-export-reopen",
    counts: inspected.manifest.counts,
    relationships: inspected.relationships,
    assetBytes: inspected.assets.byteLength,
    assetAggregateSha256: inspected.assets.aggregateSha256,
  };
}

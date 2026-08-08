/**
 * Content-library digest (design §9, task 9.2): one hash over sorted essay
 * semantic digests, the shared library content, and reachable asset hashes.
 * Timestamps (`updatedAt`, `importedAt`), UI settings, backup state, orphan
 * assets, and deleted backups never enter the digest, so it changes exactly
 * when a backup would contain different content.
 */

import { canonicalJsonBytes } from "./canonicalJson.ts";
import { sha256Hex } from "./archive.ts";
import { essaySemanticDigest } from "./semantic.ts";
import type { LibrarySnapshotContent } from "./types.ts";

export async function computeContentDigest(
  content: Pick<LibrarySnapshotContent, "essays" | "library"> & {
    /** Hash per reachable asset (any stable keying). */
    assetHashes: Iterable<string>;
  },
): Promise<string> {
  const essayDigests = await Promise.all(
    content.essays.map((essay) => essaySemanticDigest(essay)),
  );
  const libraryDigest = await sha256Hex(canonicalJsonBytes({
    references: content.library.references,
    collections: content.library.collections ?? [],
  }));
  return await sha256Hex(canonicalJsonBytes({
    essays: essayDigests.sort(),
    library: libraryDigest,
    assets: [...content.assetHashes].sort(),
  }));
}

/** Digest of a captured snapshot (hashes its asset bytes first). */
export async function snapshotContentDigest(
  snapshot: LibrarySnapshotContent,
): Promise<string> {
  const assetHashes = await Promise.all(
    [...snapshot.assets.values()].map((bytes) => sha256Hex(bytes)),
  );
  return await computeContentDigest({
    essays: snapshot.essays,
    library: snapshot.library,
    assetHashes,
  });
}

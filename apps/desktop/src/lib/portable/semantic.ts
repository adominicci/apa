/**
 * Semantic identity digests (design §5): what "the same content" means for
 * Merge import, defined separately from persistence timestamps. An essay's
 * digest covers only its semantic fields — `updatedAt` and the import
 * provenance fields (`importedAt`, `sourceEssayId`) never create false
 * conflicts. Pure: canonical JSON bytes hashed with Web Crypto SHA-256.
 */

import type { Reference } from "@tesina/engine";
import type { Essay } from "$lib/model/essay";
import type { RefCollection } from "$lib/model/collections";
import { sha256Hex } from "./archive.ts";
import { canonicalJsonBytes } from "./canonicalJson.ts";

/**
 * Digest of an essay's semantic fields only: `schemaVersion`, `id`,
 * `createdAt`, `settings`, `titlePage`, `content`, `referencesSnapshot`.
 */
export function essaySemanticDigest(essay: Essay): Promise<string> {
  return sha256Hex(canonicalJsonBytes({
    schemaVersion: essay.schemaVersion,
    id: essay.id,
    createdAt: essay.createdAt,
    settings: essay.settings,
    titlePage: essay.titlePage,
    content: essay.content,
    referencesSnapshot: essay.referencesSnapshot,
  }));
}

/** Digest of the full canonical reference content, including its id. */
export function referenceDigest(reference: Reference): Promise<string> {
  return sha256Hex(canonicalJsonBytes(reference));
}

/** Digest of a collection's id, name, and sorted unique member ids. */
export function collectionDigest(collection: RefCollection): Promise<string> {
  return sha256Hex(canonicalJsonBytes({
    id: collection.id,
    name: collection.name,
    refIds: [...new Set(collection.refIds)].sort(),
  }));
}

/**
 * Full semantic validation of an untrusted `.tesina` archive (design §4).
 * Layers on the structural reader: entry grammar, manifest counts, JSON
 * complexity and shapes, canonical identifiers, filename/payload binding,
 * bounded image headers, and complete relationship resolution (figures,
 * citations, snapshots, collection members). Discriminated `code` values are
 * the localization keys the UI maps to Paraglide messages.
 */

import type { Reference } from "@tesina/engine";
import type { Essay } from "$lib/model/essay";
import type { RefCollection } from "$lib/model/collections";
import {
  type ArchiveLimits,
  assertJsonWithinLimits,
  LimitError,
} from "./limits.ts";
import { readArchiveStructure } from "./archive.ts";
import { collectFigureSources } from "./snapshot.ts";
import {
  IMAGE_MEDIA_TYPES,
  type ImageHeader,
  ImageHeaderError,
  readImageHeader,
  SUPPORTED_IMAGE_EXTENSIONS,
} from "./imageHeaders.ts";
import { isCanonicalUuid, parseArchiveEntryPath, PathError } from "./paths.ts";
import {
  ArchiveError,
  type LibraryArchiveManifestV1,
  type SharedLibraryFile,
} from "./types.ts";

export class ValidateError extends Error {
  readonly code: string;
  readonly detail?: string;
  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = "ValidateError";
    this.code = code;
    this.detail = detail;
  }
}

export interface ValidatedAsset {
  bytes: Uint8Array;
  extension: string;
  width: number;
  height: number;
  frames: number;
  sha256: string;
}

export interface ValidatedArchive {
  manifest: LibraryArchiveManifestV1;
  essays: Essay[];
  library: Required<Pick<SharedLibraryFile, "schemaVersion" | "references">> & {
    collections: RefCollection[];
  };
  /** Keyed by archive path (`assets/<uuid>.<ext>`). */
  assets: Map<string, ValidatedAsset>;
}

function parseJsonPayload(
  bytes: Uint8Array,
  limits: ArchiveLimits,
  where: string,
): unknown {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ValidateError(
      "validate/json-parse",
      "payload is not JSON",
      where,
    );
  }
  try {
    assertJsonWithinLimits(value, limits);
  } catch (error) {
    if (error instanceof LimitError) {
      throw new ValidateError(
        "validate/json-limits",
        "payload exceeds JSON complexity limits",
        `${where}: ${error.code}`,
      );
    }
    throw error;
  }
  return value;
}

function requireCanonicalId(value: unknown, where: string): string {
  if (typeof value !== "string" || !isCanonicalUuid(value)) {
    throw new ValidateError(
      "validate/identifier",
      "an identifier is not a canonical lowercase UUID",
      where,
    );
  }
  return value;
}

function validateLibraryPayload(
  value: unknown,
  where: string,
): ValidatedArchive["library"] {
  const lib = value as Partial<SharedLibraryFile>;
  if (
    lib === null || typeof lib !== "object" || lib.schemaVersion !== 1 ||
    !Array.isArray(lib.references) ||
    (lib.collections !== undefined && !Array.isArray(lib.collections))
  ) {
    throw new ValidateError(
      "validate/library-schema",
      "library.json is not a valid schema-version-1 library",
      where,
    );
  }
  for (const reference of lib.references) {
    if (
      reference === null || typeof reference !== "object" ||
      typeof (reference as Reference).type !== "string" ||
      typeof (reference as Reference).title !== "string"
    ) {
      throw new ValidateError(
        "validate/library-schema",
        "a reference entry is malformed",
        where,
      );
    }
    requireCanonicalId((reference as Reference).id, `${where}: reference id`);
  }
  const collections = lib.collections ?? [];
  for (const collection of collections) {
    if (
      collection === null || typeof collection !== "object" ||
      typeof (collection as RefCollection).name !== "string" ||
      !Array.isArray((collection as RefCollection).refIds)
    ) {
      throw new ValidateError(
        "validate/library-schema",
        "a collection entry is malformed",
        where,
      );
    }
    requireCanonicalId(
      (collection as RefCollection).id,
      `${where}: collection id`,
    );
    for (const refId of (collection as RefCollection).refIds) {
      if (typeof refId !== "string") {
        throw new ValidateError(
          "validate/library-schema",
          "a collection member id is malformed",
          where,
        );
      }
    }
  }
  return {
    schemaVersion: 1,
    references: lib.references as Reference[],
    collections: collections as RefCollection[],
  };
}

function validateEssayPayload(
  value: unknown,
  expectedId: string,
  where: string,
): Essay {
  const essay = value as Partial<Essay> & {
    importedAt?: unknown;
    sourceEssayId?: unknown;
  };
  if (
    essay === null || typeof essay !== "object" || essay.schemaVersion !== 2
  ) {
    throw new ValidateError(
      "validate/essay-schema",
      "an essay payload is not schema version 2",
      where,
    );
  }
  const id = requireCanonicalId(essay.id, `${where}: essay id`);
  if (id !== expectedId) {
    throw new ValidateError(
      "validate/essay-id-mismatch",
      "essay id disagrees with its archive entry name",
      where,
    );
  }
  if (
    typeof essay.createdAt !== "string" ||
    typeof essay.updatedAt !== "string" ||
    typeof essay.settings !== "object" || essay.settings === null ||
    typeof essay.titlePage !== "object" || essay.titlePage === null ||
    essay.content === undefined || !Array.isArray(essay.referencesSnapshot)
  ) {
    throw new ValidateError(
      "validate/essay-schema",
      "an essay payload is missing required fields",
      where,
    );
  }
  if (essay.importedAt !== undefined && typeof essay.importedAt !== "string") {
    throw new ValidateError(
      "validate/essay-schema",
      "importedAt must be a string when present",
      where,
    );
  }
  if (essay.sourceEssayId !== undefined) {
    requireCanonicalId(essay.sourceEssayId, `${where}: sourceEssayId`);
  }
  for (const reference of essay.referencesSnapshot) {
    if (reference === null || typeof reference !== "object") {
      throw new ValidateError(
        "validate/essay-schema",
        "a snapshot reference is malformed",
        where,
      );
    }
    requireCanonicalId(
      (reference as Reference).id,
      `${where}: snapshot reference id`,
    );
  }
  return essay as Essay;
}

interface DocNode {
  type?: string;
  attrs?: { items?: { refId?: unknown }[] };
  content?: unknown[];
}

function collectCitationRefIds(docJson: unknown): string[] {
  const ids: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as DocNode;
    if (n.type === "citation" && Array.isArray(n.attrs?.items)) {
      for (const item of n.attrs.items) {
        if (item && typeof item.refId === "string") ids.push(item.refId);
      }
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) {
        walk(child);
      }
    }
  };
  walk(docJson);
  return ids;
}

/** Validates untrusted archive bytes end to end. Throws on the first defect. */
export async function validateArchive(
  bytes: Uint8Array,
  limits: ArchiveLimits,
): Promise<ValidatedArchive> {
  const { manifest, files } = await readArchiveStructure(bytes, limits);
  const records = new Map(manifest.files.map((f) => [f.path, f]));

  // 1. Entry grammar; collect the typed sets.
  const essayIds: string[] = [];
  const assetPaths = new Map<string, string>(); // path -> extension
  let hasLibrary = false;
  for (const path of files.keys()) {
    let parsed;
    try {
      parsed = parseArchiveEntryPath(path);
    } catch (error) {
      if (error instanceof PathError) {
        throw new ValidateError(
          "validate/entry-path",
          "an archive entry is outside the allowed path grammar",
          path,
        );
      }
      throw error;
    }
    if (parsed.kind === "library") hasLibrary = true;
    if (parsed.kind === "essay") essayIds.push(parsed.id);
    if (parsed.kind === "asset") {
      if (!SUPPORTED_IMAGE_EXTENSIONS[parsed.extension]) {
        throw new ValidateError(
          "validate/asset-extension",
          "an asset uses an unsupported figure extension",
          path,
        );
      }
      assetPaths.set(path, parsed.extension);
    }
  }
  if (!hasLibrary) {
    throw new ValidateError(
      "validate/library-missing",
      "the archive has no library.json",
    );
  }

  // 2. Entity count limits.
  if (essayIds.length > limits.maxEssays) {
    throw new ValidateError("validate/entity-limit", "too many essays");
  }
  if (assetPaths.size > limits.maxAssets) {
    throw new ValidateError("validate/entity-limit", "too many assets");
  }

  // 3. Library payload.
  const library = validateLibraryPayload(
    parseJsonPayload(files.get("library.json")!, limits, "library.json"),
    "library.json",
  );
  if (library.references.length > limits.maxReferences) {
    throw new ValidateError("validate/entity-limit", "too many references");
  }
  if (library.collections.length > limits.maxCollections) {
    throw new ValidateError("validate/entity-limit", "too many collections");
  }

  // 4. Essay payloads.
  const essays: Essay[] = [];
  for (const id of essayIds) {
    const path = `essays/${id}.json`;
    essays.push(
      validateEssayPayload(
        parseJsonPayload(files.get(path)!, limits, path),
        id,
        path,
      ),
    );
  }

  // 5. Image headers under the decoded-cost limits.
  const assets = new Map<string, ValidatedAsset>();
  let totalPixels = 0;
  for (const [path, extension] of assetPaths) {
    const payload = files.get(path)!;
    const record = records.get(path)!;
    let header: ImageHeader;
    try {
      header = readImageHeader(payload, extension, limits.maxImageFrames);
    } catch (error) {
      if (error instanceof ImageHeaderError) {
        throw new ValidateError(
          "validate/image-signature",
          "an asset's bytes do not match its declared format",
          path,
        );
      }
      throw error;
    }
    if (record.mediaType !== IMAGE_MEDIA_TYPES[header.kind]) {
      throw new ValidateError(
        "validate/media-type",
        "a manifest media type disagrees with the asset format",
        path,
      );
    }
    if (
      header.width > limits.maxImageDimension ||
      header.height > limits.maxImageDimension ||
      header.frames > limits.maxImageFrames ||
      header.width * header.height > limits.maxImagePixels
    ) {
      throw new ValidateError(
        "validate/image-limit",
        "an image exceeds the supported dimensions or frame count",
        path,
      );
    }
    totalPixels += header.width * header.height * Math.max(1, header.frames);
    if (totalPixels > limits.maxTotalDecodedPixels) {
      throw new ValidateError(
        "validate/image-limit",
        "the archive's cumulative decoded pixels exceed the safety limit",
        path,
      );
    }
    assets.set(path, {
      bytes: payload,
      extension,
      width: header.width,
      height: header.height,
      frames: header.frames,
      sha256: record.sha256,
    });
  }

  // 6. Manifest counts must agree with the validated payload.
  if (
    manifest.counts.essays !== essays.length ||
    manifest.counts.references !== library.references.length ||
    manifest.counts.collections !== library.collections.length ||
    manifest.counts.assets !== assets.size
  ) {
    throw new ValidateError(
      "validate/counts-mismatch",
      "manifest counts disagree with the archive content",
    );
  }

  // 7. Relationships: figures, citations, collection members.
  const referenceIds = new Set(library.references.map((r) => r.id));
  for (const essay of essays) {
    let figures = 0;
    for (const src of collectFigureSources(essay.content)) {
      figures += 1;
      if (!assets.has(src)) {
        throw new ValidateError(
          "validate/missing-asset",
          "an essay references a figure that is not in the archive",
          `${essay.id}: ${src}`,
        );
      }
    }
    if (figures > limits.maxFiguresPerEssay) {
      throw new ValidateError(
        "validate/entity-limit",
        "an essay exceeds the figure limit",
        essay.id,
      );
    }
    const snapshotIds = new Set(essay.referencesSnapshot.map((r) => r.id));
    for (const refId of collectCitationRefIds(essay.content)) {
      if (!referenceIds.has(refId) && !snapshotIds.has(refId)) {
        throw new ValidateError(
          "validate/unresolved-citation",
          "a citation references an id that resolves nowhere in the archive",
          `${essay.id}: ${refId}`,
        );
      }
    }
  }
  for (const collection of library.collections) {
    for (const refId of collection.refIds) {
      if (!referenceIds.has(refId)) {
        throw new ValidateError(
          "validate/unresolved-collection-member",
          "a collection member resolves nowhere in the archive",
          `${collection.id}: ${refId}`,
        );
      }
    }
  }

  return { manifest, essays, library, assets };
}

export { ArchiveError };

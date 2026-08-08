/**
 * Deterministic `.tesina` archive build/read orchestration (design §1/§2/§4).
 * Pure: all inputs are injected; bytes in, bytes out. The builder reopens its
 * own output through the structural reader before returning it (task 2.6);
 * the full semantic validator (validate.ts) layers on top of this reader.
 */

import type { ArchiveLimits } from "./limits.ts";
import { canonicalJsonBytes } from "./canonicalJson.ts";
import { buildZip, extractZipEntry, readZipEntries } from "./zip.ts";
import {
  type ArchiveBuildDeps,
  type ArchiveContent,
  ArchiveError,
  type ArchiveFileRecord,
  type LibraryArchiveManifestV1,
} from "./types.ts";
import { ARCHIVE_LIMITS } from "./limits.ts";

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const MEDIA_TYPES: Record<string, string> = {
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
};

function mediaTypeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return MEDIA_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Builds deterministic archive bytes: entry order is manifest, library,
 * essays sorted by id, assets sorted by path; all JSON is canonical.
 */
export async function buildArchive(
  content: ArchiveContent,
  deps: ArchiveBuildDeps,
): Promise<Uint8Array> {
  const payloads: { path: string; bytes: Uint8Array }[] = [
    { path: "library.json", bytes: canonicalJsonBytes(content.library) },
  ];
  for (
    const essay of [...content.essays].sort((a, b) => a.id.localeCompare(b.id))
  ) {
    payloads.push({
      path: `essays/${essay.id}.json`,
      bytes: canonicalJsonBytes(essay),
    });
  }
  for (
    const [path, bytes] of [...content.assets.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  ) {
    payloads.push({ path, bytes });
  }

  const files: ArchiveFileRecord[] = [];
  for (const payload of payloads) {
    files.push({
      path: payload.path,
      mediaType: mediaTypeFor(payload.path),
      byteLength: payload.bytes.length,
      sha256: await sha256Hex(payload.bytes),
    });
  }

  const manifest: LibraryArchiveManifestV1 = {
    kind: "tesina-library",
    formatVersion: 1,
    createdAt: deps.now(),
    appVersion: deps.appVersion,
    encryption: null,
    ...(deps.backupSetId ? { backup: { backupSetId: deps.backupSetId } } : {}),
    counts: {
      essays: content.essays.length,
      references: content.library.references.length,
      collections: content.library.collections?.length ?? 0,
      assets: content.assets.size,
    },
    files,
  };

  const bytes = buildZip(
    [
      { path: "manifest.json", bytes: canonicalJsonBytes(manifest) },
      ...payloads,
    ],
    {
      compress: true,
      maxCompressionRatio: ARCHIVE_LIMITS.maxCompressionRatio,
      compressionRatioExemptBytes: ARCHIVE_LIMITS.compressionRatioExemptBytes,
    },
  );

  // Reopen gate: no archive leaves the builder without passing the reader.
  await readArchiveStructure(bytes, ARCHIVE_LIMITS);
  return bytes;
}

export interface ArchiveStructure {
  manifest: LibraryArchiveManifestV1;
  /** Payload bytes by archive path; excludes `manifest.json` itself. */
  files: Map<string, Uint8Array>;
}

function parseManifest(bytes: Uint8Array): LibraryArchiveManifestV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ArchiveError("archive/manifest-json", "manifest is not JSON");
  }
  const m = parsed as Partial<LibraryArchiveManifestV1>;
  if (m?.kind !== "tesina-library") {
    throw new ArchiveError(
      "archive/manifest-kind",
      "the file is not a Tesina library archive",
    );
  }
  if (typeof m.formatVersion !== "number" || m.formatVersion !== 1) {
    throw new ArchiveError(
      "archive/format-version",
      "the archive declares an unsupported format version",
      String(m.formatVersion),
    );
  }
  if (
    !Array.isArray(m.files) ||
    typeof m.createdAt !== "string" || typeof m.appVersion !== "string" ||
    m.encryption !== null || typeof m.counts !== "object" || m.counts === null
  ) {
    throw new ArchiveError(
      "archive/manifest-shape",
      "the manifest is missing required fields",
    );
  }
  for (const record of m.files) {
    if (
      typeof record?.path !== "string" ||
      typeof record.mediaType !== "string" ||
      typeof record.byteLength !== "number" ||
      typeof record.sha256 !== "string"
    ) {
      throw new ArchiveError(
        "archive/manifest-shape",
        "a manifest file record is malformed",
      );
    }
  }
  return m as LibraryArchiveManifestV1;
}

/**
 * Structural read: bounded ZIP intake, manifest parse, and byte-level
 * verification that the manifest and the entry set describe each other
 * exactly (lengths and SHA-256 both match). Content semantics (schemas,
 * identifiers, relationships, images) are validate.ts's responsibility.
 */
export async function readArchiveStructure(
  bytes: Uint8Array,
  limits: ArchiveLimits,
): Promise<ArchiveStructure> {
  const entries = readZipEntries(bytes, limits);
  const manifestEntries = entries.filter((e) => e.path === "manifest.json");
  if (manifestEntries.length !== 1) {
    throw new ArchiveError(
      "archive/manifest-missing",
      "the archive must contain exactly one manifest.json",
    );
  }
  const manifest = parseManifest(
    extractZipEntry(bytes, manifestEntries[0], limits),
  );

  const payloadEntries = entries.filter((e) => e.path !== "manifest.json");
  const records = new Map(manifest.files.map((f) => [f.path, f]));
  if (records.size !== manifest.files.length) {
    throw new ArchiveError(
      "archive/manifest-mismatch",
      "the manifest lists a payload path twice",
    );
  }
  if (records.size !== payloadEntries.length) {
    throw new ArchiveError(
      "archive/manifest-mismatch",
      "the manifest and the archive entries disagree",
    );
  }

  const files = new Map<string, Uint8Array>();
  for (const entry of payloadEntries) {
    const record = records.get(entry.path);
    if (!record) {
      throw new ArchiveError(
        "archive/manifest-mismatch",
        "an archive entry is not described by the manifest",
        entry.path,
      );
    }
    const payload = extractZipEntry(bytes, entry, limits);
    if (payload.length !== record.byteLength) {
      throw new ArchiveError(
        "archive/checksum-mismatch",
        "a payload's byte length disagrees with the manifest",
        entry.path,
      );
    }
    if ((await sha256Hex(payload)) !== record.sha256) {
      throw new ArchiveError(
        "archive/checksum-mismatch",
        "a payload's checksum disagrees with the manifest",
        entry.path,
      );
    }
    files.set(entry.path, payload);
  }
  return { manifest, files };
}

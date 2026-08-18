import { sha256Hex } from "../apps/desktop/src/lib/portable/archive.ts";
import {
  ARCHIVE_LIMITS,
  type ArchiveLimits,
} from "../apps/desktop/src/lib/portable/limits.ts";
import { collectFigureSources } from "../apps/desktop/src/lib/portable/snapshot.ts";
import { validateArchive } from "../apps/desktop/src/lib/portable/validate.ts";

interface RelationshipMetrics {
  citationNodes: number;
  citationItems: number;
}

export interface PortableLibraryEvidence {
  valid: true;
  archive: {
    byteLength: number;
    sha256: string;
  };
  manifest: {
    kind: "tesina-library";
    formatVersion: 1;
    appVersion: string;
    counts: {
      essays: number;
      references: number;
      collections: number;
      assets: number;
    };
    verifiedPayloadFiles: number;
    payloadAggregateSha256: string;
  };
  relationships: RelationshipMetrics & {
    figures: number;
  };
  assets: {
    byteLength: number;
    aggregateSha256: string;
    formats: Record<string, number>;
  };
}

const encoder = new TextEncoder();
const RELEASE_VERSION_PATTERN =
  /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

interface EvidenceReadableFile {
  stat(): Promise<{ isFile: boolean; size: number }>;
  read(buffer: Uint8Array): Promise<number | null>;
  close(): void;
}

type OpenEvidenceFile = (path: string) => Promise<EvidenceReadableFile>;

class EvidenceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "EvidenceError";
  }
}

function compareCodeUnits(left: unknown, right: unknown): number {
  const leftKey = JSON.stringify(left);
  const rightKey = JSON.stringify(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function citationMetrics(docJson: unknown): RelationshipMetrics {
  const metrics: RelationshipMetrics = { citationNodes: 0, citationItems: 0 };

  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    const candidate = node as {
      type?: unknown;
      attrs?: { items?: unknown };
      content?: unknown;
    };
    if (candidate.type === "citation") {
      metrics.citationNodes += 1;
      if (Array.isArray(candidate.attrs?.items)) {
        metrics.citationItems += candidate.attrs.items.length;
      }
    }
    if (Array.isArray(candidate.content)) {
      for (const child of candidate.content) walk(child);
    }
  };

  walk(docJson);
  return metrics;
}

async function aggregateSha256(rows: unknown[]): Promise<string> {
  return await sha256Hex(encoder.encode(JSON.stringify(rows)));
}

/**
 * Fully validates an archive, then returns only counts, byte totals, and
 * aggregate hashes suitable for durable acceptance evidence. It deliberately
 * omits entity identifiers, archive paths, timestamps, and document content.
 */
export async function inspectPortableLibraryEvidence(
  bytes: Uint8Array,
  limits: ArchiveLimits = ARCHIVE_LIMITS,
): Promise<PortableLibraryEvidence> {
  const validated = await validateArchive(bytes, limits);
  if (!RELEASE_VERSION_PATTERN.test(validated.manifest.appVersion)) {
    throw new EvidenceError("evidence/app-version");
  }

  const relationships = {
    citationNodes: 0,
    citationItems: 0,
    figures: 0,
  };
  for (const essay of validated.essays) {
    const citations = citationMetrics(essay.content);
    relationships.citationNodes += citations.citationNodes;
    relationships.citationItems += citations.citationItems;
    relationships.figures += collectFigureSources(essay.content).length;
  }

  const assetRows = [...validated.assets.values()]
    .map((asset) => ({
      sha256: asset.sha256,
      byteLength: asset.bytes.byteLength,
      extension: asset.extension,
      width: asset.width,
      height: asset.height,
      frames: asset.frames,
    }))
    .sort(compareCodeUnits);
  const formats: Record<string, number> = {};
  for (const asset of assetRows) {
    formats[asset.extension] = (formats[asset.extension] ?? 0) + 1;
  }

  const payloadRows = validated.manifest.files
    .map((file) => ({
      sha256: file.sha256,
      byteLength: file.byteLength,
      mediaType: file.mediaType,
    }))
    .sort(compareCodeUnits);

  return {
    valid: true,
    archive: {
      byteLength: bytes.byteLength,
      sha256: await sha256Hex(bytes),
    },
    manifest: {
      kind: validated.manifest.kind,
      formatVersion: validated.manifest.formatVersion,
      appVersion: validated.manifest.appVersion,
      counts: { ...validated.manifest.counts },
      verifiedPayloadFiles: validated.manifest.files.length,
      payloadAggregateSha256: await aggregateSha256(payloadRows),
    },
    relationships,
    assets: {
      byteLength: assetRows.reduce(
        (total, asset) => total + asset.byteLength,
        0,
      ),
      aggregateSha256: await aggregateSha256(assetRows),
      formats,
    },
  };
}

/** Opens one stable file handle and refuses to read past the byte limit. */
export async function readEvidenceFileBounded(
  path: string,
  maxBytes: number,
  openFile: OpenEvidenceFile = (target) => Deno.open(target, { read: true }),
): Promise<Uint8Array> {
  const file = await openFile(path);
  try {
    const info = await file.stat();
    if (!info.isFile || info.size > maxBytes) {
      throw new EvidenceError("archive/intake-limit");
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const buffer = new Uint8Array(
        Math.min(64 * 1024, maxBytes - total + 1),
      );
      const count = await file.read(buffer);
      if (count === null) break;
      if (count === 0) throw new EvidenceError("archive/intake-read");
      total += count;
      if (total > maxBytes) {
        throw new EvidenceError("archive/intake-limit");
      }
      chunks.push(buffer.slice(0, count));
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    file.close();
  }
}

function safeErrorCode(error: unknown): string {
  if (
    error !== null && typeof error === "object" &&
    "code" in error && typeof error.code === "string"
  ) {
    return error.code;
  }
  return "inspection_failed";
}

if (import.meta.main) {
  try {
    if (Deno.args.length !== 1) {
      throw new Error(
        "usage: deno run --allow-read scripts/inspect-portable-library-evidence.ts <archive.tesina>",
      );
    }
    const evidence = await inspectPortableLibraryEvidence(
      await readEvidenceFileBounded(
        Deno.args[0],
        ARCHIVE_LIMITS.maxArchiveBytes,
      ),
    );
    console.log(JSON.stringify(evidence, null, 2));
  } catch (error) {
    console.log(
      JSON.stringify({ valid: false, error: { code: safeErrorCode(error) } }),
    );
    Deno.exitCode = 1;
  }
}

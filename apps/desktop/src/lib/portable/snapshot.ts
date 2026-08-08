/**
 * Pure archive-content assembly over already-read snapshot data (design §2).
 * Validates every source item — an invalid essay, library, or missing
 * referenced asset fails the complete export with an error identifying the
 * offending item; content is never silently skipped. Orphan assets, device
 * settings, and deleted-essay backups simply never enter the input contract.
 */

import type { Essay } from "$lib/model/essay";
import {
  type ArchiveContent,
  ArchiveError,
  type LibrarySnapshotContent,
} from "./types.ts";

const LOCAL_ASSET_PREFIX = "essays/assets/";
const ARCHIVE_ASSET_PREFIX = "assets/";

interface DocNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: unknown[];
}

/** Collects every figure `src` in document order (duplicates preserved). */
export function collectFigureSources(docJson: unknown): string[] {
  const sources: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as DocNode;
    if (n.type === "figureImage" && typeof n.attrs?.["src"] === "string") {
      sources.push(n.attrs["src"] as string);
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
    }
  };
  walk(docJson);
  return sources;
}

/** Rewrites figure `src` attributes through `map`, cloning the document. */
export function rewriteFigureSources(
  docJson: unknown,
  map: (src: string) => string,
): unknown {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const n = node as DocNode;
    const out: Record<string, unknown> = { ...n };
    if (n.type === "figureImage" && typeof n.attrs?.["src"] === "string") {
      out["attrs"] = { ...n.attrs, src: map(n.attrs["src"] as string) };
    }
    if (Array.isArray(n.content)) {
      out["content"] = n.content.map(walk);
    }
    return out;
  };
  return walk(docJson);
}

export function localAssetToArchivePath(localPath: string): string {
  if (!localPath.startsWith(LOCAL_ASSET_PREFIX)) {
    throw new ArchiveError(
      "archive/invalid-source-asset-path",
      `figure source is outside ${LOCAL_ASSET_PREFIX}`,
      localPath,
    );
  }
  return ARCHIVE_ASSET_PREFIX + localPath.slice(LOCAL_ASSET_PREFIX.length);
}

function validateEssay(essay: Essay): void {
  if (
    essay === null || typeof essay !== "object" ||
    essay.schemaVersion !== 2 ||
    typeof essay.id !== "string" || essay.id.length === 0 ||
    typeof essay.createdAt !== "string" ||
    typeof essay.settings !== "object" || essay.settings === null ||
    typeof essay.titlePage !== "object" || essay.titlePage === null ||
    essay.content === undefined ||
    !Array.isArray(essay.referencesSnapshot)
  ) {
    const id = (essay as { id?: unknown })?.id;
    throw new ArchiveError(
      "archive/invalid-source-essay",
      "a source essay is not a valid schema-version-2 essay",
      typeof id === "string" ? id : "(unknown id)",
    );
  }
}

/**
 * Validates the snapshot and produces normalized archive content: essays are
 * cloned with `assets/...` figure paths and only reachable assets survive.
 */
export function assembleArchiveContent(
  snapshot: LibrarySnapshotContent,
): ArchiveContent {
  const { essays, library } = snapshot;
  if (
    library === null || typeof library !== "object" ||
    library.schemaVersion !== 1 || !Array.isArray(library.references) ||
    (library.collections !== undefined && !Array.isArray(library.collections))
  ) {
    throw new ArchiveError(
      "archive/invalid-source-library",
      "the shared library file is not a valid schema-version-1 library",
    );
  }

  const seenIds = new Set<string>();
  const reachable = new Map<string, Uint8Array>();
  const normalizedEssays: Essay[] = [];

  for (const essay of [...essays].sort((a, b) => a.id.localeCompare(b.id))) {
    validateEssay(essay);
    if (seenIds.has(essay.id)) {
      throw new ArchiveError(
        "archive/invalid-source-essay",
        "duplicate essay id in snapshot",
        essay.id,
      );
    }
    seenIds.add(essay.id);
    for (const src of collectFigureSources(essay.content)) {
      const bytes = snapshot.assets.get(src);
      if (!bytes) {
        throw new ArchiveError(
          "archive/missing-source-asset",
          "an essay references a figure asset that is missing from the snapshot",
          `${essay.id}: ${src}`,
        );
      }
      reachable.set(localAssetToArchivePath(src), bytes);
    }
    normalizedEssays.push({
      ...essay,
      content: rewriteFigureSources(essay.content, localAssetToArchivePath),
    });
  }

  return {
    essays: normalizedEssays,
    library: {
      schemaVersion: 1,
      references: library.references,
      collections: library.collections ?? [],
    },
    assets: new Map(
      [...reachable.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1),
    ),
  };
}

/**
 * Stable library snapshot capture (design §2, task 4.2). Runs under the
 * coordinator's exclusive maintenance lease: flush pending persistence,
 * record the activity generation, read every persisted essay, the shared
 * library, and each reachable asset, then verify the generation is unchanged
 * — any mutation observed through the last source read discards the whole
 * capture and retries. Invalid source content fails the complete capture
 * naming the offending file; nothing is silently skipped.
 *
 * The staged snapshot is an immutable in-memory buffer rather than an
 * app-data staging directory: the observable contract (one persisted
 * revision, packaged exactly as captured, digest of the exact snapshot) is
 * identical, without stale-staging-dir cleanup on crash.
 */

import type { Essay } from "$lib/model/essay";
import {
  ArchiveError,
  type LibrarySnapshotContent,
  type SharedLibraryFile,
} from "$lib/portable/types";
import { collectFigureSources } from "$lib/portable/snapshot";
import { isCanonicalUuid } from "$lib/portable/paths";

/** Injected I/O so capture is testable without Tauri. */
export interface SnapshotIo {
  /** Names of the `.json` files in `essays/` (not recursive). */
  listEssayFiles(): Promise<string[]>;
  /** Parsed JSON of one essay file, or null when it vanished. */
  readEssayFile(name: string): Promise<unknown>;
  /** Parsed JSON of `library.json`, or null when absent. */
  readLibraryFile(): Promise<unknown>;
  /** Bytes of one `essays/assets/...` path, or null when missing. */
  readAssetFile(relPath: string): Promise<Uint8Array | null>;
}

export interface CaptureDeps {
  io: SnapshotIo;
  flushPending: () => Promise<void>;
  generation: () => number;
  /** Whole-capture retries when a mutation raced the reads. */
  maxAttempts?: number;
}

function validateSourceEssay(value: unknown, fileName: string): Essay {
  const essay = value as Partial<Essay> | null;
  const expectedId = fileName.replace(/\.json$/, "");
  if (
    essay === null || typeof essay !== "object" ||
    essay.schemaVersion !== 2 ||
    typeof essay.id !== "string" || !isCanonicalUuid(essay.id) ||
    essay.id !== expectedId ||
    typeof essay.createdAt !== "string" ||
    typeof essay.settings !== "object" || essay.settings === null ||
    typeof essay.titlePage !== "object" || essay.titlePage === null ||
    essay.content === undefined || !Array.isArray(essay.referencesSnapshot)
  ) {
    throw new ArchiveError(
      "archive/invalid-source-essay",
      "a stored essay file is not a valid schema-version-2 essay",
      `essays/${fileName}`,
    );
  }
  return essay as Essay;
}

function validateSourceLibrary(value: unknown): SharedLibraryFile {
  if (value === null) {
    // A fresh install may not have written library.json yet.
    return { schemaVersion: 1, references: [], collections: [] };
  }
  const lib = value as Partial<SharedLibraryFile>;
  if (
    typeof lib !== "object" || lib.schemaVersion !== 1 ||
    !Array.isArray(lib.references) ||
    (lib.collections !== undefined && !Array.isArray(lib.collections))
  ) {
    throw new ArchiveError(
      "archive/invalid-source-library",
      "library.json is not a valid schema-version-1 library",
      "library.json",
    );
  }
  return lib as SharedLibraryFile;
}

/**
 * Captures one immutable persisted revision, or throws:
 * - the flush barrier's own rejection when pending saves cannot complete;
 * - `archive/invalid-source-*` naming the offending file;
 * - `snapshot/unstable` when every attempt raced a mutation.
 */
export async function captureStableSnapshot(
  deps: CaptureDeps,
): Promise<LibrarySnapshotContent> {
  const attempts = deps.maxAttempts ?? 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await deps.flushPending();
    const generationBefore = deps.generation();

    const essays: Essay[] = [];
    const assets = new Map<string, Uint8Array>();
    const names = await deps.io.listEssayFiles();
    let raced = false;

    for (const name of names.slice().sort()) {
      const value = await deps.io.readEssayFile(name);
      if (value === null) {
        raced = true; // deleted between listing and reading
        break;
      }
      const essay = validateSourceEssay(value, name);
      essays.push(essay);
      for (const src of collectFigureSources(essay.content)) {
        if (assets.has(src)) continue;
        const bytes = await deps.io.readAssetFile(src);
        if (bytes === null) {
          throw new ArchiveError(
            "archive/missing-source-asset",
            "an essay references a figure asset that is missing on disk",
            `${essay.id}: ${src}`,
          );
        }
        assets.set(src, bytes);
      }
    }

    const library = raced
      ? null
      : validateSourceLibrary(await deps.io.readLibraryFile());

    if (raced || deps.generation() !== generationBefore) {
      continue; // a mutation raced this capture; retry the whole revision
    }
    return { essays, library: library!, assets };
  }
  throw new ArchiveError(
    "snapshot/unstable",
    "the library kept changing while the snapshot was being captured",
  );
}

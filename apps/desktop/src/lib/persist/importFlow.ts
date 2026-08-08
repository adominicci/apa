/**
 * End-to-end import orchestration (design §6/§13): bounded read → full
 * validation → lease-stable local capture → pure plan → staged journal →
 * idempotent apply, with the amended plan-freshness loop: a stale plan is
 * recomputed from the current revision and, when its preview counts differ,
 * surfaced to the UI for re-confirmation instead of silently applying.
 */

import type { Essay } from "$lib/model/essay";
import { ARCHIVE_LIMITS, type ArchiveLimits } from "$lib/portable/limits";
import { sha256Hex } from "$lib/portable/archive";
import { validateArchive, type ValidatedArchive } from "$lib/portable/validate";
import {
  type ImportPlan,
  type ImportPreview,
  type LocalImportState,
  planImport,
} from "$lib/portable/importPlan";
import {
  applyImport,
  type ImportFs,
  ImportJournalError,
  stageImport,
} from "./importJournal.ts";

export interface LocalStateCapture {
  local: LocalImportState;
  /** Hash of the live library.json bytes this state was read from. */
  previousLibrarySha256: string;
}

/**
 * Reads the flushed local library into planner shape. Must run under the
 * maintenance lease with persistence flushed (the caller guarantees both).
 * The asset index covers EVERY existing asset file — orphans included — so
 * dedupe can reuse them and path allocation can avoid them.
 */
export async function captureLocalImportState(
  fs: ImportFs,
): Promise<LocalStateCapture> {
  const essays: Essay[] = [];
  const existingEssayIds = new Set<string>();
  for (const name of await fs.list("essays")) {
    if (!name.endsWith(".json")) continue;
    existingEssayIds.add(name.replace(/\.json$/, ""));
    const bytes = await fs.readBytes(`essays/${name}`);
    if (bytes === null) continue;
    try {
      const essay = JSON.parse(new TextDecoder().decode(bytes)) as Essay;
      if (essay?.schemaVersion === 2 && typeof essay.id === "string") {
        essays.push(essay);
      }
    } catch {
      // Unreadable files stay in existingEssayIds: the planner treats a
      // same-id import as conflicting rather than skipped or overwritten.
    }
  }

  const assetIndex = new Map<string, string>();
  const existingAssetPaths = new Set<string>();
  for (const name of await fs.list("essays/assets")) {
    const relPath = `essays/assets/${name}`;
    existingAssetPaths.add(relPath);
    const bytes = await fs.readBytes(relPath);
    if (bytes !== null) {
      assetIndex.set(await sha256Hex(bytes), relPath);
    }
  }

  const libraryBytes = await fs.readBytes("library.json");
  let references: LocalImportState["library"]["references"] = [];
  let collections: LocalImportState["library"]["collections"] = [];
  if (libraryBytes !== null) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(libraryBytes)) as {
        references?: LocalImportState["library"]["references"];
        collections?: LocalImportState["library"]["collections"];
      };
      references = parsed.references ?? [];
      collections = parsed.collections ?? [];
    } catch {
      // A corrupt library fails later validations; planning proceeds empty.
    }
  }

  return {
    local: {
      essays,
      library: { references, collections },
      assetIndex,
      existingAssetPaths,
      existingEssayIds,
    },
    previousLibrarySha256: libraryBytes === null
      ? await sha256Hex(new Uint8Array(0))
      : await sha256Hex(libraryBytes),
  };
}

export interface ImportFlowDeps {
  fs: ImportFs;
  /** Serializes maintenance operations (persistence.runMaintenance). */
  runMaintenance<T>(fn: () => Promise<T>): Promise<T>;
  /** Flushes pending persistence before planning or applying. */
  flushPending(): Promise<void>;
  /** Creates the validated rollback archive (archive service). */
  createRollback(transactionId: string): Promise<{
    relPath: string;
    sha256: string;
  }>;
  uuid(): string;
  now(): string;
  limits?: ArchiveLimits;
}

export interface ImportPreviewResult {
  archive: ValidatedArchive;
  plan: ImportPlan;
  preview: ImportPreview;
  archiveSha256: string;
  previousLibrarySha256: string;
}

/** Validates archive bytes and produces a read-only Merge preview. */
export async function previewImport(
  bytes: Uint8Array,
  deps: ImportFlowDeps,
): Promise<ImportPreviewResult> {
  const limits = deps.limits ?? ARCHIVE_LIMITS;
  const archive = await validateArchive(bytes, limits);
  const archiveSha256 = await sha256Hex(bytes);
  return await deps.runMaintenance(async () => {
    await deps.flushPending();
    const { local, previousLibrarySha256 } = await captureLocalImportState(
      deps.fs,
    );
    const plan = await planImport(archive, local, {
      transactionId: deps.uuid(),
      newUuid: deps.uuid,
      now: deps.now,
    });
    return {
      archive,
      plan,
      preview: plan.preview,
      archiveSha256,
      previousLibrarySha256,
    };
  });
}

export type ImportApplyResult =
  | { kind: "applied"; transactionId: string; preview: ImportPreview }
  | {
    /** The library changed and the new plan differs: re-confirm. */
    kind: "replan-needed";
    next: ImportPreviewResult;
  };

function previewsEqual(a: ImportPreview, b: ImportPreview): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Applies a confirmed preview. When the library moved since planning, the
 * plan is recomputed from the current revision; an equivalent preview
 * applies transparently, a different one is returned for re-confirmation.
 */
export async function applyConfirmedImport(
  confirmed: ImportPreviewResult,
  deps: ImportFlowDeps,
  onRecoverable?: () => void,
): Promise<ImportApplyResult> {
  let current = confirmed;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await deps.runMaintenance(async () => {
        await deps.flushPending();
        const journal = await stageImport(current.plan, {
          fs: deps.fs,
          readArchiveAsset: (archivePath) => {
            const asset = current.archive.assets.get(archivePath);
            if (!asset) {
              return Promise.reject(
                new ImportJournalError(
                  "import/stage-hash",
                  "planned asset missing from the validated archive",
                  archivePath,
                ),
              );
            }
            return Promise.resolve(asset.bytes);
          },
          createRollback: deps.createRollback,
          now: deps.now,
          archiveSha256: current.archiveSha256,
          previousLibrarySha256: current.previousLibrarySha256,
        });
        onRecoverable?.();
        await applyImport(journal, { fs: deps.fs });
      });
      return {
        kind: "applied",
        transactionId: current.plan.transactionId,
        preview: current.preview,
      };
    } catch (error) {
      const stale = error instanceof ImportJournalError &&
        error.code === "import/stale-plan";
      if (!stale || attempt === 1) throw error;
      // Replan against the current revision (amended spec).
      const replanned = await deps.runMaintenance(async () => {
        await deps.flushPending();
        const { local, previousLibrarySha256 } = await captureLocalImportState(
          deps.fs,
        );
        const plan = await planImport(current.archive, local, {
          transactionId: deps.uuid(),
          newUuid: deps.uuid,
          now: deps.now,
        });
        return {
          ...current,
          plan,
          preview: plan.preview,
          previousLibrarySha256,
        };
      });
      if (!previewsEqual(replanned.preview, current.preview)) {
        return { kind: "replan-needed", next: replanned };
      }
      current = replanned;
    }
  }
  throw new ImportJournalError(
    "import/stale-plan",
    "the library kept changing while the import was being applied",
  );
}

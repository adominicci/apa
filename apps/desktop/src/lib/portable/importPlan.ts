/**
 * Deterministic Merge planner (design §5/§6). Pure and side-effect free: the
 * transaction id, every new UUID, and the import time are injected, so the
 * same archive, local state, and deps always produce the same plan.
 *
 * Order matters (design §5): asset checksums resolve to final local paths
 * FIRST, imported figure paths are normalized through that map, and only then
 * are essays compared using exact figure-byte classes — so re-importing an
 * unchanged export is fully skipped even when paths differ or duplicate the
 * same bytes. Nothing here ever rewrites a pre-existing local essay,
 * reference, collection, or asset path; the merge is strictly additive. The
 * only user-facing text this module produces is the imported-copy title
 * suffix, which follows each essay's document language; all preview/chrome
 * explanations belong to the UI and its UI-language axis.
 */

import type { DocLocale, Reference } from "@tesina/engine";
import type { Essay } from "$lib/model/essay";
import type { RefCollection } from "$lib/model/collections";
import { localAssetFile, localEssayFile } from "./paths.ts";
import { collectCitationRefIds, remapEssay } from "./remap.ts";
import {
  collectionDigest,
  essaySemanticDigest,
  referenceDigest,
} from "./semantic.ts";
import { collectFigureSources } from "./snapshot.ts";
import type { ValidatedArchive, ValidatedAsset } from "./validate.ts";

export class PlanError extends Error {
  readonly code: string;
  readonly detail?: string;
  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = "PlanError";
    this.code = code;
    this.detail = detail;
  }
}

/** The validated archive content the planner consumes. */
export type ImportArchiveContent = Pick<
  ValidatedArchive,
  "essays" | "library" | "assets"
>;

/** Flushed, lease-stable local state captured for planning (design §6). */
export interface LocalImportState {
  essays: Essay[];
  library: { references: Reference[]; collections: RefCollection[] };
  /** Archive-relative exact-byte class → one reusable local asset path. */
  reusableAssetPathByClass: ReadonlyMap<string, string>;
  /** Local asset path → archive-relative exact-byte class. */
  assetClassByLocalPath: ReadonlyMap<string, string>;
  /** Every local `essays/assets/...` path already in use. */
  existingAssetPaths: ReadonlySet<string>;
  /** Every essay id that already exists as a local file. */
  existingEssayIds: ReadonlySet<string>;
}

export interface ImportPlanDeps {
  transactionId: string;
  newUuid: () => string;
  now: () => string;
}

export interface AssetWriteOp {
  kind: "writeAsset";
  opId: string;
  /** Archive entry (`assets/<uuid>.<ext>`) whose bytes are written. */
  archivePath: string;
  /** Unused final local path (`essays/assets/<uuid>.<ext>`). */
  localPath: string;
  sha256: string;
  byteLength: number;
}

export interface EssayWriteOp {
  kind: "writeEssay";
  opId: string;
  /** Unused final local path (`essays/<id>.json`). */
  localPath: string;
  essay: Essay;
}

export interface MergedLibrary {
  schemaVersion: 1;
  references: Reference[];
  collections: RefCollection[];
}

export interface LibraryMergeOp {
  kind: "mergeLibrary";
  opId: string;
  /** The value that atomically replaces `library.json` at apply. */
  library: MergedLibrary;
}

export type ImportOperation = AssetWriteOp | EssayWriteOp | LibraryMergeOp;

export interface CategoryCounts {
  new: number;
  identical: number;
  conflicting: number;
}

export interface ImportPreview {
  essays: CategoryCounts;
  references: CategoryCounts;
  collections: CategoryCounts;
  assets: { reused: number; added: number };
}

const EMPTY_ID_MAP = new Map<string, string>();

interface ArchiveAssetClass {
  id: string;
  bytes: Uint8Array;
}

export interface ArchiveAssetClassIndex {
  classByArchivePath: ReadonlyMap<string, string>;
  findClass(sha256: string, bytes: Uint8Array): string | undefined;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Groups validated archive assets only when both SHA-256 and bytes match. */
export function createArchiveAssetClassIndex(
  assets: ReadonlyMap<string, ValidatedAsset>,
): ArchiveAssetClassIndex {
  const classesBySha256 = new Map<string, ArchiveAssetClass[]>();
  const classByArchivePath = new Map<string, string>();
  let nextClass = 0;

  for (const archivePath of [...assets.keys()].sort()) {
    const asset = assets.get(archivePath)!;
    const candidates = classesBySha256.get(asset.sha256) ?? [];
    let assetClass = candidates.find((candidate) =>
      bytesEqual(candidate.bytes, asset.bytes)
    );
    if (assetClass === undefined) {
      assetClass = { id: `asset-class-${++nextClass}`, bytes: asset.bytes };
      candidates.push(assetClass);
      classesBySha256.set(asset.sha256, candidates);
    }
    classByArchivePath.set(archivePath, assetClass.id);
  }

  return {
    classByArchivePath,
    findClass(sha256, bytes) {
      return classesBySha256.get(sha256)?.find((candidate) =>
        bytesEqual(candidate.bytes, bytes)
      )?.id;
    },
  };
}

function normalizeFigureSemantics(
  essay: Essay,
  assetClassByLocalPath: ReadonlyMap<string, string>,
): Essay {
  const figurePathMap = new Map(
    collectFigureSources(essay.content).map((src) => {
      const assetClass = assetClassByLocalPath.get(src);
      return [
        src,
        JSON.stringify(
          assetClass === undefined
            ? ["unresolved-path", src]
            : ["exact-asset-class", assetClass],
        ),
      ];
    }),
  );
  return remapEssay(essay, {
    referenceIdMap: EMPTY_ID_MAP,
    figurePathMap,
  });
}

export interface ImportPlan {
  transactionId: string;
  /** Asset writes, then essay writes, then the single library merge. */
  operations: ImportOperation[];
  /** Same value the final `mergeLibrary` operation carries. */
  mergedLibrary: MergedLibrary;
  preview: ImportPreview;
}

/**
 * Title suffix for a conflicting imported copy, selected by THAT essay's
 * document language (design §5) — never by the UI language.
 */
export function importedCopyTitleSuffix(language: DocLocale): string {
  return language === "es" ? " (copia importada)" : " (imported copy)";
}

function allocateId(used: Set<string>, newUuid: () => string): string {
  let id = newUuid();
  while (used.has(id)) id = newUuid();
  used.add(id);
  return id;
}

/** Computes the deterministic, additive Merge plan for a validated archive. */
export async function planImport(
  archive: ImportArchiveContent,
  local: LocalImportState,
  deps: ImportPlanDeps,
): Promise<ImportPlan> {
  let opCounter = 0;
  const nextOpId = (): string => `${deps.transactionId}/op-${++opCounter}`;
  const preview: ImportPreview = {
    essays: { new: 0, identical: 0, conflicting: 0 },
    references: { new: 0, identical: 0, conflicting: 0 },
    collections: { new: 0, identical: 0, conflicting: 0 },
    assets: { reused: 0, added: 0 },
  };

  // a. Resolve asset checksums to final local paths FIRST (task 5.8) so
  // imported figure paths can be normalized before semantic comparison.
  const usedAssetPaths = new Set(local.existingAssetPaths);
  const figurePathMap = new Map<string, string>();
  const assetClassByLocalPath = new Map(local.assetClassByLocalPath);
  const archiveAssetClasses = createArchiveAssetClassIndex(archive.assets);
  const assetWrites: AssetWriteOp[] = [];
  const archiveAssetPaths = [...archive.assets.keys()].sort();
  for (const archivePath of archiveAssetPaths) {
    const asset = archive.assets.get(archivePath)!;
    const assetClass = archiveAssetClasses.classByArchivePath.get(archivePath)!;
    const exactLocalPath = `essays/${archivePath}`;
    const reusablePath = local.assetClassByLocalPath.get(exactLocalPath) ===
        assetClass
      ? exactLocalPath
      : local.reusableAssetPathByClass.get(assetClass);
    if (reusablePath !== undefined) {
      figurePathMap.set(archivePath, reusablePath);
      assetClassByLocalPath.set(reusablePath, assetClass);
      preview.assets.reused += 1;
      continue;
    }
    let localPath = localAssetFile(deps.newUuid(), asset.extension);
    while (usedAssetPaths.has(localPath)) {
      localPath = localAssetFile(deps.newUuid(), asset.extension);
    }
    usedAssetPaths.add(localPath);
    figurePathMap.set(archivePath, localPath);
    assetClassByLocalPath.set(localPath, assetClass);
    assetWrites.push({
      kind: "writeAsset",
      opId: nextOpId(),
      archivePath,
      localPath,
      sha256: asset.sha256,
      byteLength: asset.bytes.byteLength,
    });
    preview.assets.added += 1;
  }
  // b. References: identical same-id entries are reused, conflicting same-id
  // entries get a new id recorded in the reference map, new ids add as-is.
  const localReferencesById = new Map(
    local.library.references.map((r) => [r.id, r]),
  );
  const archiveLibraryReferenceIds = new Set(
    archive.library.references.map((reference) => reference.id),
  );
  const snapshotOnlyReferencesById = new Map<string, Reference[]>();
  for (
    const essay of [...archive.essays].sort((a, b) => a.id.localeCompare(b.id))
  ) {
    const cited = new Set(collectCitationRefIds(essay.content));
    for (const snapshot of essay.referencesSnapshot) {
      if (
        cited.has(snapshot.id) &&
        !archiveLibraryReferenceIds.has(snapshot.id)
      ) {
        const variants = snapshotOnlyReferencesById.get(snapshot.id) ?? [];
        variants.push(snapshot);
        snapshotOnlyReferencesById.set(snapshot.id, variants);
      }
    }
  }
  const usedReferenceIds = new Set([
    ...localReferencesById.keys(),
    ...archive.library.references.map((r) => r.id),
    ...snapshotOnlyReferencesById.keys(),
  ]);
  const referenceIdMap = new Map<string, string>();
  const snapshotVariantIdMaps = new Map<string, Map<string, string>>();
  const addedReferences: Reference[] = [];
  for (const reference of archive.library.references) {
    const existing = localReferencesById.get(reference.id);
    if (existing === undefined) {
      addedReferences.push(reference);
      preview.references.new += 1;
      continue;
    }
    if (
      (await referenceDigest(existing)) === (await referenceDigest(reference))
    ) {
      preview.references.identical += 1;
      continue;
    }
    const newId = allocateId(usedReferenceIds, deps.newUuid);
    referenceIdMap.set(reference.id, newId);
    addedReferences.push({ ...reference, id: newId });
    preview.references.conflicting += 1;
  }
  for (
    const [snapshotId, variants] of [...snapshotOnlyReferencesById.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
  ) {
    const existing = localReferencesById.get(snapshotId);
    // At most one semantic variant may keep the shared snapshot id. A local
    // reference owns it when present; otherwise the first deterministic
    // snapshot variant owns it. Every divergent variant receives a new id so
    // restoring one essay cannot make its live reference shadow another
    // essay's historical snapshot.
    const baselineDigest = await referenceDigest(existing ?? variants[0]);
    const variantIdMap = new Map<string, string>();
    for (const variant of variants) {
      const variantDigest = await referenceDigest(variant);
      if (variantDigest === baselineDigest || variantIdMap.has(variantDigest)) {
        continue;
      }
      variantIdMap.set(
        variantDigest,
        allocateId(usedReferenceIds, deps.newUuid),
      );
      preview.references.conflicting += 1;
    }
    if (variantIdMap.size > 0) {
      snapshotVariantIdMaps.set(snapshotId, variantIdMap);
    }
  }

  // c. Collections: member ids map through the reference map BEFORE the
  // identity comparison, so a collection that only followed a remapped
  // reference still counts as identical.
  const localCollectionsById = new Map(
    local.library.collections.map((c) => [c.id, c]),
  );
  const usedCollectionIds = new Set([
    ...localCollectionsById.keys(),
    ...archive.library.collections.map((c) => c.id),
  ]);
  const addedCollections: RefCollection[] = [];
  for (const collection of archive.library.collections) {
    const mapped: RefCollection = {
      ...collection,
      refIds: collection.refIds.map((id) => referenceIdMap.get(id) ?? id),
    };
    const existing = localCollectionsById.get(collection.id);
    if (existing === undefined) {
      addedCollections.push(mapped);
      preview.collections.new += 1;
      continue;
    }
    if (
      (await collectionDigest(existing)) === (await collectionDigest(mapped))
    ) {
      preview.collections.identical += 1;
      continue;
    }
    addedCollections.push({
      ...mapped,
      id: allocateId(usedCollectionIds, deps.newUuid),
    });
    preview.collections.conflicting += 1;
  }

  // d. Essays, after figure-path normalization and reference remapping.
  const localEssaysById = new Map(local.essays.map((e) => [e.id, e]));
  const usedEssayIds = new Set([
    ...local.existingEssayIds,
    ...localEssaysById.keys(),
    ...archive.essays.map((e) => e.id),
  ]);
  const essayWrites: EssayWriteOp[] = [];
  for (
    const imported of [...archive.essays].sort((a, b) =>
      a.id.localeCompare(b.id)
    )
  ) {
    const essayReferenceIdMap = new Map(referenceIdMap);
    const citedIds = new Set(collectCitationRefIds(imported.content));
    for (const snapshot of imported.referencesSnapshot) {
      if (!citedIds.has(snapshot.id)) continue;
      const variantMap = snapshotVariantIdMaps.get(snapshot.id);
      if (variantMap === undefined) continue;
      const mappedId = variantMap.get(await referenceDigest(snapshot));
      if (mappedId !== undefined) {
        essayReferenceIdMap.set(snapshot.id, mappedId);
      }
    }
    const normalized = remapEssay(imported, {
      referenceIdMap: essayReferenceIdMap,
      figurePathMap,
    });
    const localEssay = localEssaysById.get(imported.id);
    const idTaken = localEssay !== undefined ||
      local.existingEssayIds.has(imported.id);
    if (!idTaken) {
      essayWrites.push({
        kind: "writeEssay",
        opId: nextOpId(),
        localPath: localEssayFile(normalized.id),
        essay: normalized,
      });
      preview.essays.new += 1;
      continue;
    }
    if (localEssay !== undefined) {
      const [localDigest, importedDigest] = await Promise.all([
        essaySemanticDigest(
          normalizeFigureSemantics(localEssay, assetClassByLocalPath),
        ),
        essaySemanticDigest(
          normalizeFigureSemantics(normalized, assetClassByLocalPath),
        ),
      ]);
      if (localDigest === importedDigest) {
        preview.essays.identical += 1;
        continue;
      }
    }
    // Conflicting same-id essay: preserve both. The imported copy keeps its
    // createdAt, records its origin and import time, and its title carries
    // the document-language suffix. The local essay is never touched.
    const newId = allocateId(usedEssayIds, deps.newUuid);
    const copy: Essay = {
      ...normalized,
      id: newId,
      importedAt: deps.now(),
      sourceEssayId: imported.id,
      titlePage: {
        ...normalized.titlePage,
        title: normalized.titlePage.title +
          importedCopyTitleSuffix(normalized.settings.documentLanguage),
      },
    };
    essayWrites.push({
      kind: "writeEssay",
      opId: nextOpId(),
      localPath: localEssayFile(newId),
      essay: copy,
    });
    preview.essays.conflicting += 1;
  }

  const mergedLibrary: MergedLibrary = {
    schemaVersion: 1,
    references: [...local.library.references, ...addedReferences],
    collections: [...local.library.collections, ...addedCollections],
  };
  const plan: ImportPlan = {
    transactionId: deps.transactionId,
    operations: [
      ...assetWrites,
      ...essayWrites,
      { kind: "mergeLibrary", opId: nextOpId(), library: mergedLibrary },
    ],
    mergedLibrary,
    preview,
  };
  assertPlanConsistent(plan, local);
  return plan;
}

/**
 * Final pure consistency gate (task 5.7): applies the plan to an in-memory
 * copy of the local library and throws a `PlanError` if any planned write
 * would overwrite existing data or if any citation refId, snapshot reference,
 * collection member, or figure path would dangle afterwards.
 */
export function assertPlanConsistent(
  plan: ImportPlan,
  local: LocalImportState,
): void {
  const assetPaths = new Set(local.existingAssetPaths);
  const essaysById = new Map(local.essays.map((e) => [e.id, e]));
  for (const op of plan.operations) {
    if (op.kind === "writeAsset") {
      if (assetPaths.has(op.localPath)) {
        throw new PlanError(
          "plan/asset-overwrite",
          "a planned asset write targets an existing local path",
          op.localPath,
        );
      }
      assetPaths.add(op.localPath);
    } else if (op.kind === "writeEssay") {
      if (
        essaysById.has(op.essay.id) || local.existingEssayIds.has(op.essay.id)
      ) {
        throw new PlanError(
          "plan/essay-overwrite",
          "a planned essay write would overwrite an existing essay",
          op.essay.id,
        );
      }
      if (op.localPath !== localEssayFile(op.essay.id)) {
        throw new PlanError(
          "plan/essay-path-mismatch",
          "a planned essay path disagrees with its essay id",
          op.essay.id,
        );
      }
      essaysById.set(op.essay.id, op.essay);
    }
  }

  const referenceIds = new Set(plan.mergedLibrary.references.map((r) => r.id));
  if (referenceIds.size !== plan.mergedLibrary.references.length) {
    throw new PlanError(
      "plan/duplicate-reference-id",
      "the merged library contains a duplicate reference id",
    );
  }
  const collectionIds = new Set(
    plan.mergedLibrary.collections.map((c) => c.id),
  );
  if (collectionIds.size !== plan.mergedLibrary.collections.length) {
    throw new PlanError(
      "plan/duplicate-collection-id",
      "the merged library contains a duplicate collection id",
    );
  }

  for (const essay of essaysById.values()) {
    const snapshotIds = new Set(essay.referencesSnapshot.map((r) => r.id));
    for (const refId of collectCitationRefIds(essay.content)) {
      if (!referenceIds.has(refId) && !snapshotIds.has(refId)) {
        throw new PlanError(
          "plan/dangling-citation",
          "a citation would resolve nowhere after apply",
          `${essay.id}: ${refId}`,
        );
      }
    }
    for (const src of collectFigureSources(essay.content)) {
      if (!assetPaths.has(src)) {
        throw new PlanError(
          "plan/dangling-figure",
          "a figure path would resolve to no asset after apply",
          `${essay.id}: ${src}`,
        );
      }
    }
  }

  for (const collection of plan.mergedLibrary.collections) {
    for (const refId of collection.refIds) {
      if (!referenceIds.has(refId)) {
        throw new PlanError(
          "plan/dangling-collection-member",
          "a collection member would resolve nowhere after apply",
          `${collection.id}: ${refId}`,
        );
      }
    }
  }
}

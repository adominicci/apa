/**
 * Deterministic Merge planner matrix (tasks 5.5–5.8, design §5/§6): asset
 * checksums resolve first, references then collections then essays are
 * classified as new / identical / conflicting, every id and time is injected,
 * and the final plan passes a pure consistency check.
 */
import { describe, expect, it } from "vitest";
import type { Reference } from "@tesina/engine";
import type { Essay } from "$lib/model/essay";
import type { RefCollection } from "$lib/model/collections";
import { sha256Hex } from "./archive.ts";
import { fixtureUuid } from "./fixtures/libraries.ts";
import { pngBytes } from "./fixtures/images.ts";
import {
  assertPlanConsistent,
  type AssetWriteOp,
  type EssayWriteOp,
  type ImportArchiveContent,
  importedCopyTitleSuffix,
  type ImportPlan,
  type ImportPlanDeps,
  type LocalImportState,
  PlanError,
  planImport,
} from "./importPlan.ts";
import { collectCitationRefIds } from "./remap.ts";
import { assembleArchiveContent, collectFigureSources } from "./snapshot.ts";
import type { ValidatedAsset } from "./validate.ts";

const TXN = fixtureUuid(8, 1);
const NOW = "2026-08-08T12:00:00.000Z";
const CREATED = "2026-01-15T12:00:00.000Z";

function deps(): ImportPlanDeps {
  let n = 0;
  return {
    transactionId: TXN,
    newUuid: () => fixtureUuid(9, ++n),
    now: () => NOW,
  };
}

function reference(n: number, title = `Estudio ${n}`): Reference {
  return {
    type: "journalArticle",
    id: fixtureUuid(1, n),
    authors: [{ kind: "person", family: `Autora${n}`, given: "M." }],
    date: { year: 2020 },
    title,
    journal: "Revista Sintética",
  };
}

interface EssayOptions {
  id: string;
  title?: string;
  language?: "es" | "en";
  cites?: string[];
  figureSrcs?: string[];
  snapshot?: Reference[];
  createdAt?: string;
  updatedAt?: string;
  bodyText?: string;
}

function essayOf(options: EssayOptions): Essay {
  const body: unknown[] = [{
    type: "paragraph",
    content: [
      { type: "text", text: options.bodyText ?? "Cuerpo del ensayo." },
      ...(options.cites ?? []).map((refId) => ({
        type: "citation",
        attrs: { items: [{ refId }], mode: "parenthetical" },
      })),
    ],
  }];
  for (const src of options.figureSrcs ?? []) {
    body.push({
      type: "figure",
      content: [{ type: "figureImage", attrs: { src, alt: "Figura" } }],
    });
  }
  return {
    schemaVersion: 2,
    id: options.id,
    createdAt: options.createdAt ?? CREATED,
    updatedAt: options.updatedAt ?? CREATED,
    settings: {
      documentLanguage: options.language ?? "es",
      variant: "student",
      font: "times-new-roman-12",
      paperSize: "us-letter",
      includeUncitedReferences: false,
    },
    titlePage: {
      title: options.title ?? "Ensayo",
      authors: [],
      affiliations: [],
    },
    content: { type: "doc", content: [{ type: "sectionBody", content: body }] },
    referencesSnapshot: options.snapshot ?? [],
  };
}

function assetOf(sha256: string, extension = "png", size = 8): ValidatedAsset {
  return {
    bytes: new Uint8Array(size).fill(7),
    extension,
    width: 4,
    height: 4,
    frames: 1,
    sha256,
  };
}

interface ArchiveParts {
  essays?: Essay[];
  references?: Reference[];
  collections?: RefCollection[];
  assets?: Record<string, ValidatedAsset>;
}

function archiveOf(parts: ArchiveParts): ImportArchiveContent {
  return {
    essays: parts.essays ?? [],
    library: {
      schemaVersion: 1,
      references: parts.references ?? [],
      collections: parts.collections ?? [],
    },
    assets: new Map(Object.entries(parts.assets ?? {})),
  };
}

interface LocalParts {
  essays?: Essay[];
  references?: Reference[];
  collections?: RefCollection[];
  /** local path -> sha256 of the identical local bytes */
  assets?: Record<string, string>;
  extraEssayIds?: string[];
  extraAssetPaths?: string[];
}

function localOf(parts: LocalParts): LocalImportState {
  const assetEntries = Object.entries(parts.assets ?? {});
  return {
    essays: parts.essays ?? [],
    library: {
      references: parts.references ?? [],
      collections: parts.collections ?? [],
    },
    assetIndex: new Map(assetEntries.map(([path, sha]) => [sha, path])),
    existingAssetPaths: new Set([
      ...assetEntries.map(([path]) => path),
      ...(parts.extraAssetPaths ?? []),
    ]),
    existingEssayIds: new Set([
      ...(parts.essays ?? []).map((e) => e.id),
      ...(parts.extraEssayIds ?? []),
    ]),
  };
}

function essayWrites(plan: ImportPlan): EssayWriteOp[] {
  return plan.operations.filter((o): o is EssayWriteOp =>
    o.kind === "writeEssay"
  );
}

function assetWrites(plan: ImportPlan): AssetWriteOp[] {
  return plan.operations.filter((o): o is AssetWriteOp =>
    o.kind === "writeAsset"
  );
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe("planImport essays", () => {
  it("adds a new essay keeping its id and path", async () => {
    const imported = essayOf({ id: fixtureUuid(2, 1) });
    const plan = await planImport(
      archiveOf({ essays: [imported] }),
      localOf({}),
      deps(),
    );
    const writes = essayWrites(plan);
    expect(writes).toHaveLength(1);
    expect(writes[0].essay.id).toBe(imported.id);
    expect(writes[0].localPath).toBe(`essays/${imported.id}.json`);
    expect(plan.preview.essays).toEqual({
      new: 1,
      identical: 0,
      conflicting: 0,
    });
  });

  it("keeps same-title different-id essays as two essays, not a conflict", async () => {
    const local = essayOf({ id: fixtureUuid(2, 1), title: "Mismo título" });
    const imported = essayOf({ id: fixtureUuid(2, 2), title: "Mismo título" });
    const plan = await planImport(
      archiveOf({ essays: [imported] }),
      localOf({ essays: [local] }),
      deps(),
    );
    expect(plan.preview.essays).toEqual({
      new: 1,
      identical: 0,
      conflicting: 0,
    });
    expect(essayWrites(plan)[0].essay.id).toBe(imported.id);
    expect(essayWrites(plan)[0].essay.titlePage.title).toBe("Mismo título");
  });

  it("skips a same-id essay that differs only in updatedAt", async () => {
    const local = essayOf({ id: fixtureUuid(2, 1) });
    const imported = essayOf({
      id: fixtureUuid(2, 1),
      updatedAt: "2027-12-31T23:59:59.000Z",
    });
    const plan = await planImport(
      archiveOf({ essays: [imported] }),
      localOf({ essays: [local] }),
      deps(),
    );
    expect(essayWrites(plan)).toHaveLength(0);
    expect(plan.preview.essays).toEqual({
      new: 0,
      identical: 1,
      conflicting: 0,
    });
  });

  it("creates a Spanish imported copy on a same-id semantic conflict", async () => {
    const local = essayOf({ id: fixtureUuid(2, 1), bodyText: "Texto local." });
    const imported = essayOf({
      id: fixtureUuid(2, 1),
      title: "Ensayo en conflicto",
      language: "es",
      bodyText: "Texto importado distinto.",
      createdAt: "2025-06-01T00:00:00.000Z",
    });
    const plan = await planImport(
      archiveOf({ essays: [imported] }),
      localOf({ essays: [local] }),
      deps(),
    );
    const writes = essayWrites(plan);
    expect(writes).toHaveLength(1);
    const copy = writes[0].essay;
    expect(copy.id).toBe(fixtureUuid(9, 1));
    expect(copy.sourceEssayId).toBe(fixtureUuid(2, 1));
    expect(copy.importedAt).toBe(NOW);
    expect(copy.createdAt).toBe("2025-06-01T00:00:00.000Z");
    expect(copy.titlePage.title).toBe("Ensayo en conflicto (copia importada)");
    expect(plan.preview.essays).toEqual({
      new: 0,
      identical: 0,
      conflicting: 1,
    });
  });

  it("suffixes an English conflicting essay in English", async () => {
    const local = essayOf({ id: fixtureUuid(2, 1), bodyText: "Local text." });
    const imported = essayOf({
      id: fixtureUuid(2, 1),
      title: "Conflicting essay",
      language: "en",
      bodyText: "Different imported text.",
    });
    const plan = await planImport(
      archiveOf({ essays: [imported] }),
      localOf({ essays: [local] }),
      deps(),
    );
    expect(essayWrites(plan)[0].essay.titlePage.title).toBe(
      "Conflicting essay (imported copy)",
    );
  });

  it("treats an unreadable existing same-id essay as a conflict, never an overwrite", async () => {
    const imported = essayOf({ id: fixtureUuid(2, 1) });
    const plan = await planImport(
      archiveOf({ essays: [imported] }),
      localOf({ extraEssayIds: [fixtureUuid(2, 1)] }),
      deps(),
    );
    expect(plan.preview.essays).toEqual({
      new: 0,
      identical: 0,
      conflicting: 1,
    });
    expect(essayWrites(plan)[0].essay.id).not.toBe(fixtureUuid(2, 1));
  });
});

describe("planImport references", () => {
  it("skips an identical same-id reference", async () => {
    const shared = reference(1);
    const plan = await planImport(
      archiveOf({ references: [{ ...shared }] }),
      localOf({ references: [shared] }),
      deps(),
    );
    expect(plan.mergedLibrary.references).toEqual([shared]);
    expect(plan.preview.references).toEqual({
      new: 0,
      identical: 1,
      conflicting: 0,
    });
  });

  it("adds a new reference as-is", async () => {
    const imported = reference(2);
    const plan = await planImport(
      archiveOf({ references: [imported] }),
      localOf({ references: [reference(1)] }),
      deps(),
    );
    expect(plan.mergedLibrary.references).toEqual([reference(1), imported]);
    expect(plan.preview.references).toEqual({
      new: 1,
      identical: 0,
      conflicting: 0,
    });
  });

  it("remaps a conflicting same-id reference and rewrites imported citations and snapshots", async () => {
    const localRef = reference(1, "Versión local");
    const importedRef = reference(1, "Versión importada");
    const imported = essayOf({
      id: fixtureUuid(2, 5),
      cites: [importedRef.id],
      snapshot: [importedRef],
    });
    const plan = await planImport(
      archiveOf({ references: [importedRef], essays: [imported] }),
      localOf({ references: [localRef] }),
      deps(),
    );
    const newId = fixtureUuid(9, 1);
    expect(plan.mergedLibrary.references).toEqual([
      localRef,
      { ...importedRef, id: newId },
    ]);
    const written = essayWrites(plan)[0].essay;
    expect(collectCitationRefIds(written.content)).toEqual([newId]);
    expect(written.referencesSnapshot).toEqual([{ ...importedRef, id: newId }]);
    expect(plan.preview.references).toEqual({
      new: 0,
      identical: 0,
      conflicting: 1,
    });
    expect(plan.preview.essays).toEqual({
      new: 1,
      identical: 0,
      conflicting: 0,
    });
  });
});

describe("planImport collections", () => {
  it("skips a same-id collection that is identical both sides", async () => {
    const shared = reference(1);
    const collection: RefCollection = {
      id: fixtureUuid(3, 1),
      name: "Compartida",
      refIds: [shared.id],
    };
    const plan = await planImport(
      archiveOf({
        references: [{ ...shared }],
        collections: [{ ...collection }],
      }),
      localOf({ references: [shared], collections: [collection] }),
      deps(),
    );
    expect(plan.mergedLibrary.collections).toEqual([collection]);
    expect(plan.preview.collections).toEqual({
      new: 0,
      identical: 1,
      conflicting: 0,
    });
  });

  it("compares collections only after reference remapping", async () => {
    // The imported member is a conflicting reference that will be remapped to
    // the first allocated uuid; the local collection already lists that new
    // id, so after remapping the two collections are identical.
    const localRef = reference(1, "Versión local");
    const importedRef = reference(1, "Versión importada");
    const newId = fixtureUuid(9, 1);
    const plan = await planImport(
      archiveOf({
        references: [importedRef],
        collections: [{
          id: fixtureUuid(3, 1),
          name: "C",
          refIds: [importedRef.id],
        }],
      }),
      localOf({
        references: [localRef],
        collections: [{ id: fixtureUuid(3, 1), name: "C", refIds: [newId] }],
      }),
      deps(),
    );
    expect(plan.preview.collections).toEqual({
      new: 0,
      identical: 1,
      conflicting: 0,
    });
    expect(plan.mergedLibrary.collections).toEqual([
      { id: fixtureUuid(3, 1), name: "C", refIds: [newId] },
    ]);
  });

  it("creates a remapped imported-copy collection on conflict", async () => {
    const localRef = reference(1, "Versión local");
    const importedRef = reference(1, "Versión importada");
    const localCollection: RefCollection = {
      id: fixtureUuid(3, 1),
      name: "Local",
      refIds: [localRef.id],
    };
    const plan = await planImport(
      archiveOf({
        references: [importedRef],
        collections: [{
          id: fixtureUuid(3, 1),
          name: "Importada",
          refIds: [importedRef.id],
        }],
      }),
      localOf({ references: [localRef], collections: [localCollection] }),
      deps(),
    );
    const refNewId = fixtureUuid(9, 1);
    const collectionNewId = fixtureUuid(9, 2);
    expect(plan.mergedLibrary.collections).toEqual([
      localCollection,
      { id: collectionNewId, name: "Importada", refIds: [refNewId] },
    ]);
    expect(plan.preview.collections).toEqual({
      new: 0,
      identical: 0,
      conflicting: 1,
    });
  });

  it("adds a new collection with members mapped through the reference map", async () => {
    const localRef = reference(1, "Versión local");
    const importedRef = reference(1, "Versión importada");
    const kept = reference(2);
    const plan = await planImport(
      archiveOf({
        references: [importedRef, kept],
        collections: [{
          id: fixtureUuid(3, 7),
          name: "Nueva",
          refIds: [importedRef.id, kept.id],
        }],
      }),
      localOf({ references: [localRef, kept] }),
      deps(),
    );
    expect(plan.mergedLibrary.collections).toEqual([
      {
        id: fixtureUuid(3, 7),
        name: "Nueva",
        refIds: [fixtureUuid(9, 1), kept.id],
      },
    ]);
    expect(plan.preview.collections).toEqual({
      new: 1,
      identical: 0,
      conflicting: 0,
    });
  });
});

describe("planImport assets", () => {
  it("reuses same-byte assets and rewrites imported figures to the local path", async () => {
    const localPath = `essays/assets/${fixtureUuid(4, 50)}.png`;
    const archivePath = `assets/${fixtureUuid(4, 1)}.png`;
    const imported = essayOf({
      id: fixtureUuid(2, 1),
      figureSrcs: [archivePath],
    });
    const plan = await planImport(
      archiveOf({
        essays: [imported],
        assets: { [archivePath]: assetOf("sha-a") },
      }),
      localOf({ assets: { [localPath]: "sha-a" } }),
      deps(),
    );
    expect(assetWrites(plan)).toHaveLength(0);
    expect(plan.preview.assets).toEqual({ reused: 1, added: 0 });
    expect(collectFigureSources(essayWrites(plan)[0].essay.content)).toEqual([
      localPath,
    ]);
  });

  it("allocates a collision-free new path for different bytes", async () => {
    const archivePath = `assets/${fixtureUuid(4, 1)}.png`;
    const collidingPath = `essays/assets/${fixtureUuid(9, 1)}.png`;
    const imported = essayOf({
      id: fixtureUuid(2, 1),
      figureSrcs: [archivePath],
    });
    const plan = await planImport(
      archiveOf({
        essays: [imported],
        assets: { [archivePath]: assetOf("sha-b") },
      }),
      localOf({
        assets: { [`essays/assets/${fixtureUuid(4, 2)}.png`]: "sha-other" },
        extraAssetPaths: [collidingPath],
      }),
      deps(),
    );
    const writes = assetWrites(plan);
    expect(writes).toHaveLength(1);
    expect(writes[0].localPath).toBe(`essays/assets/${fixtureUuid(9, 2)}.png`);
    expect(writes[0].archivePath).toBe(archivePath);
    expect(writes[0].sha256).toBe("sha-b");
    expect(plan.preview.assets).toEqual({ reused: 0, added: 1 });
    expect(collectFigureSources(essayWrites(plan)[0].essay.content)).toEqual([
      writes[0].localPath,
    ]);
  });
});

describe("planImport determinism and purity", () => {
  function mixedFixture(): {
    archive: ImportArchiveContent;
    local: LocalImportState;
  } {
    const localRef = reference(1, "Versión local");
    const importedRef = reference(1, "Versión importada");
    const archivePath = `assets/${fixtureUuid(4, 1)}.png`;
    const archive = archiveOf({
      references: [importedRef, reference(2)],
      collections: [{
        id: fixtureUuid(3, 1),
        name: "C",
        refIds: [importedRef.id],
      }],
      essays: [
        essayOf({ id: fixtureUuid(2, 1), bodyText: "Distinto." }),
        essayOf({ id: fixtureUuid(2, 2), figureSrcs: [archivePath] }),
      ],
      assets: { [archivePath]: assetOf("sha-new") },
    });
    const local = localOf({
      references: [localRef],
      essays: [essayOf({ id: fixtureUuid(2, 1) })],
    });
    return { archive, local };
  }

  it("produces identical plans for identical inputs and deps", async () => {
    const a = mixedFixture();
    const b = mixedFixture();
    expect(await planImport(a.archive, a.local, deps())).toEqual(
      await planImport(b.archive, b.local, deps()),
    );
  });

  it("derives sequential operation ids from the transaction id", async () => {
    const { archive, local } = mixedFixture();
    const plan = await planImport(archive, local, deps());
    expect(plan.transactionId).toBe(TXN);
    expect(plan.operations.map((o) => o.opId)).toEqual(
      plan.operations.map((_, i) => `${TXN}/op-${i + 1}`),
    );
    expect(plan.operations.at(-1)?.kind).toBe("mergeLibrary");
  });

  it("never mutates the archive or the local state", async () => {
    const { archive, local } = mixedFixture();
    deepFreeze(archive.essays);
    deepFreeze(archive.library);
    deepFreeze(local.essays);
    deepFreeze(local.library);
    const before = {
      archive: mixedFixture().archive,
      local: mixedFixture().local,
    };
    await planImport(archive, local, deps());
    expect(archive.essays).toEqual(before.archive.essays);
    expect(archive.library).toEqual(before.archive.library);
    expect(local.essays).toEqual(before.local.essays);
    expect(local.library).toEqual(before.local.library);
  });
});

describe("assertPlanConsistent", () => {
  async function validPlanAndLocal(): Promise<
    { plan: ImportPlan; local: LocalImportState }
  > {
    const importedRef = reference(1);
    const archivePath = `assets/${fixtureUuid(4, 1)}.png`;
    const local = localOf({});
    const plan = await planImport(
      archiveOf({
        references: [importedRef],
        collections: [{
          id: fixtureUuid(3, 1),
          name: "C",
          refIds: [importedRef.id],
        }],
        essays: [
          essayOf({
            id: fixtureUuid(2, 1),
            cites: [importedRef.id],
            figureSrcs: [archivePath],
            snapshot: [importedRef],
          }),
        ],
        assets: { [archivePath]: assetOf("sha-x") },
      }),
      local,
      deps(),
    );
    return { plan, local };
  }

  function corrupt(plan: ImportPlan): ImportPlan {
    return JSON.parse(JSON.stringify(plan)) as ImportPlan;
  }

  it("accepts the planner's own output", async () => {
    const { plan, local } = await validPlanAndLocal();
    expect(() => assertPlanConsistent(plan, local)).not.toThrow();
  });

  it("throws on a dangling citation in a planned essay", async () => {
    const { plan, local } = await validPlanAndLocal();
    const broken = corrupt(plan);
    const written = broken.operations.find((o) => o.kind === "writeEssay");
    const doc = (written as EssayWriteOp).essay as unknown as {
      content: {
        content: {
          content: { content: { attrs: { items: { refId: string }[] } }[] }[];
        }[];
      };
      referencesSnapshot: unknown[];
    };
    doc.content.content[0].content[0].content[1].attrs.items[0].refId =
      fixtureUuid(1, 99);
    doc.referencesSnapshot = [];
    expect(() => assertPlanConsistent(broken, local)).toThrow(PlanError);
    expect(() => assertPlanConsistent(broken, local)).toThrow(/citation/);
  });

  it("throws on a figure path with no planned or existing asset", async () => {
    const { plan, local } = await validPlanAndLocal();
    const broken = corrupt(plan);
    broken.operations = broken.operations.filter((o) =>
      o.kind !== "writeAsset"
    );
    expect(() => assertPlanConsistent(broken, local)).toThrow(PlanError);
    expect(() => assertPlanConsistent(broken, local)).toThrow(/figure/);
  });

  it("throws on a dangling collection member", async () => {
    const { plan, local } = await validPlanAndLocal();
    const broken = corrupt(plan);
    broken.mergedLibrary.collections[0].refIds.push(fixtureUuid(1, 77));
    expect(() => assertPlanConsistent(broken, local)).toThrow(PlanError);
    expect(() => assertPlanConsistent(broken, local)).toThrow(/collection/);
  });

  it("throws when a planned essay would overwrite an existing one", async () => {
    const { plan, local } = await validPlanAndLocal();
    const broken = corrupt(plan);
    const withExisting: LocalImportState = {
      ...local,
      existingEssayIds: new Set([fixtureUuid(2, 1)]),
    };
    expect(() => assertPlanConsistent(broken, withExisting)).toThrow(PlanError);
    expect(() => assertPlanConsistent(broken, withExisting)).toThrow(
      /overwrite/,
    );
  });
});

describe("planImport self-import (task 5.8)", () => {
  it("fully skips re-importing an unchanged illustrated export", async () => {
    const png = pngBytes(32, 24);
    const pngSha = await sha256Hex(png);
    const localSrc = `essays/assets/${fixtureUuid(4, 1)}.png`;
    const ref = reference(1);
    const localEssay = essayOf({
      id: fixtureUuid(2, 1),
      cites: [ref.id],
      figureSrcs: [localSrc],
      snapshot: [ref],
    });
    const collection: RefCollection = {
      id: fixtureUuid(3, 1),
      name: "Con figuras",
      refIds: [ref.id],
    };

    // Export: normalize figure paths to `assets/...` exactly as a real
    // archive build does.
    const content = assembleArchiveContent({
      essays: [localEssay],
      library: {
        schemaVersion: 1,
        references: [ref],
        collections: [collection],
      },
      assets: new Map([[localSrc, png]]),
    });
    const archiveAssets: Record<string, ValidatedAsset> = {};
    for (const [path, bytes] of content.assets) {
      archiveAssets[path] = {
        bytes,
        extension: "png",
        width: 32,
        height: 24,
        frames: 1,
        sha256: await sha256Hex(bytes),
      };
    }
    const archive: ImportArchiveContent = {
      essays: content.essays,
      library: {
        schemaVersion: 1,
        references: content.library.references,
        collections: content.library.collections ?? [],
      },
      assets: new Map(Object.entries(archiveAssets)),
    };

    const local = localOf({
      essays: [localEssay],
      references: [ref],
      collections: [collection],
      assets: { [localSrc]: pngSha },
    });
    const plan = await planImport(archive, local, deps());

    expect(plan.preview).toEqual({
      essays: { new: 0, identical: 1, conflicting: 0 },
      references: { new: 0, identical: 1, conflicting: 0 },
      collections: { new: 0, identical: 1, conflicting: 0 },
      assets: { reused: 1, added: 0 },
    });
    expect(essayWrites(plan)).toHaveLength(0);
    expect(assetWrites(plan)).toHaveLength(0);
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0].kind).toBe("mergeLibrary");
    expect(plan.mergedLibrary).toEqual({
      schemaVersion: 1,
      references: [ref],
      collections: [collection],
    });
  });
});

describe("importedCopyTitleSuffix", () => {
  it("follows the essay's document language, not the UI language", () => {
    expect(importedCopyTitleSuffix("es")).toBe(" (copia importada)");
    expect(importedCopyTitleSuffix("en")).toBe(" (imported copy)");
  });
});

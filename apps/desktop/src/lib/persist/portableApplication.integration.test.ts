import { describe, expect, it } from "vitest";
import desktopPackage from "../../../package.json" with { type: "json" };
import type { Essay } from "$lib/model/essay";
import { canonicalJsonBytes } from "$lib/portable/canonicalJson";
import { snapshotContentDigest } from "$lib/portable/contentDigest";
import {
  conflictVariantOf,
  fixtureUuid,
  fullLibraryFixture,
  type LibraryFixture,
} from "$lib/portable/fixtures/libraries";
import { gifBytes } from "$lib/portable/fixtures/images";
import { collectCitationRefIds } from "$lib/portable/remap";
import {
  collectFigureSources,
  rewriteFigureSources,
} from "$lib/portable/snapshot";
import { sha256Hex } from "$lib/portable/archive";
import {
  createLibraryArchiveService,
  type LibraryArchiveService,
} from "./archiveService.ts";
import { PersistenceCoordinator } from "./coordinator.ts";
import { captureLocalImportState } from "./importFlow.ts";
import type { ImportFs } from "./importJournal.ts";
import { captureStableSnapshot, type SnapshotIo } from "./librarySnapshot.ts";
import { OperationCoordinator } from "./operationCoordinator.ts";
import {
  type ExternalFs,
  type ReplacementJournal,
  type ReplacementRecord,
} from "./portableFiles.ts";
import {
  createPortableLibraryRuntime,
  type PortableLibraryRuntime,
} from "./portableRuntime.ts";

const EXPORT_PATH = "/exports/full-library.tesina";
const RESTORED_EXPORT_PATH = "/exports/restored-library.tesina";
const NOW = "2026-08-18T12:00:00.000Z";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

class MemoryAppData implements ImportFs, SnapshotIo {
  generation = 0;

  constructor(readonly files = new Map<string, Uint8Array>()) {}

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path));
  }

  readBytes(path: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.files.get(path) ?? null);
  }

  readBytesBounded(
    path: string,
    maxBytes: number,
  ): Promise<Uint8Array | null> {
    const bytes = this.files.get(path);
    if (bytes !== undefined && bytes.byteLength > maxBytes) {
      return Promise.reject(new Error("file too large"));
    }
    return Promise.resolve(bytes ?? null);
  }

  writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    this.generation += 1;
    this.files.set(path, bytes);
    return Promise.resolve();
  }

  rename(from: string, to: string): Promise<void> {
    const bytes = this.files.get(from);
    if (bytes === undefined) {
      return Promise.reject(new Error(`missing ${from}`));
    }
    if (this.files.has(to)) return Promise.reject(new Error(`exists ${to}`));
    this.generation += 1;
    this.files.set(to, bytes);
    this.files.delete(from);
    return Promise.resolve();
  }

  remove(path: string): Promise<void> {
    this.generation += 1;
    this.files.delete(path);
    return Promise.resolve();
  }

  removeDir(directory: string): Promise<void> {
    this.generation += 1;
    for (const path of [...this.files.keys()]) {
      if (path.startsWith(`${directory}/`)) this.files.delete(path);
    }
    return Promise.resolve();
  }

  list(directory: string): Promise<string[]> {
    const children = new Set<string>();
    for (const path of this.files.keys()) {
      if (!path.startsWith(`${directory}/`)) continue;
      children.add(path.slice(directory.length + 1).split("/")[0]);
    }
    return Promise.resolve([...children].sort());
  }

  listEssayFiles(): Promise<string[]> {
    return this.list("essays").then((children) =>
      children.filter((name) => name.endsWith(".json"))
    );
  }

  async readEssayFile(name: string): Promise<unknown> {
    const bytes = await this.readBytes(`essays/${name}`);
    return bytes === null ? null : JSON.parse(textDecoder.decode(bytes));
  }

  async readLibraryFile(): Promise<unknown> {
    const bytes = await this.readBytes("library.json");
    return bytes === null ? null : JSON.parse(textDecoder.decode(bytes));
  }

  readAssetFile(path: string): Promise<Uint8Array | null> {
    return this.readBytes(path);
  }
}

class ReverseListMemoryAppData extends MemoryAppData {
  override async list(directory: string): Promise<string[]> {
    const entries = await super.list(directory);
    return directory === "essays/assets" ? entries.reverse() : entries;
  }
}

class MemoryExternalFs implements ExternalFs {
  readonly files = new Map<string, Uint8Array>();

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path));
  }

  readFile(path: string): Promise<Uint8Array> {
    const bytes = this.files.get(path);
    return bytes === undefined
      ? Promise.reject(new Error(`missing ${path}`))
      : Promise.resolve(bytes);
  }

  async readFileBounded(
    path: string,
    maxBytes: number,
  ): Promise<Uint8Array> {
    const bytes = await this.readFile(path);
    if (bytes.byteLength > maxBytes) throw new Error("file too large");
    return bytes;
  }

  async sha256File(path: string, maxBytes: number): Promise<string> {
    return await sha256Hex(await this.readFileBounded(path, maxBytes));
  }

  writeFile(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, bytes);
    return Promise.resolve();
  }

  rename(from: string, to: string): Promise<void> {
    const bytes = this.files.get(from);
    if (bytes === undefined) {
      return Promise.reject(new Error(`missing ${from}`));
    }
    this.files.set(to, bytes);
    this.files.delete(from);
    return Promise.resolve();
  }

  renameNoReplace(from: string, to: string): Promise<void> {
    if (this.files.has(to)) return Promise.reject(new Error(`exists ${to}`));
    return this.rename(from, to);
  }

  async removeIfHashMatches(
    path: string,
    expectedSha256: string,
    _installedDestinationSha256?: string,
  ): Promise<void> {
    const bytes = await this.readFile(path);
    if ((await sha256Hex(bytes)) !== expectedSha256) {
      throw new Error(`hash mismatch ${path}`);
    }
    this.files.delete(path);
  }

  remove(path: string): Promise<void> {
    this.files.delete(path);
    return Promise.resolve();
  }

  statSize(path: string): Promise<number | null> {
    return Promise.resolve(this.files.get(path)?.byteLength ?? null);
  }
}

class MemoryReplacementJournal implements ReplacementJournal {
  readonly records = new Map<string, ReplacementRecord>();

  save(record: ReplacementRecord): Promise<void> {
    this.records.set(record.id, record);
    return Promise.resolve();
  }

  list(): Promise<ReplacementRecord[]> {
    return Promise.resolve([...this.records.values()]);
  }

  remove(id: string): Promise<void> {
    this.records.delete(id);
    return Promise.resolve();
  }
}

function deterministicUuid(space: number): () => string {
  let counter = 0;
  return () => fixtureUuid(space, ++counter);
}

function seedFixture(appData: MemoryAppData, fixture: LibraryFixture): void {
  for (const essay of fixture.essays) {
    appData.files.set(`essays/${essay.id}.json`, canonicalJsonBytes(essay));
  }
  appData.files.set("library.json", canonicalJsonBytes(fixture.library));
  for (
    const [path, bytes] of Object.entries({
      ...fixture.assets,
      ...fixture.orphanAssets,
    })
  ) {
    appData.files.set(path, bytes);
  }
}

function createArchiveService(
  appData: MemoryAppData,
  externalFs: MemoryExternalFs,
  replacementJournal: MemoryReplacementJournal,
  coordinator: PersistenceCoordinator,
  uuidSpace: number,
): LibraryArchiveService {
  return createLibraryArchiveService({
    captureSnapshot: () =>
      captureStableSnapshot({
        io: appData,
        flushPending: () => Promise.resolve(),
        generation: () => appData.generation,
      }),
    runMaintenance: (operation) => coordinator.runMaintenance(operation),
    computeContentDigest: snapshotContentDigest,
    appVersion: desktopPackage.version,
    now: () => NOW,
    uuid: deterministicUuid(uuidSpace),
    sha256: sha256Hex,
    writeAppDataFile: (path, bytes) => appData.writeBytes(path, bytes),
    externalFs,
    replacementJournal,
  });
}

function seedNonEmptyDestination(
  appData: MemoryAppData,
  fixture: LibraryFixture,
): {
  localEssayIds: string[];
  localOnlyEssayId: string;
  localReferenceId: string;
  localCollectionId: string;
  collisionPath: string;
  collisionBytes: Uint8Array;
} {
  const spanishConflict = conflictVariantOf(
    fixture.essays[0],
    "Título editado localmente",
  );
  const englishSource = fixture.essays.find((essay) =>
    essay.settings.documentLanguage === "en"
  )!;
  const englishConflict = conflictVariantOf(
    englishSource,
    "Locally edited title",
  );
  const identical = fixture.essays[1];
  // The runtime's deterministic planner first allocates fixtureUuid(31, 2)
  // after its transaction id. Occupy that exact GIF path with other valid
  // GIF bytes and make a local essay reference it.
  const collisionPath = `essays/assets/${fixtureUuid(31, 2)}.gif`;
  const collisionBytes = gifBytes(19, 17, 2);
  const localOnlySource = structuredClone(fixture.essays[2]);
  const [replacedFigurePath] = collectFigureSources(localOnlySource.content);
  const localOnly: Essay = {
    ...localOnlySource,
    id: fixtureUuid(30, 1),
    titlePage: {
      ...fixture.essays[2].titlePage,
      title: "Local-only essay",
    },
    content: rewriteFigureSources(
      localOnlySource.content,
      (path) => path === replacedFigurePath ? collisionPath : path,
    ),
  };
  const essays = [spanishConflict, englishConflict, identical, localOnly];
  appData.files.set(collisionPath, collisionBytes);
  for (const essay of essays) {
    appData.files.set(`essays/${essay.id}.json`, canonicalJsonBytes(essay));
    for (const source of collectFigureSources(essay.content)) {
      if (source !== collisionPath) {
        appData.files.set(source, fixture.assets[source]);
      }
    }
  }

  const conflictingReference = structuredClone(fixture.library.references[0]);
  conflictingReference.title = "Locally edited reference";
  const localReference = {
    type: "website" as const,
    id: fixtureUuid(30, 2),
    authors: [],
    date: { year: 2026 },
    title: "Local-only reference",
    url: "https://example.invalid/local-only",
  };
  const conflictingCollection = {
    ...fixture.library.collections[0],
    name: "Locally edited collection",
    refIds: [localReference.id],
  };
  const localCollection = {
    id: fixtureUuid(30, 3),
    name: "Local-only collection",
    refIds: [localReference.id],
  };
  appData.files.set(
    "library.json",
    canonicalJsonBytes({
      schemaVersion: 1,
      references: [
        conflictingReference,
        fixture.library.references[1],
        localReference,
      ],
      collections: [conflictingCollection, localCollection],
    }),
  );
  return {
    localEssayIds: essays.map((essay) => essay.id),
    localOnlyEssayId: localOnly.id,
    localReferenceId: localReference.id,
    localCollectionId: localCollection.id,
    collisionPath,
    collisionBytes,
  };
}

function createRuntime(
  appData: MemoryAppData,
  archiveService: LibraryArchiveService,
  externalFs: MemoryExternalFs,
  coordinator: PersistenceCoordinator,
  uuidSpace: number,
): PortableLibraryRuntime {
  const operationCoordinator = new OperationCoordinator();
  return createPortableLibraryRuntime({
    getArchiveService: () => Promise.resolve(archiveService),
    externalFs,
    importFs: appData,
    runMaintenance: (operation) => coordinator.runMaintenance(operation),
    flushPending: () => Promise.resolve(),
    runOperation: (kind, operation) =>
      operationCoordinator.run(kind, operation),
    uuid: deterministicUuid(uuidSpace),
    now: () => NOW,
  });
}

describe("portable library application integration", () => {
  it("re-exports the complete fixture after restoring one deleted essay", async () => {
    const fixture = fullLibraryFixture();
    const duplicateFigurePath = `essays/assets/${fixtureUuid(4, 73)}.gif`;
    const deletedEssay = fixture.essays.find((essay) =>
      collectFigureSources(essay.content).includes(duplicateFigurePath)
    );
    expect(deletedEssay).toBeDefined();
    const appData = new ReverseListMemoryAppData();
    seedFixture(appData, fixture);
    const externalFs = new MemoryExternalFs();
    const replacementJournal = new MemoryReplacementJournal();
    const coordinator = new PersistenceCoordinator();
    const service = createArchiveService(
      appData,
      externalFs,
      replacementJournal,
      coordinator,
      23,
    );
    const runtime = createRuntime(
      appData,
      service,
      externalFs,
      coordinator,
      33,
    );

    await runtime.exportToFile(EXPORT_PATH);
    await appData.remove(`essays/${deletedEssay!.id}.json`);

    const restorePreview = await runtime.previewFile(EXPORT_PATH);
    expect(restorePreview.preview.essays).toEqual({
      new: 1,
      identical: fixture.essays.length - 1,
      conflicting: 0,
    });
    expect(restorePreview.preview.assets).toEqual({
      reused: Object.keys(fixture.assets).length,
      added: 0,
    });
    expect((await runtime.applyImport(restorePreview)).kind).toBe("applied");
    const restoredEssay = await appData.readEssayFile(
      `${deletedEssay!.id}.json`,
    ) as Essay;
    expect(collectFigureSources(restoredEssay.content)).toEqual(
      collectFigureSources(deletedEssay!.content),
    );

    await runtime.exportToFile(RESTORED_EXPORT_PATH);
    const restoredExport = await runtime.previewFile(RESTORED_EXPORT_PATH);
    expect(restoredExport.archive.manifest.counts).toEqual({
      essays: fixture.essays.length,
      references: fixture.library.references.length,
      collections: fixture.library.collections.length,
      assets: Object.keys(fixture.assets).length,
    });
  });

  it("exports, reopens, merges, and reloads a complete library without overwriting local content", async () => {
    const fixture = fullLibraryFixture();
    const externalFs = new MemoryExternalFs();
    const replacementJournal = new MemoryReplacementJournal();
    const previousExport = textEncoder.encode("existing destination content");
    externalFs.files.set(EXPORT_PATH, previousExport);

    const sourceAppData = new MemoryAppData();
    seedFixture(sourceAppData, fixture);
    const sourceCoordinator = new PersistenceCoordinator();
    const sourceService = createArchiveService(
      sourceAppData,
      externalFs,
      replacementJournal,
      sourceCoordinator,
      20,
    );
    const sourceRuntime = createRuntime(
      sourceAppData,
      sourceService,
      externalFs,
      sourceCoordinator,
      40,
    );

    const exported = await sourceRuntime.exportToFile(EXPORT_PATH);
    expect(exported.path).toBe(EXPORT_PATH);
    expect(externalFs.files.get(EXPORT_PATH)).not.toEqual(previousExport);
    expect(replacementJournal.records.size).toBe(0);
    expect(
      [...externalFs.files.keys()].some((path) =>
        path.endsWith(".tmp") || path.endsWith(".prev")
      ),
    ).toBe(false);

    const sourceRestorePreview = await sourceRuntime.previewFile(EXPORT_PATH);
    expect(sourceRestorePreview.preview.essays).toEqual({
      new: 0,
      identical: fixture.essays.length,
      conflicting: 0,
    });
    expect(
      sourceRestorePreview.plan.operations.filter((operation) =>
        operation.kind === "writeEssay"
      ),
    ).toHaveLength(0);

    const destinationAppData = new MemoryAppData();
    const seeded = seedNonEmptyDestination(destinationAppData, fixture);
    const originalLocalFiles = new Map(
      [...destinationAppData.files.entries()]
        .filter(([path]) => path !== "library.json")
        .map(([path, bytes]) => [path, bytes.slice()]),
    );
    const destinationCoordinator = new PersistenceCoordinator();
    const destinationService = createArchiveService(
      destinationAppData,
      externalFs,
      replacementJournal,
      destinationCoordinator,
      21,
    );
    const destinationRuntime = createRuntime(
      destinationAppData,
      destinationService,
      externalFs,
      destinationCoordinator,
      31,
    );

    const preview = await destinationRuntime.previewFile(EXPORT_PATH);
    const archive = preview.archive;
    expect(archive.manifest.counts).toEqual({
      essays: fixture.essays.length,
      references: fixture.library.references.length,
      collections: fixture.library.collections.length,
      assets: Object.keys(fixture.assets).length,
    });
    for (const orphanPath of Object.keys(fixture.orphanAssets)) {
      expect(
        archive.assets.has(orphanPath.replace(/^essays\//, "")),
      ).toBe(false);
    }
    expect(preview.preview.essays).toEqual({
      new: fixture.essays.length - 3,
      identical: 1,
      conflicting: 2,
    });
    expect(preview.preview.references).toEqual({
      new: fixture.library.references.length - 2,
      identical: 1,
      conflicting: 1,
    });
    expect(preview.preview.collections).toEqual({
      new: 0,
      identical: 0,
      conflicting: fixture.library.collections.length,
    });
    expect(
      preview.preview.assets.reused + preview.preview.assets.added,
    ).toBe(archive.manifest.counts.assets);
    expect(preview.preview.assets.reused).toBeGreaterThan(0);

    const firstAssetWrite = preview.plan.operations.find((operation) =>
      operation.kind === "writeAsset"
    );
    expect(firstAssetWrite?.kind).toBe("writeAsset");
    if (firstAssetWrite?.kind !== "writeAsset") {
      expect.unreachable("the full fixture must add an asset");
    }
    expect(firstAssetWrite.archivePath.endsWith(".gif")).toBe(true);
    expect(firstAssetWrite.localPath).not.toBe(seeded.collisionPath);
    expect(firstAssetWrite.localPath).toBe(
      `essays/assets/${fixtureUuid(31, 3)}.gif`,
    );
    expect(
      archive.assets.get(firstAssetWrite.archivePath)?.sha256,
    ).not.toBe(await sha256Hex(seeded.collisionBytes));

    const applied = await destinationRuntime.applyImport(preview);
    expect(applied.kind).toBe("applied");

    // Simulate a new application process: reconstruct the adapter and run
    // the same recovery gate the route executes before state is interactive.
    const reloadedAppData = new MemoryAppData(destinationAppData.files);
    const reloadedCoordinator = new PersistenceCoordinator();
    const reloadedService = createArchiveService(
      reloadedAppData,
      externalFs,
      replacementJournal,
      reloadedCoordinator,
      22,
    );
    const reloadedRuntime = createRuntime(
      reloadedAppData,
      reloadedService,
      externalFs,
      reloadedCoordinator,
      32,
    );
    const recovery = await reloadedRuntime.runStartupRecovery();
    expect(recovery).toHaveLength(1);
    expect(recovery[0].kind).toBe("already-complete");

    const reloaded = await captureLocalImportState(reloadedAppData);
    expect(reloaded.local.essays).toHaveLength(
      seeded.localEssayIds.length + preview.preview.essays.new +
        preview.preview.essays.conflicting,
    );
    for (const sourceEssay of fixture.essays) {
      const reloadedEssay = reloaded.local.essays.find((essay) =>
        essay.sourceEssayId === sourceEssay.id
      ) ?? reloaded.local.essays.find((essay) =>
        essay.id === sourceEssay.id
      );
      expect(reloadedEssay, `reloaded essay ${sourceEssay.id}`).toBeDefined();

      const sourceFigureHashes = collectFigureSources(sourceEssay.content).map(
        (path) => archive.assets.get(path.replace(/^essays\//, ""))!.sha256,
      );
      const reloadedFigureHashes = await Promise.all(
        collectFigureSources(reloadedEssay!.content).map(async (path) => {
          const bytes = await reloadedAppData.readBytes(path);
          expect(bytes, `figure ${path}`).not.toBeNull();
          return await sha256Hex(bytes!);
        }),
      );
      expect(reloadedFigureHashes, `figure bytes for ${sourceEssay.id}`)
        .toEqual(
          sourceFigureHashes,
        );
    }

    const localOnlyEssay = reloaded.local.essays.find((essay) =>
      essay.id === seeded.localOnlyEssayId
    )!;
    expect(collectFigureSources(localOnlyEssay.content)).toContain(
      seeded.collisionPath,
    );
    expect(await reloadedAppData.readBytes(seeded.collisionPath)).toEqual(
      seeded.collisionBytes,
    );

    const importedSource = fixture.essays.find((essay) =>
      collectFigureSources(essay.content).includes(
        `essays/${firstAssetWrite.archivePath}`,
      )
    )!;
    const importedEssay =
      reloaded.local.essays.find((essay) =>
        essay.sourceEssayId === importedSource.id
      ) ?? reloaded.local.essays.find((essay) =>
        essay.id === importedSource.id
      )!;
    const importedAssetHash = archive.assets.get(
      firstAssetWrite.archivePath,
    )!.sha256;
    let importedFigurePath: string | undefined;
    for (const path of collectFigureSources(importedEssay.content)) {
      const bytes = await reloadedAppData.readBytes(path);
      if (bytes !== null && (await sha256Hex(bytes)) === importedAssetHash) {
        importedFigurePath = path;
      }
    }
    expect(importedFigurePath).toBeDefined();
    expect(importedFigurePath).not.toBe(seeded.collisionPath);

    // Additive targets and same-id conflicts never replace local files.
    for (const [path, bytes] of originalLocalFiles) {
      expect(reloadedAppData.files.get(path), path).toEqual(bytes);
    }
    const reloadedReferences = new Map(
      reloaded.local.library.references.map((reference) => [
        reference.id,
        reference,
      ]),
    );
    expect(reloadedReferences.get(fixture.library.references[0].id)?.title)
      .toBe("Locally edited reference");
    expect(reloadedReferences.has(seeded.localReferenceId)).toBe(true);
    const reloadedCollections = new Map(
      reloaded.local.library.collections.map((collection) => [
        collection.id,
        collection,
      ]),
    );
    expect(reloadedCollections.get(fixture.library.collections[0].id)?.name)
      .toBe("Locally edited collection");
    expect(reloadedCollections.has(seeded.localCollectionId)).toBe(true);

    const referenceIds = new Set(reloadedReferences.keys());
    for (const essay of [localOnlyEssay, importedEssay]) {
      for (const refId of collectCitationRefIds(essay.content)) {
        expect(referenceIds.has(refId), `citation ${refId}`).toBe(true);
      }
      for (const reference of essay.referencesSnapshot) {
        expect(referenceIds.has(reference.id), `snapshot ${reference.id}`)
          .toBe(true);
      }
    }
    const archiveAssetHashes = new Set(
      [...archive.assets.values()].map((asset) => asset.sha256),
    );
    const collisionHash = await sha256Hex(seeded.collisionBytes);
    const figureExtensions = new Set<string>();
    for (const essay of reloaded.local.essays) {
      for (const refId of collectCitationRefIds(essay.content)) {
        expect(referenceIds.has(refId), `citation ${refId}`).toBe(true);
      }
      for (const reference of essay.referencesSnapshot) {
        expect(referenceIds.has(reference.id), `snapshot ${reference.id}`)
          .toBe(true);
      }
      for (const path of collectFigureSources(essay.content)) {
        const bytes = await reloadedAppData.readBytes(path);
        expect(bytes, `figure ${path}`).not.toBeNull();
        const hash = await sha256Hex(bytes!);
        expect(
          archiveAssetHashes.has(hash) || hash === collisionHash,
          path,
        ).toBe(true);
        figureExtensions.add(path.split(".").at(-1)!);
      }
    }
    for (const collection of reloaded.local.library.collections) {
      for (const refId of collection.refIds) {
        expect(referenceIds.has(refId), `collection member ${refId}`).toBe(
          true,
        );
      }
    }
    expect(figureExtensions).toEqual(new Set(["bmp", "gif", "jpg", "png"]));
  });
});

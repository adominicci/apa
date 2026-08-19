import { describe, expect, it, vi } from "vitest";
import {
  applyConfirmedImport,
  captureLocalImportState,
  type ImportFlowDeps,
  previewImport,
} from "./importFlow.ts";
import type { ImportFs } from "./importJournal.ts";
import { buildArchive, sha256Hex } from "$lib/portable/archive";
import { canonicalJsonBytes } from "$lib/portable/canonicalJson";
import {
  assembleArchiveContent,
  collectFigureSources,
} from "$lib/portable/snapshot";
import {
  figureHeavyLibraryFixture,
  fixtureUuid,
} from "$lib/portable/fixtures/libraries";
import type { Essay } from "$lib/model/essay";

/**
 * Task 11.2 (application-level integration, TS half): export a fixture,
 * import into a NON-EMPTY destination with same-id conflicts and identical
 * content, check preview counts, apply, and prove every relationship
 * resolves with no local overwrite. Plus the amended plan-freshness loop.
 */

class MemoryAppData implements ImportFs {
  files = new Map<string, Uint8Array>();
  exists(p: string): Promise<boolean> {
    return Promise.resolve(this.files.has(p));
  }
  readBytes(p: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.files.get(p) ?? null);
  }
  writeBytes(p: string, bytes: Uint8Array): Promise<void> {
    this.files.set(p, bytes);
    return Promise.resolve();
  }
  rename(from: string, to: string): Promise<void> {
    const bytes = this.files.get(from);
    if (!bytes) return Promise.reject(new Error(`missing ${from}`));
    this.files.set(to, bytes);
    this.files.delete(from);
    return Promise.resolve();
  }
  remove(p: string): Promise<void> {
    this.files.delete(p);
    return Promise.resolve();
  }
  removeDir(dir: string): Promise<void> {
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(`${dir}/`)) this.files.delete(key);
    }
    return Promise.resolve();
  }
  list(dir: string): Promise<string[]> {
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (key.startsWith(`${dir}/`)) {
        const rest = key.slice(dir.length + 1);
        // Only direct children that are files at this level.
        if (!rest.includes("/")) names.add(rest);
        else names.add(rest.split("/")[0]);
      }
    }
    return Promise.resolve([...names]);
  }
}

function makeDeps(fs: MemoryAppData): ImportFlowDeps {
  let uuidCounter = 100;
  return {
    fs,
    runMaintenance: (fn) => fn(),
    flushPending: () => Promise.resolve(),
    createRollback: async (transactionId) => {
      // Real rollback: archive the current on-disk state.
      const state = await captureLocalImportState(fs);
      const assets = new Map<string, Uint8Array>();
      for (const essay of state.local.essays) {
        for (const src of collectFigureSources(essay.content)) {
          const bytes = fs.files.get(src);
          if (bytes) assets.set(src, bytes);
        }
      }
      const bytes = await buildArchive(
        assembleArchiveContent({
          essays: state.local.essays,
          library: {
            schemaVersion: 1,
            references: state.local.library.references,
            collections: state.local.library.collections,
          },
          assets,
        }),
        { now: () => "2026-01-01T00:00:00.000Z", appVersion: "0.1.1" },
      );
      const relPath = `backups/imports/${transactionId}.tesina`;
      fs.files.set(relPath, bytes);
      return { relPath, sha256: await sha256Hex(bytes) };
    },
    recoverImport: (transactionId) =>
      Promise.resolve({
        kind: "recovery-required",
        transactionId,
        reason: "test recovery was not configured",
      }),
    uuid: () => fixtureUuid(11, ++uuidCounter),
    now: () => "2026-04-01T12:00:00.000Z",
  };
}

/** Seeds the destination: 1 identical essay, 1 conflicting, own content. */
function seedDestination(
  fs: MemoryAppData,
  fixture: ReturnType<typeof figureHeavyLibraryFixture>,
): { conflictingId: string; identicalId: string } {
  const identical = fixture.essays[0];
  const conflicting: Essay = structuredClone(fixture.essays[1]);
  conflicting.titlePage = {
    ...conflicting.titlePage,
    title: "Locally edited title",
  };
  fs.files.set(
    `essays/${identical.id}.json`,
    canonicalJsonBytes(identical),
  );
  fs.files.set(
    `essays/${conflicting.id}.json`,
    canonicalJsonBytes(conflicting),
  );
  for (const essay of [identical, conflicting]) {
    for (const src of collectFigureSources(essay.content)) {
      fs.files.set(src, fixture.assets[src]);
    }
  }
  fs.files.set(
    "library.json",
    canonicalJsonBytes({
      schemaVersion: 1,
      references: fixture.library.references.slice(0, 5),
      collections: [],
    }),
  );
  return { conflictingId: conflicting.id, identicalId: identical.id };
}

async function exportFixtureArchive(
  fixture: ReturnType<typeof figureHeavyLibraryFixture>,
): Promise<Uint8Array> {
  return await buildArchive(
    assembleArchiveContent({
      essays: fixture.essays.slice(0, 4),
      library: fixture.library,
      assets: new Map(Object.entries(fixture.assets)),
    }),
    { now: () => "2026-01-20T08:30:00.000Z", appVersion: "0.1.1" },
  );
}

describe("import flow integration", () => {
  it("chooses a deterministic reusable asset path from native directory order", async () => {
    const fs = new MemoryAppData();
    const bytes = new Uint8Array([1, 2, 3]);
    const sha256 = await sha256Hex(bytes);
    const firstArchivePath = `assets/${fixtureUuid(4, 1)}.png`;
    const secondArchivePath = `assets/${fixtureUuid(4, 2)}.png`;
    const firstLocalPath = `essays/${firstArchivePath}`;
    const secondLocalPath = `essays/${secondArchivePath}`;
    const validatedAsset = {
      bytes,
      extension: "png",
      width: 1,
      height: 1,
      frames: 1,
      sha256,
    } as const;
    const archiveAssets = new Map([
      [firstArchivePath, validatedAsset],
      [secondArchivePath, validatedAsset],
    ]);
    fs.files.set(secondLocalPath, bytes);
    fs.files.set(firstLocalPath, bytes);

    const { local } = await captureLocalImportState(fs, archiveAssets);
    const assetClass = local.assetClassByLocalPath.get(firstLocalPath);
    expect(assetClass).toBeDefined();
    expect(local.reusableAssetPathByClass.get(assetClass!)).toBe(
      firstLocalPath,
    );
  });

  it("previews, applies, and resolves everything without local overwrite", async () => {
    const fixture = figureHeavyLibraryFixture();
    const fs = new MemoryAppData();
    const { conflictingId, identicalId } = seedDestination(fs, fixture);
    const localConflictBytes = fs.files.get(`essays/${conflictingId}.json`)!;
    const deps = makeDeps(fs);

    const archiveBytes = await exportFixtureArchive(fixture);
    const preview = await previewImport(archiveBytes, deps);

    expect(preview.preview.essays).toEqual({
      new: 2,
      identical: 1,
      conflicting: 1,
    });
    // The 5 seeded references are identical same-id copies of the archive's.
    expect(preview.preview.references.identical).toBe(5);
    expect(preview.preview.references.new).toBe(25);

    const result = await applyConfirmedImport(preview, deps);
    expect(result.kind).toBe("applied");

    // The local conflicting essay is byte-identical (never overwritten).
    expect(fs.files.get(`essays/${conflictingId}.json`)).toBe(
      localConflictBytes,
    );
    // The imported copy exists with provenance and the language suffix.
    const copies = [...fs.files.entries()].filter(([path, bytes]) => {
      if (!path.startsWith("essays/") || path.includes("assets")) return false;
      const essay = JSON.parse(new TextDecoder().decode(bytes)) as Essay;
      return essay.sourceEssayId === conflictingId;
    });
    expect(copies.length).toBe(1);
    const copy = JSON.parse(
      new TextDecoder().decode(copies[0][1]),
    ) as Essay;
    expect(copy.importedAt).toBe("2026-04-01T12:00:00.000Z");
    expect(copy.titlePage.title).toContain("(copia importada)");

    // Identical essay was skipped: still exactly one file with that id.
    const identicalFiles = [...fs.files.keys()].filter((p) =>
      p === `essays/${identicalId}.json`
    );
    expect(identicalFiles.length).toBe(1);

    // Full referential integrity of the final state.
    const state = await captureLocalImportState(fs);
    const refIds = new Set(state.local.library.references.map((r) => r.id));
    for (const essay of state.local.essays) {
      for (const src of collectFigureSources(essay.content)) {
        expect(fs.files.has(src), `figure ${src}`).toBe(true);
      }
      for (const ref of essay.referencesSnapshot) {
        expect(typeof ref.id).toBe("string");
      }
    }
    for (const collection of state.local.library.collections) {
      for (const refId of collection.refIds) {
        expect(refIds.has(refId), `member ${refId}`).toBe(true);
      }
    }
    // Rollback retained; staging cleaned.
    expect(
      [...fs.files.keys()].some((p) => p.startsWith("backups/imports/")),
    ).toBe(true);
    expect([...fs.files.keys()].some((p) => p.includes("/stage/"))).toBe(false);
  });

  it("requires re-confirmation when an identical essay changes after preview", async () => {
    const fixture = figureHeavyLibraryFixture();
    const fs = new MemoryAppData();
    const { identicalId } = seedDestination(fs, fixture);
    const deps = makeDeps(fs);
    const preview = await previewImport(
      await exportFixtureArchive(fixture),
      deps,
    );

    const path = `essays/${identicalId}.json`;
    const edited = JSON.parse(new TextDecoder().decode(fs.files.get(path)!));
    edited.titlePage.title = "Edited while import preview was open";
    fs.files.set(path, canonicalJsonBytes(edited));

    const result = await applyConfirmedImport(preview, deps);
    expect(result.kind).toBe("replan-needed");
    if (result.kind !== "replan-needed") return;
    expect(result.next.preview.essays).toEqual({
      new: 2,
      identical: 0,
      conflicting: 2,
    });
    expect(
      [...fs.files.keys()].some((entry) => entry.includes("/stage/")),
    ).toBe(false);
  });

  it("runs immediate recovery when apply fails after the journal is durable", async () => {
    const fixture = figureHeavyLibraryFixture();
    const fs = new MemoryAppData();
    seedDestination(fs, fixture);
    const deps = makeDeps(fs);
    const recoverImport = vi.fn(() =>
      Promise.resolve({
        kind: "recovery-required" as const,
        transactionId: "tx",
        reason: "injected recovery block",
      })
    );
    deps.recoverImport = recoverImport;
    const preview = await previewImport(
      await exportFixtureArchive(fixture),
      deps,
    );
    const originalRename = fs.rename.bind(fs);
    let failed = false;
    fs.rename = (from, to) => {
      if (!failed && to.startsWith("essays/") && !to.includes("/stage/")) {
        failed = true;
        return Promise.reject(new Error("injected apply failure"));
      }
      return originalRename(from, to);
    };

    await expect(applyConfirmedImport(preview, deps)).rejects.toMatchObject({
      code: "import/recovery-required",
    });
    expect(recoverImport).toHaveBeenCalledOnce();
  });

  it("replans transparently when the library gains unrelated content mid-flow", async () => {
    const fixture = figureHeavyLibraryFixture();
    const fs = new MemoryAppData();
    seedDestination(fs, fixture);
    const deps = makeDeps(fs);
    const preview = await previewImport(
      await exportFixtureArchive(fixture),
      deps,
    );

    // The user adds an UNRELATED reference while the preview is open.
    const library = JSON.parse(
      new TextDecoder().decode(fs.files.get("library.json")!),
    );
    library.references.push({
      type: "website",
      id: fixtureUuid(12, 1),
      authors: [],
      date: { year: 2026 },
      title: "Nueva referencia local",
    });
    fs.files.set("library.json", canonicalJsonBytes(library));

    const result = await applyConfirmedImport(preview, deps);
    // Counts unchanged (the addition is unrelated) → applied transparently,
    // and the local mid-flow addition survives in the merged library.
    expect(result.kind).toBe("applied");
    const merged = JSON.parse(
      new TextDecoder().decode(fs.files.get("library.json")!),
    );
    expect(
      merged.references.some((r: { id: string }) =>
        r.id === fixtureUuid(12, 1)
      ),
    ).toBe(true);
    // The stale staged transaction and its rollback were retired before the
    // equivalent replacement plan was staged.
    expect(await fs.list("imports")).toHaveLength(1);
    expect(await fs.list("backups/imports")).toHaveLength(1);
  });

  it("removes staging when an additive target appears before journaling", async () => {
    const fixture = figureHeavyLibraryFixture();
    const fs = new MemoryAppData();
    seedDestination(fs, fixture);
    const deps = makeDeps(fs);
    const preview = await previewImport(
      await exportFixtureArchive(fixture),
      deps,
    );
    const additive = preview.plan.operations.find((op) =>
      op.kind === "writeAsset"
    );
    if (!additive || additive.kind !== "writeAsset") {
      expect.unreachable("fixture must plan an additive asset");
    }
    const staleTransactionId = preview.plan.transactionId;
    fs.files.set(additive.localPath, new TextEncoder().encode("appeared"));

    await applyConfirmedImport(preview, deps);

    expect(await fs.list(`imports/${staleTransactionId}`)).toEqual([]);
  });

  it("asks for re-confirmation when the mid-flow change alters the plan", async () => {
    const fixture = figureHeavyLibraryFixture();
    const fs = new MemoryAppData();
    seedDestination(fs, fixture);
    const deps = makeDeps(fs);
    const preview = await previewImport(
      await exportFixtureArchive(fixture),
      deps,
    );

    // The user edits a reference the archive also carries (same id, new
    // content): the replan now counts a conflicting reference.
    const library = JSON.parse(
      new TextDecoder().decode(fs.files.get("library.json")!),
    );
    library.references[0].title = "Edited locally while previewing";
    fs.files.set("library.json", canonicalJsonBytes(library));

    const result = await applyConfirmedImport(preview, deps);
    expect(result.kind).toBe("replan-needed");
    // Re-confirmation must not leave an abandoned journal that blocks the
    // next startup, nor its complete unencrypted rollback archive.
    expect(await fs.list("imports")).toEqual([]);
    expect(await fs.list("backups/imports")).toEqual([]);
    if (result.kind === "replan-needed") {
      expect(result.next.preview.references.conflicting).toBeGreaterThan(0);
      // Confirming the new preview applies cleanly.
      const applied = await applyConfirmedImport(result.next, deps);
      expect(applied.kind).toBe("applied");
    }
  });

  it("bounds completed rollback archives after successful imports", async () => {
    const fixture = figureHeavyLibraryFixture();
    const fs = new MemoryAppData();
    const deps = makeDeps(fs);
    const archive = await exportFixtureArchive(fixture);

    for (let index = 0; index < 4; index += 1) {
      const preview = await previewImport(archive, deps);
      expect((await applyConfirmedImport(preview, deps)).kind).toBe("applied");
    }

    expect(await fs.list("imports")).toHaveLength(3);
    expect(await fs.list("backups/imports")).toHaveLength(3);
  });
});

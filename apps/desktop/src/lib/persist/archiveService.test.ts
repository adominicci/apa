import { describe, expect, it } from "vitest";
import { PersistenceCoordinator } from "./coordinator.ts";
import {
  createLibraryArchiveService,
  type LibraryArchiveServiceDeps,
} from "./archiveService.ts";
import { readArchiveStructure, sha256Hex } from "$lib/portable/archive";
import { ARCHIVE_LIMITS } from "$lib/portable/limits";
import { canonicalJsonBytes } from "$lib/portable/canonicalJson";
import type { LibrarySnapshotContent } from "$lib/portable/types";
import { figureHeavyLibraryFixture } from "$lib/portable/fixtures/libraries";

/** Task 4.5: one injected service, one packaging implementation. */

function fixtureSnapshot(): LibrarySnapshotContent {
  const fixture = figureHeavyLibraryFixture();
  return {
    essays: fixture.essays,
    library: fixture.library,
    assets: new Map(Object.entries(fixture.assets)),
  };
}

interface Harness {
  deps: LibraryArchiveServiceDeps;
  externalFiles: Map<string, Uint8Array>;
  appDataFiles: Map<string, Uint8Array>;
  captures: number;
}

function makeHarness(): Harness {
  const externalFiles = new Map<string, Uint8Array>();
  const appDataFiles = new Map<string, Uint8Array>();
  const coordinator = new PersistenceCoordinator();
  let uuidCounter = 0;
  const harness: Harness = {
    externalFiles,
    appDataFiles,
    captures: 0,
    deps: {
      captureSnapshot: () => {
        harness.captures += 1;
        return Promise.resolve(fixtureSnapshot());
      },
      runMaintenance: (fn) => coordinator.runMaintenance(fn),
      computeContentDigest: (content) =>
        sha256Hex(canonicalJsonBytes({
          essays: content.essays.map((e) => e.id).sort(),
          references: content.library.references.length,
        })),
      appVersion: "0.1.1",
      now: () => "2026-01-20T08:30:00.000Z",
      uuid: () =>
        `00000000-0000-4000-8000-9${String(++uuidCounter).padStart(11, "0")}`,
      sha256: sha256Hex,
      writeAppDataFile: (relPath, bytes) => {
        appDataFiles.set(relPath, bytes);
        return Promise.resolve();
      },
      externalFs: {
        exists: (p) => Promise.resolve(externalFiles.has(p)),
        readFile: (p) =>
          externalFiles.has(p)
            ? Promise.resolve(externalFiles.get(p)!)
            : Promise.reject(new Error(`missing ${p}`)),
        writeFile: (p, bytes) => {
          externalFiles.set(p, bytes);
          return Promise.resolve();
        },
        rename: (from, to) => {
          externalFiles.set(to, externalFiles.get(from)!);
          externalFiles.delete(from);
          return Promise.resolve();
        },
        renameNoReplace: (from, to) => {
          if (externalFiles.has(to)) {
            return Promise.reject(new Error("exists"));
          }
          externalFiles.set(to, externalFiles.get(from)!);
          externalFiles.delete(from);
          return Promise.resolve();
        },
        remove: (p) => {
          externalFiles.delete(p);
          return Promise.resolve();
        },
        statSize: (p) => Promise.resolve(externalFiles.get(p)?.length ?? null),
      },
      replacementJournal: {
        save: () => Promise.resolve(),
        list: () => Promise.resolve([]),
        remove: () => Promise.resolve(),
      },
    },
  };
  return harness;
}

describe("createLibraryArchiveService", () => {
  it("produces identical bytes for export, rollback, and backup", async () => {
    const harness = makeHarness();
    const service = createLibraryArchiveService(harness.deps);

    await service.exportToFile("/docs/manual.tesina");
    await service.createRollback("00000000-0000-4000-8000-000000000042");
    await service.writeBackup(
      ["/backups/Tesina Backups/auto.tesina"],
      "00000000-0000-4000-8000-000000000077",
    );

    const manual = harness.externalFiles.get("/docs/manual.tesina")!;
    const rollback = harness.appDataFiles.get(
      "backups/imports/00000000-0000-4000-8000-000000000042.tesina",
    )!;
    const backup = harness.externalFiles.get(
      "/backups/Tesina Backups/auto.tesina",
    )!;
    expect(manual).toBeDefined();
    expect(rollback).toBeDefined();
    expect(backup).toBeDefined();

    // Manual export and rollback bytes are identical (same snapshot, same
    // injected metadata). The backup differs only by its backup marker.
    expect(await sha256Hex(manual)).toBe(await sha256Hex(rollback));
    expect(await sha256Hex(backup)).not.toBe(await sha256Hex(manual));
    const backupStructure = await readArchiveStructure(backup, ARCHIVE_LIMITS);
    expect(backupStructure.manifest.backup?.backupSetId).toBe(
      "00000000-0000-4000-8000-000000000077",
    );
    const manualStructure = await readArchiveStructure(manual, ARCHIVE_LIMITS);
    expect(manualStructure.manifest.backup).toBeUndefined();
  });

  it("returns the digest of the exact captured snapshot", async () => {
    const harness = makeHarness();
    const service = createLibraryArchiveService(harness.deps);
    const packaged = await service.package();
    const expected = await harness.deps.computeContentDigest(packaged.content);
    expect(packaged.contentDigest).toBe(expected);
  });

  it("createRollbackWithinMaintenance never reacquires the lease", async () => {
    // Regression (Codex review): import staging runs inside one maintenance
    // lease and creates the rollback from there; the leased variant would
    // chain behind the running lease and deadlock forever.
    const harness = makeHarness();
    const service = createLibraryArchiveService(harness.deps);
    const result = await harness.deps.runMaintenance(async () => {
      return await service.createRollbackWithinMaintenance(
        "00000000-0000-4000-8000-000000000099",
      );
    });
    expect(result.relPath).toBe(
      "backups/imports/00000000-0000-4000-8000-000000000099.tesina",
    );
    expect(
      harness.appDataFiles.has(result.relPath),
    ).toBe(true);
  });

  it("serializes packaging operations through the maintenance lease", async () => {
    const harness = makeHarness();
    let active = 0;
    let maxActive = 0;
    const inner = harness.deps.captureSnapshot;
    harness.deps.captureSnapshot = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      const result = await inner();
      active -= 1;
      return result;
    };
    const service = createLibraryArchiveService(harness.deps);
    await Promise.all([
      service.package(),
      service.package(),
      service.package(),
    ]);
    expect(maxActive).toBe(1);
    expect(harness.captures).toBe(3);
  });
});

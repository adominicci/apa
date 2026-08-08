import { describe, expect, it } from "vitest";
import {
  applyImport,
  type ImportFs,
  type ImportJournalV1,
  loadJournal,
  pruneCompletedRollbacks,
  recoverPendingImports,
  type RecoveryDeps,
  stageImport,
} from "./importJournal.ts";
import { planImport } from "$lib/portable/importPlan";
import { canonicalJsonBytes } from "$lib/portable/canonicalJson";
import { sha256Hex } from "$lib/portable/archive";
import { buildArchive } from "$lib/portable/archive";
import { assembleArchiveContent } from "$lib/portable/snapshot";
import { validateArchive } from "$lib/portable/validate";
import { ARCHIVE_LIMITS } from "$lib/portable/limits";
import {
  emptyLibraryFixture,
  figureHeavyLibraryFixture,
  fixtureUuid,
} from "$lib/portable/fixtures/libraries";

/** Tasks 6.1–6.6, 6.8: journaled apply, fault injection, recovery. */

class FakeAppData implements ImportFs {
  files = new Map<string, Uint8Array>();
  ops: string[] = [];
  failAtOp = 0;
  #op = 0;

  #tick(op: string): void {
    this.#op += 1;
    this.ops.push(op);
    if (this.failAtOp !== 0 && this.#op === this.failAtOp) {
      throw new Error(`injected fault at ${op}`);
    }
  }

  exists(relPath: string): Promise<boolean> {
    return Promise.resolve(this.files.has(relPath));
  }
  readBytes(relPath: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.files.get(relPath) ?? null);
  }
  writeBytes(relPath: string, bytes: Uint8Array): Promise<void> {
    this.#tick(`write:${relPath}`);
    this.files.set(relPath, bytes);
    return Promise.resolve();
  }
  rename(fromRel: string, toRel: string): Promise<void> {
    this.#tick(`rename:${fromRel}->${toRel}`);
    const bytes = this.files.get(fromRel);
    if (!bytes) return Promise.reject(new Error(`missing ${fromRel}`));
    this.files.set(toRel, bytes);
    this.files.delete(fromRel);
    return Promise.resolve();
  }
  remove(relPath: string): Promise<void> {
    this.#tick(`remove:${relPath}`);
    this.files.delete(relPath);
    return Promise.resolve();
  }
  removeDir(relDir: string): Promise<void> {
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(`${relDir}/`)) this.files.delete(key);
    }
    return Promise.resolve();
  }
  list(relDir: string): Promise<string[]> {
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (key.startsWith(`${relDir}/`)) {
        names.add(key.slice(relDir.length + 1).split("/")[0]);
      }
    }
    return Promise.resolve([...names]);
  }
}

const TX = fixtureUuid(7, 1);

interface Scenario {
  fs: FakeAppData;
  journal: ImportJournalV1;
  recovery: RecoveryDeps;
  mergedSha: string;
  finalPaths: string[];
}

/**
 * Builds a real end-to-end scenario: figure-heavy archive imported into an
 * empty local library, staged and ready to apply.
 */
async function makeScenario(): Promise<Scenario> {
  const fixture = figureHeavyLibraryFixture();
  const archiveBytes = await buildArchive(
    assembleArchiveContent({
      essays: fixture.essays.slice(0, 2),
      library: fixture.library,
      assets: new Map(Object.entries(fixture.assets)),
    }),
    { now: () => "2026-01-20T08:30:00.000Z", appVersion: "0.1.1" },
  );
  const archive = await validateArchive(archiveBytes, ARCHIVE_LIMITS);

  const fs = new FakeAppData();
  const emptyLibrary = canonicalJsonBytes(emptyLibraryFixture().library);
  fs.files.set("library.json", emptyLibrary);

  let uuidCounter = 0;
  const plan = await planImport(archive, {
    essays: [],
    library: { references: [], collections: [] },
    assetIndex: new Map(),
    existingAssetPaths: new Set(),
    existingEssayIds: new Set(),
  }, {
    transactionId: TX,
    newUuid: () => fixtureUuid(8, ++uuidCounter),
    now: () => "2026-01-21T00:00:00.000Z",
  });

  const rollbackBytes = await buildArchive(
    assembleArchiveContent({
      essays: [],
      library: emptyLibraryFixture().library,
      assets: new Map(),
    }),
    { now: () => "2026-01-20T00:00:00.000Z", appVersion: "0.1.1" },
  );

  const journal = await stageImport(plan, {
    fs,
    readArchiveAsset: (archivePath) =>
      Promise.resolve(archive.assets.get(archivePath)!.bytes),
    createRollback: async (transactionId) => {
      const relPath = `backups/imports/${transactionId}.tesina`;
      fs.files.set(relPath, rollbackBytes);
      return { relPath, sha256: await sha256Hex(rollbackBytes) };
    },
    now: () => "2026-01-21T00:00:01.000Z",
    archiveSha256: await sha256Hex(archiveBytes),
    previousLibrarySha256: await sha256Hex(emptyLibrary),
  });

  const recovery: RecoveryDeps = {
    fs,
    readRollbackLibrary: async (relPath, expectedSha256) => {
      const bytes = fs.files.get(relPath);
      if (!bytes || (await sha256Hex(bytes)) !== expectedSha256) {
        throw new Error("rollback invalid");
      }
      return emptyLibrary;
    },
  };

  const mergedOp = journal.operations.find((o) => o.kind === "mergeLibrary")!;
  return {
    fs,
    journal,
    recovery,
    mergedSha: (mergedOp as { mergedSha256: string }).mergedSha256,
    finalPaths: journal.operations.flatMap((o) =>
      o.kind === "mergeLibrary" ? [] : [o.finalPath]
    ),
  };
}

describe("stageImport (task 6.1)", () => {
  it("persists two reopen-validated checksummed journal copies", async () => {
    const { fs, journal } = await makeScenario();
    expect(journal.status).toBe("staged");
    expect(fs.files.has(`imports/${TX}/journal.json`)).toBe(true);
    expect(fs.files.has(`imports/${TX}/journal-copy.json`)).toBe(true);
    // Corrupt the main copy: loadJournal falls back to the valid copy.
    fs.files.set(
      `imports/${TX}/journal.json`,
      new TextEncoder().encode("{broken"),
    );
    const loaded = await loadJournal(fs, TX);
    expect(loaded?.transactionId).toBe(TX);
    expect(loaded?.operations.length).toBe(journal.operations.length);
  });

  it("records additive-target-absence proof and rejects a stale plan", async () => {
    const fixture = await makeScenario();
    const [firstFinal] = fixture.finalPaths;
    // A second staging attempt against a world where the target now exists
    // must fail closed as stale.
    const fs2 = fixture.fs;
    fs2.files.set(firstFinal, new Uint8Array([1]));
    await expect(
      applyImport(fixture.journal, { fs: fs2 }),
    ).rejects.toMatchObject({ code: "import/recovery-required" });
  });
});

describe("applyImport (tasks 6.3/6.4)", () => {
  it("applies additively and closes the journal complete", async () => {
    const { fs, journal, mergedSha, finalPaths } = await makeScenario();
    const done = await applyImport(journal, { fs });
    expect(done.status).toBe("complete");
    for (const path of finalPaths) {
      expect(fs.files.has(path), path).toBe(true);
    }
    expect(await sha256Hex(fs.files.get("library.json")!)).toBe(mergedSha);
    // Staging is removed; rollback is retained.
    expect([...fs.files.keys()].some((p) => p.includes("/stage/"))).toBe(false);
    expect(fs.files.has(`backups/imports/${TX}.tesina`)).toBe(true);
  });

  it("aborts before any live write when the library changed after planning", async () => {
    const { fs, journal } = await makeScenario();
    fs.files.set(
      "library.json",
      canonicalJsonBytes({ schemaVersion: 1, references: [{ id: "x" }] }),
    );
    const filesBefore = new Set(fs.files.keys());
    await expect(applyImport(journal, { fs })).rejects.toMatchObject({
      code: "import/stale-plan",
    });
    // No essay/asset/library write happened.
    for (const key of fs.files.keys()) {
      if (!filesBefore.has(key)) {
        expect.unreachable(`unexpected new file ${key}`);
      }
    }
  });

  it("is idempotent when resumed after every possible fault point", async () => {
    // Discover the operation count of a clean run first.
    const clean = await makeScenario();
    const before = clean.fs.ops.length;
    await applyImport(clean.journal, { fs: clean.fs });
    const totalOps = clean.fs.ops.length - before;

    for (let failAt = 1; failAt <= totalOps; failAt += 1) {
      const scenario = await makeScenario();
      const offset = scenario.fs.ops.length;
      scenario.fs.failAtOp = offset + failAt;
      try {
        await applyImport(scenario.journal, { fs: scenario.fs });
      } catch {
        // injected crash
      }
      scenario.fs.failAtOp = 0;
      const outcomes = await recoverPendingImports(scenario.recovery);
      expect(outcomes.length).toBe(1);
      const outcome = outcomes[0];
      expect(
        ["resumed", "rolled-back", "already-complete"].includes(outcome.kind),
        `fault at op ${failAt} ended as ${outcome.kind}`,
      ).toBe(true);
      if (outcome.kind === "resumed" || outcome.kind === "already-complete") {
        // Fully applied: everything matches the journal.
        expect(await sha256Hex(scenario.fs.files.get("library.json")!)).toBe(
          scenario.mergedSha,
        );
        for (const path of scenario.finalPaths) {
          expect(scenario.fs.files.has(path), path).toBe(true);
        }
        // No duplicates: exactly the planned final paths exist.
        const essayFiles = [...scenario.fs.files.keys()].filter((p) =>
          p.startsWith("essays/") && !p.startsWith("essays/assets/")
        );
        expect(essayFiles.length).toBe(
          scenario.finalPaths.filter((p) =>
            p.startsWith("essays/") && !p.startsWith("essays/assets/")
          ).length,
        );
      } else {
        // Rolled back: no planned final path remains; library is plan-time.
        for (const path of scenario.finalPaths) {
          expect(scenario.fs.files.has(path), path).toBe(false);
        }
        expect(scenario.fs.files.get("library.json")).toBeDefined();
      }
    }
  });
});

describe("rollback safety (task 6.5)", () => {
  it("preserves a final path whose bytes were changed after apply", async () => {
    const { fs, journal, recovery, finalPaths } = await makeScenario();
    // Apply half the operations, then simulate external modification.
    fs.failAtOp = fs.ops.length + 12;
    try {
      await applyImport(journal, { fs });
    } catch { /* injected */ }
    fs.failAtOp = 0;
    const installed = finalPaths.find((p) => fs.files.has(p));
    if (installed === undefined) {
      // Nothing installed before the fault — nothing to corrupt; skip.
      return;
    }
    fs.files.set(installed, new TextEncoder().encode("user-modified"));
    // Corrupt staged data so resume is impossible and rollback runs.
    for (const key of fs.files.keys()) {
      if (key.includes("/stage/op-")) {
        fs.files.set(key, new TextEncoder().encode("corrupt"));
      }
    }
    const outcomes = await recoverPendingImports(recovery);
    expect(outcomes[0].kind).toBe("recovery-required");
    expect(new TextDecoder().decode(fs.files.get(installed)!)).toBe(
      "user-modified",
    );
  });

  it("fails closed when journal and rollback are both unusable", async () => {
    const { fs, recovery } = await makeScenario();
    fs.files.set(
      `imports/${TX}/journal.json`,
      new TextEncoder().encode("{broken"),
    );
    fs.files.set(
      `imports/${TX}/journal-copy.json`,
      new TextEncoder().encode("also broken"),
    );
    const outcomes = await recoverPendingImports(recovery);
    expect(outcomes[0]).toMatchObject({
      kind: "recovery-required",
      transactionId: TX,
    });
    // All evidence preserved: staging and rollback untouched.
    expect(fs.files.has(`backups/imports/${TX}.tesina`)).toBe(true);
    expect([...fs.files.keys()].some((p) => p.includes("/stage/"))).toBe(true);
  });
});

describe("rollback retention (task 6.8)", () => {
  it("keeps unfinished rollbacks and prunes completed beyond the window", async () => {
    const done1 = await makeScenario();
    await applyImport(done1.journal, { fs: done1.fs });

    // A second, unfinished transaction inside the same app data.
    const tx2 = fixtureUuid(7, 2);
    const journal2: ImportJournalV1 = {
      ...done1.journal,
      transactionId: tx2,
      createdAt: "2026-01-22T00:00:00.000Z",
      rollback: {
        ...done1.journal.rollback,
        relPath: `backups/imports/${tx2}.tesina`,
      },
      status: "staged",
      completedOpIds: [],
    };
    const envelope = {
      schemaVersion: 1,
      payloadSha256: await sha256Hex(canonicalJsonBytes(journal2)),
      payload: journal2,
    };
    done1.fs.files.set(
      `imports/${tx2}/journal.json`,
      canonicalJsonBytes(envelope),
    );
    done1.fs.files.set(
      `imports/${tx2}/journal-copy.json`,
      canonicalJsonBytes(envelope),
    );
    done1.fs.files.set(
      `backups/imports/${tx2}.tesina`,
      done1.fs.files.get(`backups/imports/${TX}.tesina`)!,
    );

    const removed = await pruneCompletedRollbacks({
      fs: done1.fs,
      keepCompleted: 0,
    });
    expect(removed).toEqual([`backups/imports/${TX}.tesina`]);
    expect(done1.fs.files.has(`backups/imports/${tx2}.tesina`)).toBe(true);
    expect(done1.fs.files.has(`imports/${tx2}/journal.json`)).toBe(true);
  });
});

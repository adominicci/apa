import { describe, expect, it } from "vitest";
import { PersistenceCoordinator } from "./coordinator.ts";
import { captureStableSnapshot, type SnapshotIo } from "./librarySnapshot.ts";
import { figureHeavyLibraryFixture } from "$lib/portable/fixtures/libraries";

/** Tasks 4.1/4.2: flush barrier, generation stability, maintenance lease. */

interface WorldRevision {
  essays: Map<string, unknown>;
  library: unknown;
  assets: Map<string, Uint8Array>;
}

function fixtureRevision(marker: string): WorldRevision {
  const fixture = figureHeavyLibraryFixture();
  const essays = new Map<string, unknown>();
  for (const essay of fixture.essays) {
    essays.set(`${essay.id}.json`, {
      ...essay,
      titlePage: {
        ...essay.titlePage,
        title: `${essay.titlePage.title} ${marker}`,
      },
    });
  }
  return {
    essays,
    library: fixture.library,
    assets: new Map(
      Object.entries(fixture.assets).map((
        [k, v],
      ) => [k, v]),
    ),
  };
}

class FakeWorld {
  revision: WorldRevision;
  generation = 0;
  flushed = 0;
  flushError: Error | null = null;
  reads = 0;
  onRead: ((world: FakeWorld) => void) | null = null;

  constructor(revision: WorldRevision) {
    this.revision = revision;
  }

  mutate(revision: WorldRevision): void {
    this.revision = revision;
    this.generation += 1;
  }

  io(): SnapshotIo {
    const note = () => {
      this.reads += 1;
      this.onRead?.(this);
    };
    return {
      listEssayFiles: () => {
        note();
        return Promise.resolve([...this.revision.essays.keys()]);
      },
      readEssayFile: (name) => {
        note();
        return Promise.resolve(
          structuredClone(this.revision.essays.get(name) ?? null),
        );
      },
      readLibraryFile: () => {
        note();
        return Promise.resolve(structuredClone(this.revision.library));
      },
      readAssetFile: (relPath) => {
        note();
        return Promise.resolve(this.revision.assets.get(relPath) ?? null);
      },
    };
  }

  deps(maxAttempts = 3) {
    return {
      io: this.io(),
      flushPending: () => {
        if (this.flushError) return Promise.reject(this.flushError);
        this.flushed += 1;
        return Promise.resolve();
      },
      generation: () => this.generation,
      maxAttempts,
    };
  }
}

describe("captureStableSnapshot", () => {
  it("flushes pending persistence before any source read", async () => {
    const world = new FakeWorld(fixtureRevision("a"));
    world.onRead = (w) => {
      expect(w.flushed).toBeGreaterThan(0);
    };
    const snapshot = await captureStableSnapshot(world.deps());
    expect(snapshot.essays.length).toBe(12);
    expect(snapshot.assets.size).toBe(36);
  });

  it("aborts without reading when the flush barrier rejects", async () => {
    const world = new FakeWorld(fixtureRevision("a"));
    world.flushError = new Error("disk full");
    await expect(captureStableSnapshot(world.deps())).rejects.toThrow(
      "disk full",
    );
    expect(world.reads).toBe(0);
  });

  it("retries the whole capture when a mutation races the reads", async () => {
    const world = new FakeWorld(fixtureRevision("a"));
    let mutated = false;
    world.onRead = (w) => {
      if (!mutated && w.reads > 5) {
        mutated = true;
        w.mutate(fixtureRevision("b"));
      }
    };
    const snapshot = await captureStableSnapshot(world.deps());
    // Every essay must come from the same (second) revision — no mixing.
    for (const essay of snapshot.essays) {
      expect(essay.titlePage.title).toContain(" b");
    }
  });

  it("aborts with snapshot/unstable when every attempt races", async () => {
    const world = new FakeWorld(fixtureRevision("a"));
    let flips = 0;
    world.onRead = (w) => {
      if (w.reads % 7 === 0) {
        flips += 1;
        w.mutate(fixtureRevision(`r${flips}`));
      }
    };
    await expect(captureStableSnapshot(world.deps(3))).rejects.toMatchObject({
      code: "snapshot/unstable",
    });
  });

  it("fails closed naming the offending invalid essay file", async () => {
    const revision = fixtureRevision("a");
    const [firstName] = revision.essays.keys();
    revision.essays.set(firstName, { schemaVersion: 1, id: "x" });
    const world = new FakeWorld(revision);
    await expect(captureStableSnapshot(world.deps())).rejects.toMatchObject({
      code: "archive/invalid-source-essay",
      detail: `essays/${firstName}`,
    });
  });

  it("fails closed when a referenced asset is missing on disk", async () => {
    const revision = fixtureRevision("a");
    const [firstAsset] = revision.assets.keys();
    revision.assets.delete(firstAsset);
    const world = new FakeWorld(revision);
    await expect(captureStableSnapshot(world.deps())).rejects.toMatchObject({
      code: "archive/missing-source-asset",
    });
  });

  it("treats an essay deleted between listing and reading as a race", async () => {
    const world = new FakeWorld(fixtureRevision("a"));
    let deleted = false;
    world.onRead = (w) => {
      if (!deleted && w.reads === 2) {
        deleted = true;
        const [name] = w.revision.essays.keys();
        w.revision.essays.delete(name);
        w.generation += 1;
      }
    };
    const snapshot = await captureStableSnapshot(world.deps());
    expect(snapshot.essays.length).toBe(11);
  });
});

describe("maintenance lease (coordinator)", () => {
  it("serializes concurrent maintenance operations FIFO", async () => {
    const coordinator = new PersistenceCoordinator();
    const events: string[] = [];
    const gate = Promise.withResolvers<void>();
    const first = coordinator.runMaintenance(async () => {
      events.push("first:start");
      await gate.promise;
      events.push("first:end");
      return 1;
    });
    const second = coordinator.runMaintenance(async () => {
      events.push("second:start");
      return 2;
    });
    // Give the second op a chance to (incorrectly) start early.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["first:start"]);
    gate.resolve();
    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(events).toEqual([
      "first:start",
      "first:end",
      "second:start",
    ]);
  });

  it("keeps serving after a failed maintenance operation", async () => {
    const coordinator = new PersistenceCoordinator();
    await expect(
      coordinator.runMaintenance(() => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(await coordinator.runMaintenance(() => Promise.resolve(7))).toBe(7);
  });

  it("bumps the activity generation on direct writes", () => {
    const coordinator = new PersistenceCoordinator();
    const before = coordinator.activityGeneration;
    coordinator.noteDirectWrite();
    expect(coordinator.activityGeneration).toBe(before + 1);
  });
});

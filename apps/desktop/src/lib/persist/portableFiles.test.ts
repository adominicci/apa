import { describe, expect, it, vi } from "vitest";
import {
  type ExternalFs,
  PortableFileError,
  readTesinaBounded,
  recoverReplacements,
  type ReplacementJournal,
  type ReplacementRecord,
  writeArchiveReplacing,
  type WriteDeps,
} from "./portableFiles.ts";

/** Tasks 4.3/4.4: recoverable destination writes with fault injection. */

class FakeFs implements ExternalFs {
  files = new Map<string, Uint8Array>();
  reportedSizes = new Map<string, number>();
  /** Operation log for boundary assertions. */
  ops: string[] = [];
  /** When set, the numbered operation throws (1-based). */
  failAtOp = 0;
  /** Platform behavior: does rename replace an existing destination? */
  renameReplaces = true;
  preserveDigests: string[] = [];
  noReplaceDigests: string[] = [];
  boundedReads: Array<[string, number]> = [];
  hashLimits: Array<[string, number | undefined]> = [];
  cleanupDestinationDigests: Array<string | undefined> = [];
  #op = 0;

  #tick(op: string): void {
    this.#op += 1;
    this.ops.push(op);
    if (this.failAtOp !== 0 && this.#op === this.failAtOp) {
      throw new PortableFileError("fake/fault", `injected fault at ${op}`);
    }
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path));
  }
  readFile(path: string): Promise<Uint8Array> {
    const bytes = this.files.get(path);
    if (!bytes) return Promise.reject(new Error(`missing ${path}`));
    return Promise.resolve(bytes);
  }
  readFileBounded(path: string, maxBytes: number): Promise<Uint8Array> {
    this.boundedReads.push([path, maxBytes]);
    const bytes = this.files.get(path);
    if (!bytes) return Promise.reject(new Error(`missing ${path}`));
    if (bytes.length > maxBytes) {
      return Promise.reject(
        new PortableFileError(
          "portable/file-too-large",
          "file grew while reading",
        ),
      );
    }
    return Promise.resolve(bytes);
  }
  async sha256File(path: string, maxBytes?: number): Promise<string> {
    this.hashLimits.push([path, maxBytes]);
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`missing ${path}`);
    if (maxBytes !== undefined && bytes.length > maxBytes) {
      throw new PortableFileError("portable/file-too-large", "file too large");
    }
    const digest = await crypto.subtle.digest(
      "SHA-256",
      bytes as unknown as ArrayBuffer,
    );
    return [...new Uint8Array(digest)].map((b) => b.toString(16)).join("");
  }
  writeFile(path: string, bytes: Uint8Array): Promise<void> {
    this.#tick(`write:${path}`);
    this.files.set(path, bytes);
    return Promise.resolve();
  }
  async rename(
    from: string,
    to: string,
    expectedSha256: string,
  ): Promise<void> {
    this.#tick(`rename:${from}->${to}`);
    this.preserveDigests.push(expectedSha256);
    if (!this.files.has(from)) throw new Error("missing src");
    if ((await this.sha256File(from)) !== expectedSha256) {
      throw new PortableFileError(
        "fake/hash-mismatch",
        "preservation source changed",
      );
    }
    if (this.files.has(to) && !this.renameReplaces) {
      throw new Error("destination exists");
    }
    this.files.set(to, this.files.get(from)!);
    this.files.delete(from);
  }
  renameNoReplace(
    from: string,
    to: string,
    expectedSha256: string,
  ): Promise<void> {
    this.#tick(`renameNoReplace:${from}->${to}`);
    this.noReplaceDigests.push(expectedSha256);
    if (!this.files.has(from)) return Promise.reject(new Error("missing src"));
    if (this.files.has(to)) {
      return Promise.reject(
        new PortableFileError("portable/name-taken", "destination exists"),
      );
    }
    this.files.set(to, this.files.get(from)!);
    this.files.delete(from);
    return Promise.resolve();
  }
  async removeIfHashMatches(
    path: string,
    expectedSha256: string,
    installedDestinationSha256?: string,
  ) {
    this.cleanupDestinationDigests.push(installedDestinationSha256);
    if ((await this.sha256File(path)) !== expectedSha256) {
      throw new PortableFileError("fake/hash-mismatch", "changed bytes");
    }
    this.#tick(`removeIfHashMatches:${path}`);
    this.files.delete(path);
  }
  remove(path: string): Promise<void> {
    this.#tick(`remove:${path}`);
    this.files.delete(path);
    return Promise.resolve();
  }
  statSize(path: string): Promise<number | null> {
    return Promise.resolve(
      this.reportedSizes.get(path) ?? this.files.get(path)?.length ?? null,
    );
  }
}

class FakeJournal implements ReplacementJournal {
  records = new Map<string, ReplacementRecord>();
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

const GOOD = new TextEncoder().encode("valid-archive");
const OLD = new TextEncoder().encode("previous-archive");
const CHANGED = new TextEncoder().encode("provider-changed");
const OTHER_VALID = new TextEncoder().encode("valid-provider-swap");

function makeDeps(fs: FakeFs): WriteDeps {
  let n = 0;
  return {
    fs,
    validate: (bytes) =>
      new TextDecoder().decode(bytes).startsWith("valid") ||
        new TextDecoder().decode(bytes).startsWith("previous")
        ? Promise.resolve()
        : Promise.reject(
          new PortableFileError("fake/invalid", "invalid archive"),
        ),
    uuid: () => `u${++n}`,
    maxArchiveBytes: 1_024,
    sha256: async (bytes) => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        bytes as unknown as ArrayBuffer,
      );
      return [...new Uint8Array(digest)].map((b) => b.toString(16)).join("");
    },
  };
}

describe("writeArchiveReplacing", () => {
  it("journals temp ownership before writing and advances before preservation", async () => {
    const fs = new FakeFs();
    fs.files.set("/docs/lib.tesina", OLD);
    const journal = new FakeJournal();
    const events: string[] = [];
    const originalSave = journal.save.bind(journal);
    journal.save = (record) => {
      events.push(`journal:${record.phase}`);
      return originalSave(record);
    };
    const originalWrite = fs.writeFile.bind(fs);
    fs.writeFile = (path, bytes) => {
      events.push("write:temp");
      return originalWrite(path, bytes);
    };
    const originalRename = fs.rename.bind(fs);
    fs.rename = (from, to, expectedSha256) => {
      events.push("rename:previous");
      return originalRename(from, to, expectedSha256);
    };

    await writeArchiveReplacing(
      makeDeps(fs),
      journal,
      "/docs/lib.tesina",
      GOOD,
    );

    expect(events).toEqual([
      "journal:staging",
      "write:temp",
      "journal:replacing",
      "rename:previous",
    ]);
  });

  it("bounds every destination reopen and incremental hash", async () => {
    const fs = new FakeFs();
    fs.files.set("/docs/lib.tesina", OLD);
    const deps = makeDeps(fs);

    await writeArchiveReplacing(
      deps,
      new FakeJournal(),
      "/docs/lib.tesina",
      GOOD,
    );

    expect(fs.boundedReads).toContainEqual([
      "/docs/lib.tesina",
      deps.maxArchiveBytes,
    ]);
    expect(fs.hashLimits).toContainEqual([
      "/docs/lib.tesina",
      deps.maxArchiveBytes,
    ]);
    expect(fs.cleanupDestinationDigests).toContain(
      await deps.sha256(GOOD),
    );
  });

  it("creates no temp when the ownership journal cannot be saved", async () => {
    const fs = new FakeFs();
    const journal = new FakeJournal();
    journal.save = () => Promise.reject(new Error("journal unavailable"));

    await expect(
      writeArchiveReplacing(
        makeDeps(fs),
        journal,
        "/docs/lib.tesina",
        GOOD,
      ),
    ).rejects.toThrow("journal unavailable");

    expect(fs.files.size).toBe(0);
    expect(fs.ops.some((operation) => operation.startsWith("write:"))).toBe(
      false,
    );
  });

  it("replaces directly on platforms where rename replaces", async () => {
    const fs = new FakeFs();
    fs.files.set("/docs/lib.tesina", OLD);
    await writeArchiveReplacing(
      makeDeps(fs),
      new FakeJournal(),
      "/docs/lib.tesina",
      GOOD,
    );
    expect(fs.files.get("/docs/lib.tesina")).toBe(GOOD);
  });

  it("does not replace a destination that appears after the existence check", async () => {
    const fs = new FakeFs();
    const originalNoReplace = fs.renameNoReplace.bind(fs);
    fs.renameNoReplace = (from, to, expectedSha256) => {
      fs.files.set(to, OLD);
      return originalNoReplace(from, to, expectedSha256);
    };

    await expect(
      writeArchiveReplacing(
        makeDeps(fs),
        new FakeJournal(),
        "/docs/lib.tesina",
        GOOD,
      ),
    ).rejects.toThrow();
    expect(fs.files.get("/docs/lib.tesina")).toBe(OLD);
  });

  it("rejects a valid provider swap after a first-time export install", async () => {
    const fs = new FakeFs();
    const originalNoReplace = fs.renameNoReplace.bind(fs);
    fs.renameNoReplace = async (from, to, expectedSha256) => {
      await originalNoReplace(from, to, expectedSha256);
      fs.files.set(to, OTHER_VALID);
    };

    await expect(
      writeArchiveReplacing(
        makeDeps(fs),
        new FakeJournal(),
        "/docs/lib.tesina",
        GOOD,
      ),
    ).rejects.toMatchObject({ code: "portable/destination-changed" });
    expect(fs.files.get("/docs/lib.tesina")).toBe(OTHER_VALID);
  });

  it("journals an existing destination even when rename can replace it", async () => {
    const fs = new FakeFs();
    fs.files.set("/docs/lib.tesina", OLD);
    const journal = new FakeJournal();
    const seen: ReplacementRecord[] = [];
    journal.save = (record) => {
      seen.push(record);
      journal.records.set(record.id, record);
      return Promise.resolve();
    };
    await writeArchiveReplacing(
      makeDeps(fs),
      journal,
      "/docs/lib.tesina",
      GOOD,
    );
    expect(seen.map((record) => record.phase)).toEqual([
      "staging",
      "replacing",
    ]);
    expect(fs.files.get("/docs/lib.tesina")).toBe(GOOD);
  });

  it("hashes an existing destination without reading it into memory", async () => {
    const fs = new FakeFs();
    fs.files.set("/docs/lib.tesina", OLD);
    const originalRead = fs.readFile.bind(fs);
    fs.readFile = (path) => {
      if (path === "/docs/lib.tesina" && fs.files.get(path) === OLD) {
        throw new Error("unbounded destination read");
      }
      return originalRead(path);
    };
    await writeArchiveReplacing(
      makeDeps(fs),
      new FakeJournal(),
      "/docs/lib.tesina",
      GOOD,
    );
    expect(fs.files.get("/docs/lib.tesina")).toBe(GOOD);
  });

  it("preserves the previous file through the journaled fallback", async () => {
    const fs = new FakeFs();
    fs.renameReplaces = false;
    fs.files.set("/docs/lib.tesina", OLD);
    const journal = new FakeJournal();
    const deps = makeDeps(fs);
    const previousSha256 = await deps.sha256(OLD);
    await writeArchiveReplacing(
      deps,
      journal,
      "/docs/lib.tesina",
      GOOD,
    );
    expect(fs.files.get("/docs/lib.tesina")).toBe(GOOD);
    expect(fs.preserveDigests).toEqual([previousSha256]);
    expect(journal.records.size).toBe(0);
    expect([...fs.files.keys()].some((p) => p.includes(".prev"))).toBe(false);
  });

  it("keeps evidence when the previous destination changes before preservation", async () => {
    const fs = new FakeFs();
    fs.files.set("/docs/lib.tesina", OLD);
    const journal = new FakeJournal();
    const originalRename = fs.rename.bind(fs);
    fs.rename = async (from, to, expectedSha256) => {
      await originalRename(from, to, expectedSha256);
      if (from === "/docs/lib.tesina" && to.endsWith(".prev")) {
        fs.files.set(to, CHANGED);
      }
    };

    await expect(
      writeArchiveReplacing(
        makeDeps(fs),
        journal,
        "/docs/lib.tesina",
        GOOD,
      ),
    ).rejects.toMatchObject({ code: "portable/replacement-recovery-required" });
    expect(journal.records.size).toBe(1);
    expect([...fs.files.values()]).toContain(CHANGED);
  });

  it("does not replace a destination recreated after preservation", async () => {
    const fs = new FakeFs();
    fs.files.set("/docs/lib.tesina", OLD);
    const journal = new FakeJournal();
    const originalNoReplace = fs.renameNoReplace.bind(fs);
    fs.renameNoReplace = (from, to, expectedSha256) => {
      if (to === "/docs/lib.tesina") fs.files.set(to, CHANGED);
      return originalNoReplace(from, to, expectedSha256);
    };

    await expect(
      writeArchiveReplacing(
        makeDeps(fs),
        journal,
        "/docs/lib.tesina",
        GOOD,
      ),
    ).rejects.toThrow();
    expect(fs.files.get("/docs/lib.tesina")).toBe(CHANGED);
    expect([...fs.files.values()]).toContain(OLD);
    expect([...fs.files.values()]).toContain(GOOD);
    expect(journal.records.size).toBe(1);
  });

  it("keeps recovery evidence when a valid archive is swapped in after install", async () => {
    const fs = new FakeFs();
    fs.files.set("/docs/lib.tesina", OLD);
    const journal = new FakeJournal();
    const originalNoReplace = fs.renameNoReplace.bind(fs);
    fs.renameNoReplace = async (from, to, expectedSha256) => {
      await originalNoReplace(from, to, expectedSha256);
      if (to === "/docs/lib.tesina") fs.files.set(to, OTHER_VALID);
    };

    await expect(
      writeArchiveReplacing(
        makeDeps(fs),
        journal,
        "/docs/lib.tesina",
        GOOD,
      ),
    ).rejects.toMatchObject({
      code: "portable/replacement-recovery-required",
    });
    expect(fs.files.get("/docs/lib.tesina")).toBe(OTHER_VALID);
    expect([...fs.files.values()]).toContain(OLD);
    expect(journal.records.size).toBe(1);
  });

  it("hashes and validates one recovery read when the provider swaps bytes", async () => {
    const fs = new FakeFs();
    fs.files.set("/docs/lib.tesina", OLD);
    const journal = new FakeJournal();
    const originalRead = fs.readFileBounded.bind(fs);
    fs.readFileBounded = async (path, maxBytes) => {
      if (path === "/docs/lib.tesina" && fs.files.get(path) === GOOD) {
        fs.files.set(path, OTHER_VALID);
      }
      return await originalRead(path, maxBytes);
    };

    await expect(
      writeArchiveReplacing(
        makeDeps(fs),
        journal,
        "/docs/lib.tesina",
        GOOD,
      ),
    ).rejects.toMatchObject({
      code: "portable/replacement-recovery-required",
    });
    expect(fs.files.get("/docs/lib.tesina")).toBe(OTHER_VALID);
    expect([...fs.files.values()]).toContain(OLD);
    expect(journal.records.size).toBe(1);
  });

  it("does not delete preserved bytes replaced during final cleanup", async () => {
    const fs = new FakeFs();
    fs.files.set("/docs/lib.tesina", OLD);
    const journal = new FakeJournal();
    const originalRemove = fs.removeIfHashMatches.bind(fs);
    fs.removeIfHashMatches = async (path, expectedSha256) => {
      fs.files.set(path, CHANGED);
      await originalRemove(path, expectedSha256);
    };

    await expect(
      writeArchiveReplacing(
        makeDeps(fs),
        journal,
        "/docs/lib.tesina",
        GOOD,
      ),
    ).rejects.toMatchObject({ code: "fake/hash-mismatch" });
    expect([...fs.files.values()]).toContain(CHANGED);
    expect(journal.records.size).toBe(1);
  });

  it("preserves the previous destination when the write fails", async () => {
    const fs = new FakeFs();
    fs.files.set("/docs/lib.tesina", OLD);
    const deps = makeDeps(fs);
    deps.validate = () =>
      Promise.reject(new PortableFileError("fake/invalid", "bad"));
    await expect(
      writeArchiveReplacing(deps, new FakeJournal(), "/docs/lib.tesina", GOOD),
    ).rejects.toMatchObject({ code: "fake/invalid" });
    expect(fs.files.get("/docs/lib.tesina")).toBe(OLD);
  });

  it("recovers a crash at every journaled boundary without losing both files", async () => {
    // The journaled fallback performs ops: write tmp, rename dest->prev,
    // no-replace tmp->dest, remove prev. Inject a crash at each and recover.
    for (let failAt = 1; failAt <= 4; failAt += 1) {
      const fs = new FakeFs();
      fs.renameReplaces = false;
      fs.files.set("/docs/lib.tesina", OLD);
      const journal = new FakeJournal();
      const deps = makeDeps(fs);
      // Ops before the fallback: 1 write tmp. Fallback ops follow.
      fs.failAtOp = failAt + 1; // skip the initial tmp write
      try {
        await writeArchiveReplacing(deps, journal, "/docs/lib.tesina", GOOD);
      } catch {
        // crash simulated
      }
      fs.failAtOp = 0;
      await recoverReplacements(deps, journal);
      const dest = fs.files.get("/docs/lib.tesina");
      expect(
        dest === GOOD || dest === OLD,
        `boundary ${failAt}: destination must hold old or new bytes`,
      ).toBe(true);
      expect(journal.records.size, `boundary ${failAt}`).toBe(0);
    }
  });

  it("clears journal-owned staging temps without touching the destination", async () => {
    const fs = new FakeFs();
    const journal = new FakeJournal();
    const deps = makeDeps(fs);
    fs.files.set("/docs/lib.tesina", OLD);
    for (const id of ["staging-1", "staging-2"]) {
      const record: ReplacementRecord = {
        phase: "staging",
        id,
        destinationPath: "/docs/lib.tesina",
        temporaryPath: `/docs/lib.tesina.${id}.tmp`,
        previousPath: `/docs/lib.tesina.${id}.prev`,
        expectedSha256: await deps.sha256(GOOD),
      };
      await journal.save(record);
      fs.files.set(record.temporaryPath, GOOD);
    }

    await recoverReplacements(deps, journal);
    await recoverReplacements(deps, journal);

    expect(fs.files).toEqual(new Map([["/docs/lib.tesina", OLD]]));
    expect(journal.records.size).toBe(0);
  });

  it("retains a changed staging temp as ambiguous evidence", async () => {
    const fs = new FakeFs();
    const journal = new FakeJournal();
    const deps = makeDeps(fs);
    const record: ReplacementRecord = {
      phase: "staging",
      id: "staging-changed",
      destinationPath: "/docs/lib.tesina",
      temporaryPath: "/docs/lib.tesina.staging-changed.tmp",
      previousPath: "/docs/lib.tesina.staging-changed.prev",
      expectedSha256: await deps.sha256(GOOD),
    };
    await journal.save(record);
    fs.files.set(record.temporaryPath, CHANGED);

    await recoverReplacements(deps, journal);

    expect(fs.files.get(record.temporaryPath)).toBe(CHANGED);
    expect(journal.records.has(record.id)).toBe(true);
  });

  it("removes an inert staging record when no sidecar exists", async () => {
    const fs = new FakeFs();
    const journal = new FakeJournal();
    const deps = makeDeps(fs);
    const record: ReplacementRecord = {
      phase: "staging",
      id: "staging-inert",
      destinationPath: "/docs/lib.tesina",
      temporaryPath: "/docs/lib.tesina.staging-inert.tmp",
      previousPath: "/docs/lib.tesina.staging-inert.prev",
      expectedSha256: await deps.sha256(GOOD),
    };
    await journal.save(record);
    fs.files.set(record.destinationPath, OTHER_VALID);

    await recoverReplacements(deps, journal);

    expect(fs.files.get(record.destinationPath)).toBe(OTHER_VALID);
    expect(journal.records.size).toBe(0);
  });

  it("does not guess when the destination holds unexpected bytes", async () => {
    const fs = new FakeFs();
    const journal = new FakeJournal();
    const deps = makeDeps(fs);
    const record: ReplacementRecord = {
      phase: "replacing",
      id: "r1",
      destinationPath: "/docs/lib.tesina",
      temporaryPath: "/docs/lib.tesina.u1.tmp",
      previousPath: "/docs/lib.tesina.u2.prev",
      expectedSha256: await deps.sha256(GOOD),
      previousSha256: await deps.sha256(OLD),
    };
    await journal.save(record);
    fs.files.set(record.temporaryPath, GOOD);
    fs.files.set(
      record.destinationPath,
      new TextEncoder().encode("user-modified"),
    );
    await recoverReplacements(deps, journal);
    expect(new TextDecoder().decode(fs.files.get(record.destinationPath)!))
      .toBe("user-modified");
    expect(journal.records.size).toBe(1); // kept as evidence
  });

  it("keeps the previous export when a recovered install changes after rename", async () => {
    const fs = new FakeFs();
    const journal = new FakeJournal();
    const deps = makeDeps(fs);
    const record: ReplacementRecord = {
      phase: "replacing",
      id: "r-sync-race",
      destinationPath: "/docs/lib.tesina",
      temporaryPath: "/docs/lib.tesina.tmp",
      previousPath: "/docs/lib.tesina.prev",
      expectedSha256: await deps.sha256(GOOD),
      previousSha256: await deps.sha256(OLD),
    };
    await journal.save(record);
    fs.files.set(record.temporaryPath, GOOD);
    fs.files.set(record.previousPath, OLD);
    const originalNoReplace = fs.renameNoReplace.bind(fs);
    fs.renameNoReplace = async (from, to, expectedSha256) => {
      await originalNoReplace(from, to, expectedSha256);
      if (to === record.destinationPath) {
        fs.files.set(to, new TextEncoder().encode("sync-truncated"));
      }
    };

    await recoverReplacements(deps, journal);

    expect(fs.files.get(record.previousPath)).toBe(OLD);
    expect(journal.records.has(record.id)).toBe(true);
  });

  it("keeps the journal when a preserved previous file meets an unexpected destination", async () => {
    const fs = new FakeFs();
    const journal = new FakeJournal();
    const deps = makeDeps(fs);
    const record: ReplacementRecord = {
      phase: "replacing",
      id: "r2",
      destinationPath: "/docs/lib.tesina",
      temporaryPath: "/docs/lib.tesina.u1.tmp",
      previousPath: "/docs/lib.tesina.u2.prev",
      expectedSha256: await deps.sha256(GOOD),
      previousSha256: await deps.sha256(OLD),
    };
    await journal.save(record);
    fs.files.set(record.previousPath, OLD);
    fs.files.set(
      record.destinationPath,
      new TextEncoder().encode("sync-corrupted"),
    );
    await recoverReplacements(deps, journal);
    expect(fs.files.get(record.previousPath)).toBe(OLD);
    expect(journal.records.size).toBe(1);
  });

  it("keeps the journal when changed temporary bytes refuse cleanup", async () => {
    const fs = new FakeFs();
    const journal = new FakeJournal();
    const deps = makeDeps(fs);
    const record: ReplacementRecord = {
      phase: "replacing",
      id: "r-changed-temporary",
      destinationPath: "/docs/lib.tesina",
      temporaryPath: "/docs/lib.tesina.u1.tmp",
      previousPath: "/docs/lib.tesina.u2.prev",
      expectedSha256: await deps.sha256(GOOD),
      previousSha256: await deps.sha256(OLD),
    };
    await journal.save(record);
    fs.files.set(record.destinationPath, GOOD);
    fs.files.set(record.temporaryPath, CHANGED);

    await recoverReplacements(deps, journal);

    expect(fs.files.get(record.destinationPath)).toBe(GOOD);
    expect(fs.files.get(record.temporaryPath)).toBe(CHANGED);
    expect(journal.records.has(record.id)).toBe(true);
  });

  it("does not restore a preserved previous file whose hash changed", async () => {
    const fs = new FakeFs();
    const journal = new FakeJournal();
    const deps = makeDeps(fs);
    const record: ReplacementRecord = {
      phase: "replacing",
      id: "r-corrupt-previous",
      destinationPath: "/docs/lib.tesina",
      temporaryPath: "/docs/lib.tesina.tmp",
      previousPath: "/docs/lib.tesina.prev",
      expectedSha256: await deps.sha256(GOOD),
      previousSha256: await deps.sha256(OLD),
    };
    await journal.save(record);
    const changed = new TextEncoder().encode("changed-previous");
    fs.files.set(record.previousPath, changed);

    await recoverReplacements(deps, journal);

    expect(fs.files.has(record.destinationPath)).toBe(false);
    expect(fs.files.get(record.previousPath)).toBe(changed);
    expect(journal.records.has(record.id)).toBe(true);
  });

  it("cleans remaining previous evidence before closing a restored record", async () => {
    const fs = new FakeFs();
    const journal = new FakeJournal();
    const deps = makeDeps(fs);
    const record: ReplacementRecord = {
      phase: "replacing",
      id: "restore-with-duplicate",
      destinationPath: "/docs/lib.tesina",
      temporaryPath: "/docs/lib.tesina.restore.tmp",
      previousPath: "/docs/lib.tesina.restore.prev",
      expectedSha256: await deps.sha256(GOOD),
      previousSha256: await deps.sha256(OLD),
    };
    await journal.save(record);
    fs.files.set(record.previousPath, OLD);
    const originalNoReplace = fs.renameNoReplace.bind(fs);
    fs.renameNoReplace = async (from, to, expectedSha256) => {
      await originalNoReplace(from, to, expectedSha256);
      if (from === record.previousPath) {
        // Native recovery may still expose deterministic duplicate evidence
        // through the journaled logical previous path after restoration.
        fs.files.set(record.previousPath, OLD);
      }
    };

    await recoverReplacements(deps, journal, record.destinationPath);

    expect(fs.files.get(record.destinationPath)).toBe(OLD);
    expect(fs.files.has(record.previousPath)).toBe(false);
    expect(journal.records.has(record.id)).toBe(false);
  });

  it("recovers only the destination reauthorized by the current dialog", async () => {
    const fs = new FakeFs();
    const journal = new FakeJournal();
    const deps = makeDeps(fs);
    for (
      const [id, destinationPath] of [["r1", "/a/lib.tesina"], [
        "r2",
        "/b/lib.tesina",
      ]]
    ) {
      const record: ReplacementRecord = {
        phase: "replacing",
        id,
        destinationPath,
        temporaryPath: `${destinationPath}.tmp`,
        previousPath: `${destinationPath}.prev`,
        expectedSha256: await deps.sha256(GOOD),
        previousSha256: await deps.sha256(OLD),
      };
      await journal.save(record);
      fs.files.set(record.temporaryPath, GOOD);
      fs.files.set(record.destinationPath, OLD);
    }
    await recoverReplacements(deps, journal, "/a/lib.tesina");
    expect(fs.files.get("/a/lib.tesina")).toBe(GOOD);
    expect(fs.files.get("/b/lib.tesina")).toBe(OLD);
    expect([...journal.records.keys()]).toEqual(["r2"]);
  });

  it("does not report cancellation while a filesystem mutation is still running", async () => {
    const fs = new FakeFs();
    fs.files.set("/docs/lib.tesina", OLD);
    const originalRename = fs.rename.bind(fs);
    let releaseRename!: () => void;
    const renameReleased = new Promise<void>((resolve) => {
      releaseRename = resolve;
    });
    let renameStarted!: () => void;
    const renameWasStarted = new Promise<void>((resolve) => {
      renameStarted = resolve;
    });
    fs.rename = async (from, to, expectedSha256) => {
      if (from === "/docs/lib.tesina" && to.endsWith(".prev")) {
        renameStarted();
        await renameReleased;
      }
      await originalRename(from, to, expectedSha256);
    };
    const controller = new AbortController();
    const work = writeArchiveReplacing(
      makeDeps(fs),
      new FakeJournal(),
      "/docs/lib.tesina",
      GOOD,
      controller.signal,
    );
    await renameWasStarted;
    controller.abort();
    const earlyOutcome = await Promise.race([
      work.then(() => "resolved", () => "rejected"),
      new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 5)),
    ]);
    expect(earlyOutcome).toBe("pending");

    releaseRename();
    await expect(work).rejects.toMatchObject({ code: "portable/cancelled" });
  });

  it("does not release a failed write while owned-temp cleanup is still running", async () => {
    vi.useFakeTimers();
    try {
      const fs = new FakeFs();
      const journal = new FakeJournal();
      const deps = makeDeps(fs);
      deps.validate = () =>
        Promise.reject(new PortableFileError("fake/invalid", "bad"));
      const originalRemove = fs.removeIfHashMatches.bind(fs);
      let releaseCleanup!: () => void;
      const cleanupReleased = new Promise<void>((resolve) => {
        releaseCleanup = resolve;
      });
      let markCleanupStarted!: () => void;
      const cleanupStarted = new Promise<void>((resolve) => {
        markCleanupStarted = resolve;
      });
      fs.removeIfHashMatches = async (path, expectedSha256) => {
        markCleanupStarted();
        await cleanupReleased;
        await originalRemove(path, expectedSha256);
      };

      const work = writeArchiveReplacing(
        deps,
        journal,
        "/docs/lib.tesina",
        GOOD,
      );
      let settled = false;
      void work.catch(() => {
        settled = true;
      });
      await cleanupStarted;
      await vi.advanceTimersByTimeAsync(1_001);

      expect(settled).toBe(false);
      releaseCleanup();
      await expect(work).rejects.toMatchObject({ code: "fake/invalid" });
      await recoverReplacements(deps, journal, "/docs/lib.tesina");
      expect(journal.records.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("readTesinaBounded", () => {
  it("rejects an oversized file before reading it", async () => {
    const fs = new FakeFs();
    fs.files.set("/docs/huge.tesina", new Uint8Array(100));
    await expect(readTesinaBounded(fs, "/docs/huge.tesina", 50)).rejects
      .toMatchObject({ code: "portable/file-too-large" });
  });

  it("reads a file within the limit", async () => {
    const fs = new FakeFs();
    fs.files.set("/docs/ok.tesina", GOOD);
    expect(await readTesinaBounded(fs, "/docs/ok.tesina", 1024)).toBe(GOOD);
  });

  it("rejects a file that grows after the metadata preflight", async () => {
    const fs = new FakeFs();
    fs.files.set("/docs/growing.tesina", new Uint8Array(100));
    fs.reportedSizes.set("/docs/growing.tesina", 10);
    await expect(readTesinaBounded(fs, "/docs/growing.tesina", 50)).rejects
      .toMatchObject({ code: "portable/file-too-large" });
  });

  it("reports a vanished file", async () => {
    const fs = new FakeFs();
    await expect(readTesinaBounded(fs, "/docs/gone.tesina", 1024)).rejects
      .toMatchObject({ code: "portable/file-missing" });
  });
});

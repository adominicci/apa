import { describe, expect, it } from "vitest";
import {
  type ExternalFs,
  PortableFileError,
  readTesinaBounded,
  recoverReplacements,
  type ReplacementJournal,
  type ReplacementRecord,
  writeArchiveExclusive,
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
  async sha256File(path: string): Promise<string> {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`missing ${path}`);
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
  rename(from: string, to: string): Promise<void> {
    this.#tick(`rename:${from}->${to}`);
    if (!this.files.has(from)) return Promise.reject(new Error("missing src"));
    if (this.files.has(to) && !this.renameReplaces) {
      return Promise.reject(new Error("destination exists"));
    }
    this.files.set(to, this.files.get(from)!);
    this.files.delete(from);
    return Promise.resolve();
  }
  renameNoReplace(from: string, to: string): Promise<void> {
    this.#tick(`renameNoReplace:${from}->${to}`);
    if (!this.files.has(from)) return Promise.reject(new Error("missing src"));
    if (this.files.has(to)) return Promise.reject(new Error("exists"));
    this.files.set(to, this.files.get(from)!);
    this.files.delete(from);
    return Promise.resolve();
  }
  async removeIfHashMatches(path: string, expectedSha256: string) {
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
    sha256: async (bytes) => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        bytes as unknown as ArrayBuffer,
      );
      return [...new Uint8Array(digest)].map((b) => b.toString(16)).join("");
    },
  };
}

describe("writeArchiveExclusive", () => {
  it("creates the first free candidate and cleans its temp file", async () => {
    const fs = new FakeFs();
    fs.files.set("/backups/one.tesina", OLD);
    const result = await writeArchiveExclusive(makeDeps(fs), GOOD, [
      "/backups/one.tesina",
      "/backups/two.tesina",
    ]);
    expect(result.path).toBe("/backups/two.tesina");
    expect(fs.files.get("/backups/one.tesina")).toBe(OLD); // untouched
    expect([...fs.files.keys()].some((p) => p.endsWith(".tmp"))).toBe(false);
  });

  it("never overwrites a file that appears between check and rename", async () => {
    const fs = new FakeFs();
    const deps = makeDeps(fs);
    const originalNoReplace = fs.renameNoReplace.bind(fs);
    let raced = false;
    fs.renameNoReplace = (from, to) => {
      if (!raced && to === "/backups/one.tesina") {
        raced = true;
        fs.files.set(to, OLD); // another installation wins the name
      }
      return originalNoReplace(from, to);
    };
    const result = await writeArchiveExclusive(deps, GOOD, [
      "/backups/one.tesina",
      "/backups/two.tesina",
    ]);
    expect(result.path).toBe("/backups/two.tesina");
    expect(fs.files.get("/backups/one.tesina")).toBe(OLD);
  });

  it("fails without touching anything when every candidate is occupied", async () => {
    const fs = new FakeFs();
    fs.files.set("/backups/one.tesina", OLD);
    await expect(
      writeArchiveExclusive(makeDeps(fs), GOOD, ["/backups/one.tesina"]),
    ).rejects.toMatchObject({ code: "portable/no-free-name" });
    expect(fs.files.get("/backups/one.tesina")).toBe(OLD);
  });

  it("rejects a valid provider swap after an exclusive install", async () => {
    const fs = new FakeFs();
    const originalNoReplace = fs.renameNoReplace.bind(fs);
    fs.renameNoReplace = async (from, to) => {
      await originalNoReplace(from, to);
      fs.files.set(to, OTHER_VALID);
    };

    await expect(
      writeArchiveExclusive(makeDeps(fs), GOOD, ["/backups/one.tesina"]),
    ).rejects.toMatchObject({ code: "portable/destination-changed" });
    expect(fs.files.get("/backups/one.tesina")).toBe(OTHER_VALID);
  });
});

describe("writeArchiveReplacing", () => {
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
    fs.renameNoReplace = (from, to) => {
      fs.files.set(to, OLD);
      return originalNoReplace(from, to);
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
    fs.renameNoReplace = async (from, to) => {
      await originalNoReplace(from, to);
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
    expect(seen).toHaveLength(1);
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
    await writeArchiveReplacing(
      makeDeps(fs),
      journal,
      "/docs/lib.tesina",
      GOOD,
    );
    expect(fs.files.get("/docs/lib.tesina")).toBe(GOOD);
    expect(journal.records.size).toBe(0);
    expect([...fs.files.keys()].some((p) => p.includes(".prev"))).toBe(false);
  });

  it("keeps evidence when the previous destination changes before preservation", async () => {
    const fs = new FakeFs();
    fs.files.set("/docs/lib.tesina", OLD);
    const journal = new FakeJournal();
    const originalRename = fs.rename.bind(fs);
    fs.rename = async (from, to) => {
      await originalRename(from, to);
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
    fs.renameNoReplace = (from, to) => {
      if (to === "/docs/lib.tesina") fs.files.set(to, CHANGED);
      return originalNoReplace(from, to);
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
    fs.renameNoReplace = async (from, to) => {
      await originalNoReplace(from, to);
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
    const originalRead = fs.readFile.bind(fs);
    fs.readFile = async (path) => {
      if (path === "/docs/lib.tesina" && fs.files.get(path) === GOOD) {
        fs.files.set(path, OTHER_VALID);
      }
      return await originalRead(path);
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

  it("does not guess when the destination holds unexpected bytes", async () => {
    const fs = new FakeFs();
    const journal = new FakeJournal();
    const deps = makeDeps(fs);
    const record: ReplacementRecord = {
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
    fs.renameNoReplace = async (from, to) => {
      await originalNoReplace(from, to);
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

  it("does not restore a preserved previous file whose hash changed", async () => {
    const fs = new FakeFs();
    const journal = new FakeJournal();
    const deps = makeDeps(fs);
    const record: ReplacementRecord = {
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
    fs.rename = async (from, to) => {
      if (from === "/docs/lib.tesina" && to.endsWith(".prev")) {
        renameStarted();
        await renameReleased;
      }
      await originalRename(from, to);
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

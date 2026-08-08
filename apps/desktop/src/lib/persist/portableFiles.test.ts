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
  remove(path: string): Promise<void> {
    this.#tick(`remove:${path}`);
    this.files.delete(path);
    return Promise.resolve();
  }
  statSize(path: string): Promise<number | null> {
    return Promise.resolve(this.files.get(path)?.length ?? null);
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
    // rename tmp->dest, remove prev. Inject a crash at each and recover.
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

  it("reports a vanished file", async () => {
    const fs = new FakeFs();
    await expect(readTesinaBounded(fs, "/docs/gone.tesina", 1024)).rejects
      .toMatchObject({ code: "portable/file-missing" });
  });
});

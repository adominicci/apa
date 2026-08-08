import { describe, expect, it } from "vitest";
import {
  BACKUP_NAME_PATTERN,
  backupFileName,
  planRetention,
  type RetentionLedgerEntry,
} from "./retention.ts";
import {
  computeContentDigest,
  snapshotContentDigest,
} from "./contentDigest.ts";
import { figureHeavyLibraryFixture } from "./fixtures/libraries.ts";

/** Tasks 9.2 and 9.5: content digest and ledger-first retention. */

// Distinct leading octets: the filename component is the first 8 chars.
const SET_A = "aaaaaaaa-1111-4111-8111-111111111111";
const SET_B = "bbbbbbbb-2222-4222-8222-222222222222";

function entry(
  n: number,
  backupSetId = SET_A,
): RetentionLedgerEntry {
  const createdAt = `2026-03-${String(n).padStart(2, "0")}T10:00:00Z`;
  return {
    fileName: backupFileName(
      backupSetId,
      `2026-03-${String(n).padStart(2, "0")}T10:00:00Z`,
    ),
    sha256: `hash-${backupSetId.slice(0, 8)}-${n}`,
    createdAt,
    backupSetId,
  };
}

describe("backup filename grammar", () => {
  it("generates names that match the pattern and embed the set id", () => {
    const name = backupFileName(SET_A, "2026-03-05T10:00:00Z");
    expect(name).toMatch(BACKUP_NAME_PATTERN);
    expect(name).toContain(SET_A.slice(0, 8));
  });

  it("two installations never target the same name", () => {
    const a = backupFileName(SET_A, "2026-03-05T10:00:00Z");
    const b = backupFileName(SET_B, "2026-03-05T10:00:00Z");
    expect(a).not.toBe(b);
  });
});

describe("planRetention (task 9.5)", () => {
  it("prunes beyond the newest seven, oldest first", () => {
    const ledger = Array.from({ length: 9 }, (_, i) => entry(i + 1));
    const plan = planRetention({
      folderFileNames: ledger.map((e) => e.fileName),
      ledger,
      backupSetId: SET_A,
      keep: 7,
    });
    expect(plan.retained.length).toBe(7);
    expect(plan.prune.map((p) => p.fileName)).toEqual([
      ledger[0].fileName,
      ledger[1].fileName,
    ]);
    expect(plan.prune[0].expectedSha256).toBe(ledger[0].sha256);
  });

  it("never touches another installation's archives", () => {
    const mine = [entry(1), entry(2)];
    const theirs = Array.from({ length: 9 }, (_, i) => entry(i + 1, SET_B));
    const plan = planRetention({
      folderFileNames: [...mine, ...theirs].map((e) => e.fileName),
      ledger: [...mine, ...theirs],
      backupSetId: SET_A,
      keep: 7,
    });
    expect(plan.prune).toEqual([]);
    expect(plan.untouched).toEqual(theirs.map((e) => e.fileName));
  });

  it("retains everything when the ledger is missing", () => {
    const names = Array.from(
      { length: 9 },
      (_, i) => entry(i + 1).fileName,
    );
    const plan = planRetention({
      folderFileNames: names,
      ledger: [],
      backupSetId: SET_A,
      keep: 7,
    });
    expect(plan.prune).toEqual([]);
    expect(plan.untouched).toEqual(names);
  });

  it("never plans deletion of manual exports, temp, or unknown files", () => {
    const ledger = Array.from({ length: 8 }, (_, i) => entry(i + 1));
    const strangers = [
      "Tesina Library.tesina", // manual export: no set/timestamp component
      "notes.txt",
      `Tesina Library - ${SET_A.slice(0, 8)} - 2026-03-01T10-00-00Z.tesina.tmp`,
      "Tesina Library - ZZZZZZZZ - 2026-03-01T10-00-00Z.tesina", // bad grammar
    ];
    const plan = planRetention({
      folderFileNames: [...ledger.map((e) => e.fileName), ...strangers],
      ledger,
      backupSetId: SET_A,
      keep: 7,
    });
    for (const stranger of strangers) {
      expect(plan.untouched).toContain(stranger);
      expect(plan.prune.some((p) => p.fileName === stranger)).toBe(false);
    }
    expect(plan.prune.length).toBe(1);
  });

  it("skips a ledger entry whose file already vanished", () => {
    const ledger = Array.from({ length: 9 }, (_, i) => entry(i + 1));
    const folder = ledger.slice(1).map((e) => e.fileName); // oldest is gone
    const plan = planRetention({
      folderFileNames: folder,
      ledger,
      backupSetId: SET_A,
      keep: 7,
    });
    expect(plan.prune.map((p) => p.fileName)).toEqual([ledger[1].fileName]);
  });

  it("surfaces an accumulation warning well beyond the keep count", () => {
    const ledger = Array.from({ length: 25 }, (_, i) => entry(i + 1));
    const plan = planRetention({
      folderFileNames: ledger.map((e) => e.fileName),
      ledger,
      backupSetId: SET_A,
      keep: 7,
    });
    expect(plan.accumulationWarning).toBe(true);
    const small = planRetention({
      folderFileNames: ledger.slice(0, 8).map((e) => e.fileName),
      ledger: ledger.slice(0, 8),
      backupSetId: SET_A,
      keep: 7,
    });
    expect(small.accumulationWarning).toBe(false);
  });
});

describe("computeContentDigest (task 9.2)", () => {
  it("ignores timestamps, orphan assets, and device state", async () => {
    const fixture = figureHeavyLibraryFixture();
    const snapshot = {
      essays: fixture.essays,
      library: fixture.library,
      assets: new Map(Object.entries(fixture.assets)),
    };
    const base = await snapshotContentDigest(snapshot);

    const touched = structuredClone(fixture.essays);
    touched[0].updatedAt = "2030-01-01T00:00:00.000Z";
    (touched[1] as { importedAt?: string }).importedAt = "2030-01-01T00:00:00Z";
    const withTimestamps = await snapshotContentDigest({
      ...snapshot,
      essays: touched,
    });
    expect(withTimestamps).toBe(base);
  });

  it("changes when content, references, or asset bytes change", async () => {
    const fixture = figureHeavyLibraryFixture();
    const snapshot = {
      essays: fixture.essays,
      library: fixture.library,
      assets: new Map(Object.entries(fixture.assets)),
    };
    const base = await snapshotContentDigest(snapshot);

    const edited = structuredClone(fixture.essays);
    edited[0].titlePage.title = "Edited title";
    expect(await snapshotContentDigest({ ...snapshot, essays: edited })).not
      .toBe(base);

    const fewerRefs = {
      ...fixture.library,
      references: fixture.library.references.slice(1),
    };
    expect(await snapshotContentDigest({ ...snapshot, library: fewerRefs }))
      .not.toBe(base);

    const assetHashes = ["deadbeef"];
    const differentAssets = await computeContentDigest({
      essays: fixture.essays,
      library: fixture.library,
      assetHashes,
    });
    expect(differentAssets).not.toBe(base);
  });

  it("is order-insensitive over essays and assets", async () => {
    const fixture = figureHeavyLibraryFixture();
    const a = await computeContentDigest({
      essays: fixture.essays,
      library: fixture.library,
      assetHashes: ["h1", "h2", "h3"],
    });
    const b = await computeContentDigest({
      essays: [...fixture.essays].reverse(),
      library: fixture.library,
      assetHashes: ["h3", "h1", "h2"],
    });
    expect(a).toBe(b);
  });
});

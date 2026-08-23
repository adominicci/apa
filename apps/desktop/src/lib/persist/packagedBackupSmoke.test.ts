import { describe, expect, it, vi } from "vitest";
import { fullLibraryFixture } from "$lib/portable/fixtures/libraries";
import { sha256Hex } from "$lib/portable/archive";
import { canonicalJsonBytes } from "$lib/portable/canonicalJson";
import {
  EVIDENCE_PATHS,
  FOREIGN_EVIDENCE_FILE,
  PACKAGED_BACKUP_SMOKE_STATE_PATH,
  type PackagedBackupSmokeDeps,
  type PackagedBackupSmokePhase,
  runPackagedBackupSmoke,
} from "./packagedBackupSmoke.ts";

const FEATURE_SHA = "a".repeat(40);
const A_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const B_ID = "bbbbbbbb-2222-4222-8222-222222222222";

class Harness {
  phase: PackagedBackupSmokePhase = "configure";
  files = new Map<string, Uint8Array>();
  archivesA = new Map<string, Uint8Array>();
  archivesB = new Map<string, Uint8Array>();
  active: "A" | "B" | null = null;
  transientReadable = true;
  transientReadError: unknown;
  folderPaths = { A: "/selected/A", B: "/selected/B" };
  pickerCalls = 0;
  manualCounter = 0;
  nowMs = Date.parse("2026-08-18T12:00:00.000Z");
  calls: string[] = [];
  exits: number[] = [];

  constructor() {
    this.files.set("/transient/proof.txt", new TextEncoder().encode("scope"));
  }

  get archives(): Map<string, Uint8Array> {
    if (this.active === "A") return this.archivesA;
    if (this.active === "B") return this.archivesB;
    throw new Error("backup not configured");
  }

  deps(): PackagedBackupSmokeDeps {
    let processPickerCalls = 0;
    return {
      context: () =>
        Promise.resolve({ phase: this.phase, proofCommitSha: FEATURE_SHA }),
      appVersion: () => Promise.resolve("0.1.19"),
      bundleIdentifier: () => Promise.resolve("app.tesina.desktop.smoke"),
      loadUiSettings: () => {
        this.calls.push("load-settings");
        return Promise.resolve();
      },
      flushUiSettings: () => {
        this.calls.push("flush-settings");
        return Promise.resolve();
      },
      appData: {
        readBytes: (path) => Promise.resolve(this.files.get(path) ?? null),
        writeBytes: (path, bytes) => {
          this.calls.push(`appdata-write:${path}`);
          this.files.set(path, bytes.slice());
          return Promise.resolve();
        },
        list: (path) => {
          const prefix = `${path}/`;
          return Promise.resolve(
            [...this.files.keys()]
              .filter((name) => name.startsWith(prefix))
              .map((name) => name.slice(prefix.length))
              .filter((name) => !name.includes("/")),
          );
        },
      },
      exportLibrary: () => {
        this.calls.push(`export:${this.phase}`);
        return Promise.resolve({ path: "/exports/Tesina Library.tesina" });
      },
      seedTransientScope: () => {
        this.calls.push("seed-transient");
        return Promise.resolve("/transient/proof.txt");
      },
      readExternalFile: (path) => {
        this.calls.push(`external-read:${path}`);
        if (!this.transientReadable) {
          if (
            path === "/transient/proof.txt" &&
            this.transientReadError !== undefined
          ) {
            return Promise.reject(this.transientReadError);
          }
          const separator = this.folderPaths.A.includes("\\") ? "\\" : "/";
          const parent = this.folderPaths.A.slice(
            0,
            this.folderPaths.A.lastIndexOf(separator),
          );
          const deniedPaths = [
            "/transient/proof.txt",
            `${parent}${separator}Parent Evidence.bin`,
            `${parent}${separator}Sibling${separator}Sibling Evidence.bin`,
          ];
          if (
            deniedPaths.includes(path) ||
            path.startsWith(
              `${this.folderPaths.A}${separator}Tesina Backups${separator}`,
            )
          ) {
            return Promise.reject(`forbidden path: ${path}`);
          }
          return Promise.reject({ code: "not_found" });
        }
        const bytes = this.files.get(path);
        return bytes === undefined
          ? Promise.reject({ code: "not_found" })
          : Promise.resolve(bytes.slice());
      },
      fakeDestinationExists: () => Promise.reject({ code: "unauthorized" }),
      pickAndBegin: () => {
        processPickerCalls += 1;
        this.pickerCalls += 1;
        this.calls.push(`picker:${this.phase}`);
        const folder = this.phase === "configure" ? "A" : "B";
        const separator = this.folderPaths[folder].includes("\\") ? "\\" : "/";
        return Promise.resolve({
          canonicalFolderPath: this.folderPaths[folder],
          backupSubfolderPath: `${
            this.folderPaths[folder]
          }${separator}Tesina Backups`,
          backupSetId: folder === "A" ? A_ID : B_ID,
        });
      },
      pickerCallCount: () => Promise.resolve(processPickerCalls),
      writeWizardTest: (backupSetId) => {
        const fileName = `Tesina Library - ${
          backupSetId.slice(0, 8)
        } - 2026-08-18T12-00-00Z.tesina`;
        const target = backupSetId === A_ID ? this.archivesA : this.archivesB;
        target.set(fileName, new TextEncoder().encode(`test-${backupSetId}`));
        this.calls.push(`test:${backupSetId.slice(0, 8)}`);
        return Promise.resolve({
          fileName,
          contentDigest: `digest-${backupSetId}`,
        });
      },
      activate: () => {
        this.active = this.phase === "configure" ? "A" : "B";
        this.calls.push(`activate:${this.active}`);
        return Promise.resolve({
          canonicalFolderPath: this.folderPaths[this.active],
          backupSetId: this.active === "A" ? A_ID : B_ID,
        });
      },
      status: () =>
        Promise.resolve({
          configured: this.active !== null,
          folderAvailable: this.active !== null,
          requiresReauthorization: false,
          folderPath: this.active === null
            ? undefined
            : this.folderPaths[this.active],
          backupSetId: this.active === "A"
            ? A_ID
            : this.active === "B"
            ? B_ID
            : undefined,
        }),
      listArchives: () =>
        Promise.resolve(
          [...this.archives.entries()].map(([fileName, bytes]) => ({
            fileName,
            byteLength: bytes.byteLength,
          })),
        ),
      readArchive: (fileName) => {
        if (fileName.includes("/") || fileName.includes("..")) {
          return Promise.reject({ code: "invalid_file_name" });
        }
        const bytes = this.archives.get(fileName);
        return bytes === undefined
          ? Promise.reject({ code: "not_found" })
          : Promise.resolve(bytes.slice());
      },
      removeArchive: async (fileName, expectedSha256) => {
        const bytes = this.archives.get(fileName);
        if (bytes === undefined) throw { code: "not_found" };
        if (await sha256Hex(bytes) !== expectedSha256) {
          throw { code: "hash_mismatch" };
        }
        this.archives.delete(fileName);
      },
      runManual: () => {
        this.manualCounter += 1;
        const setId = this.active === "A" ? A_ID : B_ID;
        const stamp = new Date(this.nowMs).toISOString().replace(/:/g, "-")
          .replace(/\.\d+Z$/, "Z");
        const fileName = `Tesina Library - ${
          setId.slice(0, 8)
        } - ${stamp}.tesina`;
        this.archives.set(
          fileName,
          new TextEncoder().encode(`manual-${this.manualCounter}`),
        );
        const owned = [...this.archives.keys()].filter((name) =>
          name.startsWith(`Tesina Library - ${setId.slice(0, 8)} -`)
        ).sort();
        while (owned.length > 7) {
          this.archives.delete(owned.shift()!);
        }
        return Promise.resolve({
          kind: "success" as const,
          fileName,
          retentionWarning: false,
        });
      },
      previewBackup: (fileName) => {
        this.calls.push(`preview:${fileName}`);
        const fixture = fullLibraryFixture();
        return Promise.resolve({
          preview: {
            essays: {
              new: 1,
              identical: fixture.essays.length - 1,
              conflicting: 0,
            },
            references: {
              new: 0,
              identical: fixture.library.references.length,
              conflicting: 0,
            },
            collections: {
              new: 0,
              identical: fixture.library.collections.length,
              conflicting: 0,
            },
            assets: { reused: Object.keys(fixture.assets).length, added: 0 },
          },
        } as never);
      },
      applyImport: (preview) => {
        const fixture = fullLibraryFixture();
        const restored = fixture.essays[0];
        this.files.set(
          `essays/${restored.id}.json`,
          canonicalJsonBytes(restored),
        );
        this.calls.push("apply");
        return Promise.resolve({
          kind: "applied",
          transactionId: "smoke-import",
          preview: preview.preview,
        } as never);
      },
      now: () => this.nowMs,
      sleep: (milliseconds) => {
        this.nowMs += Math.max(1_000, milliseconds);
        return Promise.resolve();
      },
      exit: (code) => {
        this.calls.push(`exit:${code}`);
        this.exits.push(code);
        return Promise.resolve();
      },
      reportError: vi.fn(),
    };
  }
}

function readJson<T>(harness: Harness, path: string): T {
  const bytes = harness.files.get(path);
  if (bytes === undefined) throw new Error(`missing ${path}`);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

describe("packaged backup smoke", () => {
  it("runs the four real multi-launch phases through bounded durable state", async () => {
    const harness = new Harness();
    const fixture = fullLibraryFixture();

    await runPackagedBackupSmoke(harness.deps());
    expect(harness.exits).toEqual([0]);
    expect(harness.pickerCalls).toBe(1);
    const configureEvidence = readJson<{
      assertions: string[];
      selectionInvocations: number;
    }>(harness, EVIDENCE_PATHS.configure);
    expect(configureEvidence.selectionInvocations).toBe(1);
    expect(configureEvidence.assertions).toEqual([
      "fixture-seeded",
      "manual-export-created",
      "transient-scope-seeded-and-readable",
      "folder-a-test-activated",
    ]);
    const configureLoad = harness.calls.indexOf("load-settings");
    const configureState = harness.calls.indexOf(
      `appdata-write:${PACKAGED_BACKUP_SMOKE_STATE_PATH}`,
    );
    const configureReport = harness.calls.indexOf(
      `appdata-write:${EVIDENCE_PATHS.configure}`,
    );
    const configureFlush = harness.calls.indexOf("flush-settings");
    const configureExit = harness.calls.indexOf("exit:0");
    expect(configureLoad).toBeLessThan(configureState);
    expect(configureState).toBeLessThan(configureReport);
    expect(configureReport).toBeLessThan(configureFlush);
    expect(configureFlush).toBeLessThan(configureExit);

    harness.phase = "restart";
    harness.transientReadable = false;
    const restartCallStart = harness.calls.length;
    await runPackagedBackupSmoke(harness.deps());
    expect(harness.exits.at(-1)).toBe(0);
    expect(harness.pickerCalls).toBe(1);
    expect(harness.calls.slice(restartCallStart)).not.toContain(
      "picker:restart",
    );
    const restartEvidence = readJson<{
      assertions: string[];
      selectionInvocations: number;
    }>(harness, EVIDENCE_PATHS.restart);
    expect(restartEvidence.selectionInvocations).toBe(0);
    expect(restartEvidence.assertions).toEqual([
      "configured-before-picker",
      "archive-listed-and-readable-before-picker",
      "archive-name-traversal-denied",
      "ambient-parent-and-sibling-plugin-fs-reads-denied",
      "wrong-hash-removal-denied",
      "right-hash-removal-succeeded",
      "stale-transient-scope-denied",
      "manual-export-replaced",
      "fake-export-token-denied",
      "old-folder-probe-created",
    ]);

    harness.phase = "reconfigure";
    harness.archivesB.set(
      FOREIGN_EVIDENCE_FILE,
      new TextEncoder().encode("runner-owned-foreign-evidence"),
    );
    await runPackagedBackupSmoke(harness.deps());
    expect(harness.exits.at(-1)).toBe(0);
    expect(harness.pickerCalls).toBe(2);
    const reconfigureEvidence = readJson<{
      assertions: string[];
      archiveNames: string[];
      selectionInvocations: number;
    }>(harness, EVIDENCE_PATHS.reconfigure);
    expect(reconfigureEvidence.selectionInvocations).toBe(1);
    expect(reconfigureEvidence.assertions).toEqual([
      "folder-b-test-activated",
      "old-folder-backup-api-read-denied",
      "old-folder-plugin-fs-read-denied",
      "eight-to-seven-retention",
      "foreign-bytes-untouched",
      "restore-target-recorded",
    ]);
    expect(reconfigureEvidence.archiveNames).toHaveLength(8);

    const deletedEssay = fixture.essays[0];
    harness.files.delete(`essays/${deletedEssay.id}.json`);
    harness.phase = "restore";
    await runPackagedBackupSmoke(harness.deps());
    expect(harness.exits.at(-1)).toBe(0);
    expect(harness.pickerCalls).toBe(2);
    expect(harness.files.has(`essays/${deletedEssay.id}.json`)).toBe(true);
    expect(harness.calls.filter((call) => call === "load-settings"))
      .toHaveLength(
        4,
      );
    const restoreEvidence = readJson<{
      assertions: string[];
      selectionInvocations: number;
    }>(harness, EVIDENCE_PATHS.restore);
    expect(restoreEvidence.selectionInvocations).toBe(0);
    expect(restoreEvidence.assertions).toEqual([
      "deleted-essay-previewed",
      "merge-applied",
      "essay-count-restored",
      "relationships-restored",
      "figure-bytes-restored",
      "completed",
    ]);
    expect(harness.calls.filter((call) => call === "flush-settings"))
      .toHaveLength(4);
  });

  it("fails closed on an oversized or out-of-order state marker", async () => {
    const harness = new Harness();
    harness.phase = "restart";
    harness.files.set(
      PACKAGED_BACKUP_SMOKE_STATE_PATH,
      new Uint8Array(64 * 1024 + 1),
    );
    const deps = harness.deps();

    await runPackagedBackupSmoke(deps);

    expect(harness.exits).toEqual([1]);
    expect(deps.reportError).toHaveBeenCalledOnce();
    expect(harness.pickerCalls).toBe(0);
  });

  it("fails when the native picker counter does not prove the phase", async () => {
    const harness = new Harness();
    const deps = harness.deps();
    deps.pickerCallCount = () => Promise.resolve(0);

    await runPackagedBackupSmoke(deps);

    expect(harness.exits).toEqual([1]);
    expect(deps.reportError).toHaveBeenCalledOnce();
    expect(harness.pickerCalls).toBe(1);
  });

  it("checks the no-picker count again before a restart phase exits", async () => {
    const harness = new Harness();
    await runPackagedBackupSmoke(harness.deps());
    harness.phase = "restart";
    harness.transientReadable = false;
    const deps = harness.deps();
    deps.pickerCallCount = vi.fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValue(1);

    await runPackagedBackupSmoke(deps);

    expect(harness.exits.at(-1)).toBe(1);
    expect(deps.reportError).toHaveBeenCalledOnce();
    expect(harness.pickerCalls).toBe(1);
  });

  it("requires the stale transient read to fail at the plugin-fs scope", async () => {
    const harness = new Harness();
    await runPackagedBackupSmoke(harness.deps());

    harness.phase = "restart";
    harness.transientReadable = false;
    harness.transientReadError = { code: "not_found" };
    const deps = harness.deps();

    await runPackagedBackupSmoke(deps);

    expect(harness.exits).toEqual([0, 1]);
    expect(deps.reportError).toHaveBeenCalledOnce();
    const restartEvidence = readJson<{
      passed: boolean;
      assertions: string[];
    }>(harness, EVIDENCE_PATHS.restart);
    expect(restartEvidence).toMatchObject({ passed: false, assertions: [] });
  });

  it("requires plugin-fs scope denials for ambient and old-folder files", async () => {
    const harness = new Harness();
    await runPackagedBackupSmoke(harness.deps());

    harness.phase = "restart";
    harness.transientReadable = false;
    await runPackagedBackupSmoke(harness.deps());

    expect(harness.calls).toContain(
      "external-read:/selected/Parent Evidence.bin",
    );
    expect(harness.calls).toContain(
      "external-read:/selected/Sibling/Sibling Evidence.bin",
    );

    const restartState = readJson<{
      folderA: { oldProbeFileName: string };
    }>(harness, PACKAGED_BACKUP_SMOKE_STATE_PATH);
    harness.phase = "reconfigure";
    harness.archivesB.set(
      FOREIGN_EVIDENCE_FILE,
      new TextEncoder().encode("runner-owned-foreign-evidence"),
    );
    await runPackagedBackupSmoke(harness.deps());

    expect(harness.calls).toContain(
      `external-read:/selected/A/Tesina Backups/${restartState.folderA.oldProbeFileName}`,
    );
  });

  it("derives Windows plugin-fs proof paths from the selected folder", async () => {
    const harness = new Harness();
    harness.folderPaths = {
      A: String.raw`C:\proof\selected-parent\Folder A`,
      B: String.raw`C:\proof\selected-parent\Folder B`,
    };
    await runPackagedBackupSmoke(harness.deps());

    harness.phase = "restart";
    harness.transientReadable = false;
    await runPackagedBackupSmoke(harness.deps());
    const restartState = readJson<{
      folderA: { oldProbeFileName: string };
    }>(harness, PACKAGED_BACKUP_SMOKE_STATE_PATH);

    expect(harness.calls).toContain(
      String.raw`external-read:C:\proof\selected-parent\Parent Evidence.bin`,
    );
    expect(harness.calls).toContain(
      String
        .raw`external-read:C:\proof\selected-parent\Sibling\Sibling Evidence.bin`,
    );

    harness.phase = "reconfigure";
    harness.archivesB.set(
      FOREIGN_EVIDENCE_FILE,
      new TextEncoder().encode("runner-owned-foreign-evidence"),
    );
    await runPackagedBackupSmoke(harness.deps());

    expect(harness.calls).toContain(
      String
        .raw`external-read:C:\proof\selected-parent\Folder A\Tesina Backups` +
        `\\${restartState.folderA.oldProbeFileName}`,
    );
  });

  it("gates the backup smoke before portable smoke and normal startup", async () => {
    const deno = (globalThis as unknown as {
      Deno: { cwd(): string; readTextFile(path: string): Promise<string> };
    }).Deno;
    const source = await deno.readTextFile(
      `${deno.cwd()}/apps/desktop/src/lib/components/AppPage.svelte`,
    );
    const gate = source.indexOf("VITE_TESINA_PACKAGED_BACKUP_SMOKE");
    const runner = source.indexOf("runPackagedBackupSmoke");
    const portable = source.indexOf("if (packagedPortableSmoke)");
    const startup = source.indexOf(
      "runStartupSafetyPhase",
      source.indexOf("onMount(async"),
    );

    expect(gate).toBeGreaterThan(-1);
    expect(runner).toBeGreaterThan(gate);
    expect(portable).toBeGreaterThan(runner);
    expect(startup).toBeGreaterThan(portable);
  });
});

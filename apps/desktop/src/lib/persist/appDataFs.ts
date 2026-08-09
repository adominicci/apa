/**
 * Real app-data adapters for the import/export machinery: the ImportFs used
 * by the journal, the SnapshotIo used by stable capture, and the durable
 * replacement journal — all over the Tauri fs plugin, $APPDATA-relative,
 * matching persist/atomic.ts conventions.
 */

import {
  exists,
  mkdir,
  open,
  readDir,
  readFile,
  readTextFile,
  remove,
  rename,
  stat,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { appDataDir, dirname, join } from "@tauri-apps/api/path";
import { persistence } from "./coordinator.ts";
import type { ImportFs } from "./importJournal.ts";
import type { SnapshotIo } from "./librarySnapshot.ts";
import type { ReplacementJournal, ReplacementRecord } from "./portableFiles.ts";
import { readJson, writeJsonAtomic } from "./atomic.ts";
import {
  installReplacement,
  isWindowsWebView,
  recoverInterruptedReplacement,
} from "./atomicReplace.ts";
import { sha256 } from "@noble/hashes/sha256";

async function absolute(relPath: string): Promise<string> {
  return await join(await appDataDir(), relPath);
}

async function recoverWindowsTarget(target: string): Promise<void> {
  if (isWindowsWebView()) {
    await recoverInterruptedReplacement(target, { exists, remove, rename });
  }
}

/** ImportFs over $APPDATA. Writes are atomic (tmp + rename) and counted. */
export const appDataImportFs: ImportFs = {
  async exists(relPath) {
    const target = await absolute(relPath);
    await recoverWindowsTarget(target);
    return await exists(target);
  },
  async readBytes(relPath) {
    const target = await absolute(relPath);
    await recoverWindowsTarget(target);
    if (!(await exists(target))) return null;
    return await readFile(target);
  },
  async writeBytes(relPath, bytes) {
    persistence.noteDirectWrite();
    const target = await absolute(relPath);
    const dir = await dirname(target);
    if (!(await exists(dir))) await mkdir(dir, { recursive: true });
    const tmp = `${target}.tmp`;
    await writeFile(tmp, bytes);
    await installReplacement(
      tmp,
      target,
      { exists, remove, rename },
      isWindowsWebView(),
    );
  },
  async rename(fromRel, toRel) {
    persistence.noteDirectWrite();
    const to = await absolute(toRel);
    const dir = await dirname(to);
    if (!(await exists(dir))) await mkdir(dir, { recursive: true });
    await rename(await absolute(fromRel), to);
  },
  async remove(relPath) {
    persistence.noteDirectWrite();
    const target = await absolute(relPath);
    if (await exists(target)) await remove(target);
  },
  async removeDir(relDir) {
    persistence.noteDirectWrite();
    const target = await absolute(relDir);
    if (await exists(target)) await remove(target, { recursive: true });
  },
  async list(relDir) {
    const target = await absolute(relDir);
    if (!(await exists(target))) return [];
    return (await readDir(target)).map((entry) => entry.name);
  },
};

/** SnapshotIo over $APPDATA for stable capture. */
export const appDataSnapshotIo: SnapshotIo = {
  async listEssayFiles() {
    const dir = await absolute("essays");
    if (!(await exists(dir))) return [];
    return (await readDir(dir))
      .filter((entry) => entry.isFile && entry.name.endsWith(".json"))
      .map((entry) => entry.name);
  },
  async readEssayFile(name) {
    const target = await absolute(`essays/${name}`);
    await recoverWindowsTarget(target);
    if (!(await exists(target))) return null;
    try {
      return JSON.parse(await readTextFile(target));
    } catch {
      // Unparseable JSON is invalid source content, not a race.
      return { schemaVersion: -1 };
    }
  },
  async readLibraryFile() {
    return await readJson("library.json");
  },
  async readAssetFile(relPath) {
    const target = await absolute(relPath);
    await recoverWindowsTarget(target);
    if (!(await exists(target))) return null;
    return await readFile(target);
  },
};

interface ReplacementJournalFile {
  schemaVersion: 1;
  records: ReplacementRecord[];
}

const REPLACEMENTS_FILE = "replacements.json";

/** Durable replacement records under $APPDATA (design §7 fallback). */
export const appDataReplacementJournal: ReplacementJournal = {
  async save(record) {
    const file = await readJson<ReplacementJournalFile>(REPLACEMENTS_FILE);
    const records = (file?.records ?? []).filter((r) => r.id !== record.id);
    records.push(record);
    await writeJsonAtomic(REPLACEMENTS_FILE, { schemaVersion: 1, records });
  },
  async list() {
    const file = await readJson<ReplacementJournalFile>(REPLACEMENTS_FILE);
    return file?.records ?? [];
  },
  async remove(id) {
    const file = await readJson<ReplacementJournalFile>(REPLACEMENTS_FILE);
    if (!file) return;
    await writeJsonAtomic(REPLACEMENTS_FILE, {
      schemaVersion: 1,
      records: file.records.filter((r) => r.id !== id),
    });
  },
};

/** ExternalFs over absolute dialog-granted paths (manual export/import). */
export function externalDialogFs() {
  return {
    async exists(path: string) {
      return await exists(path);
    },
    async readFile(path: string) {
      return await readFile(path);
    },
    async readFileBounded(path: string, maxBytes: number) {
      const file = await open(path, { read: true });
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const buffer = new Uint8Array(
            Math.min(64 * 1024, maxBytes - total + 1),
          );
          const read = await file.read(buffer);
          if (read === null || read === 0) break;
          total += read;
          if (total > maxBytes) {
            throw Object.assign(
              new Error("selected archive exceeded its read limit"),
              { code: "portable/file-too-large" },
            );
          }
          chunks.push(buffer.slice(0, read));
        }
      } finally {
        await file.close();
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    },
    async sha256File(path: string) {
      const file = await open(path, { read: true });
      const hash = sha256.create();
      try {
        while (true) {
          const buffer = new Uint8Array(64 * 1024);
          const read = await file.read(buffer);
          if (read === null || read === 0) break;
          hash.update(buffer.subarray(0, read));
        }
      } finally {
        await file.close();
      }
      return [...hash.digest()].map((byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("");
    },
    async writeFile(path: string, bytes: Uint8Array) {
      await writeFile(path, bytes);
    },
    async rename(from: string, to: string) {
      await rename(from, to);
    },
    async renameNoReplace(from: string, to: string) {
      if (await exists(to)) throw new Error("destination exists");
      await rename(from, to);
    },
    async remove(path: string) {
      if (await exists(path)) await remove(path);
    },
    async statSize(path: string) {
      if (!(await exists(path))) return null;
      return (await stat(path)).size;
    },
  };
}

/** Writes a UTF-8 text file at an absolute dialog-granted path. */
export async function writeExternalText(
  path: string,
  text: string,
): Promise<void> {
  await writeTextFile(path, text);
}

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
import { invoke } from "@tauri-apps/api/core";
import { ARCHIVE_LIMITS } from "$lib/portable/limits";
import { persistence } from "./coordinator.ts";
import type { ImportFs } from "./importJournal.ts";
import type { SnapshotIo } from "./librarySnapshot.ts";
import {
  PortableFileError,
  type ReplacementJournal,
  type ReplacementRecord,
} from "./portableFiles.ts";
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

async function readLocalFileBounded(
  path: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const file = await open(path, { read: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const buffer = new Uint8Array(Math.min(64 * 1024, maxBytes - total + 1));
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
  async readBytesBounded(relPath, maxBytes) {
    const target = await absolute(relPath);
    await recoverWindowsTarget(target);
    if (!(await exists(target))) return null;
    return await readLocalFileBounded(target, maxBytes);
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
  schemaVersion: 2;
  records: ReplacementRecord[];
}

const REPLACEMENTS_FILE = "replacements.json";

function requiredJournalString(
  value: Record<string, unknown>,
  field: string,
): string {
  const candidate = value[field];
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error(`invalid replacement journal field: ${field}`);
  }
  return candidate;
}

function normalizeReplacementRecord(
  value: unknown,
  legacy: boolean,
): ReplacementRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid replacement journal record");
  }
  const record = value as Record<string, unknown>;
  const base = {
    id: requiredJournalString(record, "id"),
    destinationPath: requiredJournalString(record, "destinationPath"),
    temporaryPath: requiredJournalString(record, "temporaryPath"),
    previousPath: requiredJournalString(record, "previousPath"),
    expectedSha256: requiredJournalString(record, "expectedSha256"),
  };
  const phase = legacy ? "replacing" : record.phase;
  if (phase === "staging") return { ...base, phase };
  if (phase === "replacing") {
    return {
      ...base,
      phase,
      previousSha256: requiredJournalString(record, "previousSha256"),
    };
  }
  throw new Error("invalid replacement journal phase");
}

async function readReplacementRecords(): Promise<ReplacementRecord[] | null> {
  const target = await absolute(REPLACEMENTS_FILE);
  await recoverWindowsTarget(target);
  if (!(await exists(target))) return null;
  const file: unknown = JSON.parse(await readTextFile(target));
  if (typeof file !== "object" || file === null || Array.isArray(file)) {
    throw new Error("invalid replacement journal");
  }
  const candidate = file as Record<string, unknown>;
  if (!Array.isArray(candidate.records)) {
    throw new Error("invalid replacement journal records");
  }
  if (candidate.schemaVersion === 1) {
    return candidate.records.map((record) =>
      normalizeReplacementRecord(record, true)
    );
  }
  if (candidate.schemaVersion === 2) {
    return candidate.records.map((record) =>
      normalizeReplacementRecord(record, false)
    );
  }
  throw new Error("unsupported replacement journal schema");
}

async function writeReplacementRecords(
  records: ReplacementRecord[],
): Promise<void> {
  const file: ReplacementJournalFile = { schemaVersion: 2, records };
  await writeJsonAtomic(REPLACEMENTS_FILE, file);
}

/** Durable replacement records under $APPDATA (design §7 fallback). */
export const appDataReplacementJournal: ReplacementJournal = {
  async save(record) {
    const records = (await readReplacementRecords() ?? []).filter((r) =>
      r.id !== record.id
    );
    records.push(record);
    await writeReplacementRecords(records);
  },
  async list() {
    return await readReplacementRecords() ?? [];
  },
  async remove(id) {
    const records = await readReplacementRecords();
    if (records === null) return;
    await writeReplacementRecords(records.filter((record) => record.id !== id));
  },
};

/** ExternalFs over absolute dialog-granted paths (manual export/import). */
const RELATED_FILE_PATTERN =
  /\.[tT][eE][sS][iI][nN][aA]\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(tmp|prev)$/;

function relatedFileKind(path: string): "tmp" | "prev" | null {
  const match = RELATED_FILE_PATTERN.exec(path);
  return match?.[1] === "tmp" || match?.[1] === "prev" ? match[1] : null;
}

async function invokeRelatedBinary<T>(
  command: string,
  path: string,
  bytes: Uint8Array,
  authorizationToken: string,
): Promise<T> {
  return await invoke<T>(command, bytes, {
    headers: {
      "x-tesina-related-path-encoded": encodeURIComponent(path),
      "x-tesina-save-authorization": authorizationToken,
    },
  });
}

function requireSaveAuthorization(token: string | undefined): string {
  if (token !== undefined && token !== "") return token;
  throw new PortableFileError(
    "portable/authorization-required",
    "manual export requires a fresh native save authorization",
  );
}

export function externalDialogFs(authorizationToken?: string) {
  const authorized = <T extends Record<string, unknown>>(args: T) => ({
    ...args,
    authorizationToken: requireSaveAuthorization(authorizationToken),
  });
  return {
    async exists(path: string) {
      if (relatedFileKind(path) !== null) {
        return await invoke<boolean>(
          "external_related_exists",
          authorized({ path }),
        );
      }
      if (authorizationToken !== undefined) {
        return await invoke<boolean>(
          "external_destination_exists",
          authorized({ path }),
        );
      }
      return await exists(path);
    },
    async readFile(path: string) {
      if (relatedFileKind(path) === "tmp") {
        const bytes = await invoke<ArrayBuffer | Uint8Array>(
          "external_read_temp",
          authorized({ path, maxBytes: ARCHIVE_LIMITS.maxArchiveBytes }),
        );
        return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      }
      if (authorizationToken !== undefined) {
        const bytes = await invoke<ArrayBuffer | Uint8Array>(
          "external_read_destination",
          authorized({ path, maxBytes: ARCHIVE_LIMITS.maxArchiveBytes }),
        );
        return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      }
      return await readFile(path);
    },
    async readFileBounded(path: string, maxBytes: number) {
      if (relatedFileKind(path) === "tmp") {
        const result = await invoke<ArrayBuffer | Uint8Array>(
          "external_read_temp",
          authorized({ path, maxBytes }),
        );
        const bytes = result instanceof Uint8Array
          ? result
          : new Uint8Array(result);
        if (bytes.byteLength > maxBytes) {
          throw new PortableFileError(
            "portable/file-too-large",
            "the selected archive exceeds the supported archive size",
            path,
          );
        }
        return bytes;
      }
      if (authorizationToken !== undefined) {
        const result = await invoke<ArrayBuffer | Uint8Array>(
          "external_read_destination",
          authorized({ path, maxBytes }),
        );
        const bytes = result instanceof Uint8Array
          ? result
          : new Uint8Array(result);
        if (bytes.byteLength > maxBytes) {
          throw new PortableFileError(
            "portable/file-too-large",
            "the selected archive exceeds the supported archive size",
            path,
          );
        }
        return bytes;
      }
      return await readLocalFileBounded(path, maxBytes);
    },
    async sha256File(path: string, maxBytes: number) {
      if (relatedFileKind(path) === "prev") {
        return await invoke<string>(
          "external_hash_previous",
          authorized({ path, maxBytes }),
        );
      }
      if (authorizationToken !== undefined) {
        return await invoke<string>(
          "external_hash_destination",
          authorized({ path, maxBytes }),
        );
      }
      const file = await open(path, { read: true });
      const hash = sha256.create();
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
            throw new PortableFileError(
              "portable/file-too-large",
              "the selected archive exceeds the supported archive size",
              path,
            );
          }
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
      if (relatedFileKind(path) === "tmp") {
        await invokeRelatedBinary<void>(
          "external_write_temp",
          path,
          bytes,
          requireSaveAuthorization(authorizationToken),
        );
        return;
      }
      if (authorizationToken !== undefined) {
        throw new PortableFileError(
          "portable/invalid-destination-write",
          "manual export publishes the destination only through native safe-write commands",
          path,
        );
      }
      await writeFile(path, bytes);
    },
    async rename(from: string, to: string, expectedSha256: string) {
      if (relatedFileKind(to) === "prev") {
        await invoke(
          "external_preserve_destination",
          authorized({
            destination: from,
            previous: to,
            expectedSha256,
          }),
        );
        return;
      }
      if (authorizationToken !== undefined) {
        throw new PortableFileError(
          "portable/invalid-related-path",
          "manual export cannot rename an unauthorized external path",
          from,
        );
      }
      await rename(from, to);
    },
    async renameNoReplace(
      from: string,
      to: string,
      expectedSha256: string,
    ) {
      await invoke(
        "external_rename_no_replace",
        authorized({
          from,
          to,
          expectedSha256,
        }),
      );
    },
    async removeIfHashMatches(
      path: string,
      expectedSha256: string,
      installedDestinationSha256?: string,
    ) {
      const kind = relatedFileKind(path);
      if (kind === "tmp") {
        await invoke(
          "external_remove_temp",
          authorized({ path, expectedSha256 }),
        );
        return;
      }
      if (kind !== "prev" || installedDestinationSha256 === undefined) {
        throw new PortableFileError(
          "portable/invalid-related-path",
          "preserved-file cleanup requires its installed destination digest",
          path,
        );
      }
      await invoke(
        "external_remove_if_hash_matches",
        authorized({
          path,
          expectedSha256,
          installedDestinationSha256,
        }),
      );
    },
    async remove(path: string) {
      if (authorizationToken !== undefined) {
        throw new PortableFileError(
          "portable/invalid-destination-write",
          "manual export cannot directly remove its selected destination",
          path,
        );
      }
      if (await exists(path)) await remove(path);
    },
    async statSize(path: string) {
      if (authorizationToken !== undefined) {
        throw new PortableFileError(
          "portable/invalid-destination-read",
          "authorized export destinations are read through bounded native commands",
          path,
        );
      }
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

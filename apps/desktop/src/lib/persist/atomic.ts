import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { appDataDir, dirname, join } from "@tauri-apps/api/path";
import { persistence } from "./coordinator.ts";

/**
 * All Tesina data lives under the OS app-data directory ($APPDATA), the only
 * location the fs capability grants. Paths passed to these helpers are
 * relative to that base (e.g. "essays/abc.json"). The base directory itself
 * does not exist on a fresh install, so every write path ensures it first.
 */
async function resolveAbsolute(relativePath: string): Promise<string> {
  return await join(await appDataDir(), relativePath);
}

async function ensureDir(absoluteDir: string): Promise<void> {
  if (!(await exists(absoluteDir))) {
    await mkdir(absoluteDir, { recursive: true });
  }
}

/**
 * Crash-safe write: the content lands in a sibling `*.tmp` file first and is
 * renamed over the target only once fully written, so a crash mid-write can
 * never leave a truncated essay on disk.
 */
export async function writeJsonAtomic(
  relativePath: string,
  data: unknown,
): Promise<void> {
  persistence.noteDirectWrite();
  await writeJsonAtomicQuiet(relativePath, data);
}

/**
 * Same crash-safe write WITHOUT the persistence-activity note. Only for
 * files outside the content library (settings/status caches): backup-owned
 * status writes must never feed the activity signal that schedules backup
 * eligibility checks, or an unchanged library would re-check forever.
 */
export async function writeJsonAtomicQuiet(
  relativePath: string,
  data: unknown,
): Promise<void> {
  const target = await resolveAbsolute(relativePath);
  await ensureDir(await dirname(target));
  const tmp = `${target}.tmp`;
  await writeTextFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, target);
}

/** Returns `null` when the file does not exist yet. */
export async function readJson<T>(relativePath: string): Promise<T | null> {
  const target = await resolveAbsolute(relativePath);
  if (!(await exists(target))) return null;
  return JSON.parse(await readTextFile(target)) as T;
}

export async function removeFile(relativePath: string): Promise<void> {
  persistence.noteDirectWrite();
  const target = await resolveAbsolute(relativePath);
  if (await exists(target)) {
    await remove(target);
  }
}

export async function fileExists(relativePath: string): Promise<boolean> {
  return await exists(await resolveAbsolute(relativePath));
}

/** Names of the .json files directly inside a directory (no recursion). */
export async function listJsonFiles(relativeDir: string): Promise<string[]> {
  const dir = await resolveAbsolute(relativeDir);
  if (!(await exists(dir))) return [];
  const entries = await readDir(dir);
  return entries
    .filter((entry) => entry.isFile && entry.name.endsWith(".json"))
    .map((entry) => entry.name);
}

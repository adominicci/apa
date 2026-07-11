import {
  exists,
  mkdir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { appDataDir, dirname, join } from "@tauri-apps/api/path";

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
  const target = await resolveAbsolute(relativePath);
  if (await exists(target)) {
    await remove(target);
  }
}

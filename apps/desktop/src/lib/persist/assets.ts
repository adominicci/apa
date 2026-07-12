import { mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";

/**
 * Figure images are copied into `essays/assets/` under $APPDATA and referenced
 * by a relative path stored on the figure node. Bytes are read from a webview
 * File object (an <input type=file>), never from an arbitrary filesystem path,
 * so no fs scope beyond $APPDATA is needed. Data URLs are deliberately avoided
 * — they would bloat the essay JSON and slow autosave.
 */
const IMAGE_DIR = "essays/assets";

export type ImageKind = "png" | "jpg" | "gif" | "bmp";

const EXT_KIND: Record<string, ImageKind> = {
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
  gif: "gif",
  bmp: "bmp",
};

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "png";
  return EXT_KIND[ext] ? ext : "png";
}

/** docx needs the image type; derive it from the stored path's extension. */
export function imageKind(relPath: string): ImageKind {
  return EXT_KIND[extOf(relPath)] ?? "png";
}

async function absolute(relPath: string): Promise<string> {
  return await join(await appDataDir(), relPath);
}

/** Copies a picked image into the assets dir; returns its relative path. */
export async function importImageFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = extOf(file.name);
  const relPath = `${IMAGE_DIR}/${crypto.randomUUID()}.${ext}`;
  const target = await absolute(relPath);
  await mkdir(await absolute(IMAGE_DIR), { recursive: true });
  await writeFile(target, bytes);
  return relPath;
}

export async function readImageBytes(relPath: string): Promise<Uint8Array> {
  return await readFile(await absolute(relPath));
}

/** Reads an asset and wraps it in a blob URL for display in the webview. */
export async function imageObjectUrl(relPath: string): Promise<string> {
  const bytes = await readImageBytes(relPath);
  return URL.createObjectURL(new Blob([bytes]));
}

import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { Reference } from "@tesina/engine";
import {
  exportDocx,
  type ExportImage,
  type ExportInput,
} from "@tesina/docx-export";
import type { Essay } from "$lib/model/essay";
import { imageKind, readImageBytes } from "$lib/persist/assets";

export type ExportOutcome =
  | { status: "saved"; path: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

function sanitizeFilename(title: string): string {
  const clean = title.replace(/[\\/:*?"<>|]/g, "").trim();
  return clean === "" ? "ensayo" : clean;
}

function collectFigureSrcs(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const n = node as {
    type?: string;
    attrs?: { src?: string };
    content?: unknown[];
  };
  if (n.type === "figureImage" && n.attrs?.src) out.add(n.attrs.src);
  for (const child of n.content ?? []) collectFigureSrcs(child, out);
}

/** Intrinsic pixel size, scaled so wide images fit the 6.5in text column. */
async function measureScaled(
  bytes: Uint8Array,
): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(new Blob([bytes]));
  try {
    const { w, h } = await new Promise<{ w: number; h: number }>(
      (resolve, reject) => {
        const img = new Image();
        img.onload = () =>
          resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => reject(new Error("no se pudo leer la imagen"));
        img.src = url;
      },
    );
    const maxW = 500;
    if (w === 0 || w <= maxW) return { width: w || maxW, height: h };
    return { width: maxW, height: Math.round((h * maxW) / w) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Reads and measures every figure image so the pure exporter gets bytes. */
async function collectImages(
  docJson: unknown,
): Promise<Record<string, ExportImage>> {
  const srcs = new Set<string>();
  collectFigureSrcs(docJson, srcs);
  const images: Record<string, ExportImage> = {};
  for (const src of srcs) {
    try {
      const data = await readImageBytes(src);
      const { width, height } = await measureScaled(data);
      images[src] = { data, type: imageKind(src), width, height };
    } catch {
      // Missing/undecodable asset — the figure exports without an image.
    }
  }
  return images;
}

/**
 * Builds the exporter input from the live essay, asks where to save, and
 * writes the .docx. Paths picked in the native dialog are granted to the
 * fs scope by the dialog plugin, so writing outside $APPDATA works.
 */
export async function exportEssayToDocx(
  essay: Essay,
  docJson: unknown,
  references: Reference[],
): Promise<ExportOutcome> {
  try {
    const images = await collectImages(docJson);
    const input: ExportInput = {
      content: docJson,
      settings: {
        documentLanguage: essay.settings.documentLanguage,
        variant: essay.settings.variant,
        font: essay.settings.font,
        paperSize: essay.settings.paperSize,
        ...(essay.settings.runningHead
          ? { runningHead: essay.settings.runningHead }
          : {}),
      },
      titlePage: essay.titlePage,
      references,
      ...(Object.keys(images).length > 0 ? { images } : {}),
    };
    const bytes = await exportDocx(input);
    const path = await save({
      defaultPath: `${sanitizeFilename(essay.titlePage.title)}.docx`,
      filters: [{ name: "Documento de Word", extensions: ["docx"] }],
    });
    if (!path) return { status: "cancelled" };
    await writeFile(path, bytes);
    return { status: "saved", path };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

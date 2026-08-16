import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { Reference } from "@tesina/engine";
import {
  exportDocx,
  type ExportImage,
  type ExportInput,
  type MathNode,
} from "@tesina/docx-export";
import type { Essay } from "$lib/model/essay";
import { imageKind, readImageBytes } from "$lib/persist/assets";
import { latexToMathTree } from "$lib/editor/mathml";
import { m } from "$lib/paraglide/messages";
import {
  collectEquationLatex,
  collectFigureSrcs,
} from "$lib/export/exportAssets";

/** The formats the export menu offers. */
export type ExportFormat = "docx" | "pdf";

export type ExportOutcome =
  | { status: "saved"; path: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

export function sanitizeFilename(title: string): string {
  const clean = title.replace(/[\\/:*?"<>|]/g, "").trim();
  return clean === "" ? "ensayo" : clean;
}

/**
 * Converts each block equation's LaTeX to a MathML tree so the pure exporter
 * can map it to a native OMML equation; mirrors `collectImages` below. Before
 * this the exporter's `equations` map was always empty (Task 6's gap), so
 * every real export fell back to raw LaTeX text even for equations that map
 * perfectly.
 */
function collectEquations(docJson: unknown): Record<string, MathNode> {
  const latexes = new Set<string>();
  collectEquationLatex(docJson, latexes);
  // Object.create(null) instead of `{}`: the key is arbitrary user LaTeX, and
  // a literal like "__proto__" or "constructor" on a plain object literal
  // would reach Object.prototype instead of becoming a real entry.
  const equations: Record<string, MathNode> = Object.create(null);
  for (const latex of latexes) {
    const tree = latexToMathTree(latex);
    if (tree) equations[latex] = tree;
  }
  return equations;
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
    const equations = collectEquations(docJson);
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
      ...(Object.keys(equations).length > 0 ? { equations } : {}),
    };
    const bytes = await exportDocx(input);
    const path = await save({
      defaultPath: `${sanitizeFilename(essay.titlePage.title)}.docx`,
      filters: [{ name: m.export_filter_docx(), extensions: ["docx"] }],
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

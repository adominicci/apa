import { type ImageKind, imageKind, readImageBytes } from "$lib/persist/assets";
import { latexToMathml } from "$lib/editor/mathml";

/**
 * The two asset maps `renderEssayHtml` consumes, built for a document that has
 * to stand on its own.
 *
 * `PrintPreview.svelte` hands it blob URLs, which are bound to the live window
 * and die with it. A PDF is rendered in a webview the user never sees and
 * outlives nothing, so its figures must travel inside the HTML as data URLs.
 *
 * Both maps degrade per asset, exactly as the preview does: one unreadable
 * figure or one malformed equation must not cost the student their export.
 */

const IMAGE_MIME: Record<ImageKind, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
};

export interface ExportAssets {
  imageUrls: Map<string, string>;
  mathml: Map<string, string>;
}

/** Collects every figure image path in the doc. */
export function collectFigureSrcs(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const n = node as {
    type?: string;
    attrs?: { src?: string };
    content?: unknown[];
  };
  if (n.type === "figureImage" && n.attrs?.src) out.add(n.attrs.src);
  for (const child of n.content ?? []) collectFigureSrcs(child, out);
}

/** Collects every block equation's LaTeX source in the doc. */
export function collectEquationLatex(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const n = node as {
    type?: string;
    attrs?: { latex?: string };
    content?: unknown[];
  };
  if (n.type === "apaEquation" && n.attrs?.latex) out.add(n.attrs.latex);
  for (const child of n.content ?? []) collectEquationLatex(child, out);
}

/**
 * Chunked rather than `String.fromCharCode(...bytes)`: spreading a multi-megabyte
 * figure blows the argument limit and throws, which would turn a large image
 * into a failed export instead of a large one.
 */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Builds both asset maps for a self-contained render of `docJson`. */
export async function buildExportAssets(
  docJson: unknown,
): Promise<ExportAssets> {
  const srcs = new Set<string>();
  collectFigureSrcs(docJson, srcs);
  const imageUrls = new Map<string, string>();
  for (const src of srcs) {
    try {
      const bytes = await readImageBytes(src);
      imageUrls.set(
        src,
        `data:${IMAGE_MIME[imageKind(src)]};base64,${toBase64(bytes)}`,
      );
    } catch {
      // Missing asset — skip; the figure renders without an image, matching
      // the preview rather than failing the whole export.
    }
  }

  const latexes = new Set<string>();
  collectEquationLatex(docJson, latexes);
  const mathml = new Map<string, string>();
  for (const latex of latexes) {
    try {
      mathml.set(latex, latexToMathml(latex));
    } catch {
      // Malformed LaTeX — skip; the equation renders with just its number.
    }
  }

  return { imageUrls, mathml };
}

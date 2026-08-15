import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { Reference } from "@tesina/engine";
import type { Essay } from "$lib/model/essay";
import { renderEssayCss, renderEssayHtml } from "$lib/preview/renderEssayHtml";
import { buildExportAssets } from "$lib/export/exportAssets";
import { paginateForPrint } from "$lib/export/paginateForPrint";
import { type ExportOutcome, sanitizeFilename } from "$lib/export/exportEssay";

/**
 * Renders the essay to PDF through the same Paged.js document the Print
 * preview shows, so what the student submits is what they proofread.
 *
 * The save dialog comes first, unlike the DOCX path. macOS needs the
 * destination before it will start a save-job print operation. The student
 * cannot tell the difference: one dialog, then done.
 */
export async function exportEssayToPdf(
  essay: Essay,
  docJson: unknown,
  references: Reference[],
): Promise<ExportOutcome> {
  try {
    const path = await save({
      defaultPath: `${sanitizeFilename(essay.titlePage.title)}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!path) return { status: "cancelled" };

    const { imageUrls, mathml } = await buildExportAssets(docJson);
    const contentHtml = renderEssayHtml(
      essay,
      docJson,
      references,
      imageUrls,
      mathml,
    );
    const css = renderEssayCss(essay.settings);
    const { html, pages } = await paginateForPrint(contentHtml, css);

    // The Rust side owns the hidden webview, the output cap, and the
    // temp-then-rename write. It knows nothing about APA. `pages` travels with
    // the document so the printed page count can be checked against what the
    // preview laid out rather than trusted.
    await invoke("export_pdf", {
      html,
      destination: path,
      expectedPages: pages,
    });
    return { status: "saved", path };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

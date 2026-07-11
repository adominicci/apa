import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { Reference } from "@tesina/engine";
import { exportDocx, type ExportInput } from "@tesina/docx-export";
import type { Essay } from "$lib/model/essay";

export type ExportOutcome =
  | { status: "saved"; path: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

function sanitizeFilename(title: string): string {
  const clean = title.replace(/[\\/:*?"<>|]/g, "").trim();
  return clean === "" ? "ensayo" : clean;
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

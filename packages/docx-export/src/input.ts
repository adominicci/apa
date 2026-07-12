import type { DocLocale, Reference } from "@tesina/engine";

/**
 * The exporter's own input contract. It structurally mirrors the app's
 * Essay pieces but deliberately does not import app code — the package
 * depends only on @tesina/engine and docx (plan §5.1).
 */
export type PaperVariant = "student" | "professional";
/** The six APA 7-accepted fonts; keep in sync with the app's FontChoice. */
export type FontChoice =
  | "times-new-roman-12"
  | "georgia-11"
  | "computer-modern-10"
  | "calibri-11"
  | "arial-11"
  | "lucida-sans-unicode-10";
export type PaperSize = "us-letter" | "a4";

export interface ExportSettings {
  documentLanguage: DocLocale;
  variant: PaperVariant;
  font: FontChoice;
  paperSize: PaperSize;
  runningHead?: string;
}

export interface ExportTitlePage {
  title: string;
  authors: string[];
  affiliations: string[];
  course?: string;
  instructor?: string;
  /** ISO date (YYYY-MM-DD); rendered per document locale. */
  dueDate?: string;
  authorNote?: string;
}

/** A figure image, pre-read and measured by the app layer (the exporter
 * never touches Tauri/the filesystem). Keyed by the figure node's `src`. */
export interface ExportImage {
  data: Uint8Array;
  type: "png" | "jpg" | "gif" | "bmp";
  /** Display size in pixels, already scaled to fit the content column. */
  width: number;
  height: number;
}

export interface ExportInput {
  /** ProseMirror doc JSON with Tesina's sectioned schema. */
  content: unknown;
  settings: ExportSettings;
  titlePage: ExportTitlePage;
  /** Already filtered by the caller (cited only, or cited + uncited). */
  references: Reference[];
  /** Figure image bytes keyed by node `src`; absent when there are none. */
  images?: Record<string, ExportImage>;
}

/** Minimal structural view of ProseMirror JSON the visitor walks. */
export interface PMJson {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type?: string }[];
  content?: PMJson[];
}

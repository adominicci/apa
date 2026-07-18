import type { DocLocale, Reference } from "@tesina/engine";

export type PaperVariant = "student" | "professional";
/** The six fonts APA 7 accepts (see model/fonts.ts for the descriptors). */
export type FontChoice =
  | "times-new-roman-12"
  | "georgia-11"
  | "computer-modern-10"
  | "calibri-11"
  | "arial-11"
  | "lucida-sans-unicode-10";
export type PaperSize = "us-letter" | "a4";

export interface EssaySettings {
  documentLanguage: DocLocale;
  variant: PaperVariant;
  font: FontChoice;
  paperSize: PaperSize;
  /** Professional variant only; uppercased at render time, ≤50 chars. */
  runningHead?: string;
  includeUncitedReferences: boolean;
  /** Target length for the outline's progress bar (default 2500). */
  wordGoal?: number;
}

/** Form data rendered only in preview/export — never lives in the PM doc. */
export interface TitlePage {
  title: string;
  authors: string[];
  affiliations: string[];
  course?: string;
  instructor?: string;
  /** ISO date; rendered per document locale. */
  dueDate?: string;
  authorNote?: string;
}

export interface Essay {
  schemaVersion: 2;
  id: string;
  createdAt: string;
  updatedAt: string;
  settings: EssaySettings;
  titlePage: TitlePage;
  /** ProseMirror doc JSON (sectioned schema). */
  content: unknown;
  /**
   * Denormalized copies of cited references so an essay file stays complete
   * if the library entry is deleted (plan §library/essay reconciliation).
   */
  referencesSnapshot: Reference[];
}

export interface EssaySummary {
  id: string;
  title: string;
  updatedAt: string;
  language: DocLocale;
  words: number;
  /** Title-page fields, shown on the library card when present. */
  course?: string;
  instructor?: string;
  /** First words of the body text, for the card's document preview. */
  preview: string;
}

/** Word count of a ProseMirror doc JSON (text nodes only, pure walk). */
export function countDocWords(docJson: unknown): number {
  let count = 0;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { text?: string; content?: unknown[] };
    if (typeof n.text === "string") {
      const words = n.text.trim().split(/\s+/).filter((w) => w !== "");
      count += words.length;
    }
    for (const child of n.content ?? []) walk(child);
  };
  walk(docJson);
  return count;
}

/** First `maxChars` of the doc's running text, for a card preview snippet. */
export function docPreview(docJson: unknown, maxChars = 180): string {
  const parts: string[] = [];
  let total = 0;
  const walk = (node: unknown): void => {
    if (total >= maxChars || !node || typeof node !== "object") return;
    const n = node as { text?: string; content?: unknown[] };
    if (typeof n.text === "string" && n.text.trim() !== "") {
      parts.push(n.text.trim());
      // Code points, matching the slice below — UTF-16 units would stop the
      // walk early on emoji-heavy text and drop words without an ellipsis.
      total += [...n.text].length;
    }
    for (const child of n.content ?? []) walk(child);
  };
  walk(docJson);
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  // Slice by code points so an emoji at the cut never splits into U+FFFD.
  const chars = [...text];
  return chars.length > maxChars
    ? `${chars.slice(0, maxChars).join("").trimEnd()}…`
    : text;
}

export function defaultSettings(language: DocLocale): EssaySettings {
  return {
    documentLanguage: language,
    variant: "student",
    font: "times-new-roman-12",
    paperSize: "us-letter",
    includeUncitedReferences: false,
  };
}

export function createEmptyEssay(
  language: DocLocale,
  now = new Date().toISOString(),
  variant: PaperVariant = "student",
): Essay {
  return {
    schemaVersion: 2,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    settings: { ...defaultSettings(language), variant },
    titlePage: {
      title: language === "es" ? "Ensayo sin título" : "Untitled essay",
      authors: [],
      affiliations: [],
    },
    content: {
      type: "doc",
      content: [{ type: "sectionBody", content: [{ type: "paragraph" }] }],
    },
    referencesSnapshot: [],
  };
}

export function summarize(essay: Essay): EssaySummary {
  return {
    id: essay.id,
    title: essay.titlePage.title,
    updatedAt: essay.updatedAt,
    language: essay.settings.documentLanguage,
    words: countDocWords(essay.content),
    ...(essay.titlePage.course ? { course: essay.titlePage.course } : {}),
    ...(essay.titlePage.instructor
      ? { instructor: essay.titlePage.instructor }
      : {}),
    preview: docPreview(essay.content),
  };
}

interface LegacyDraft {
  schemaVersion?: number;
  settings?: { documentLanguage?: DocLocale };
  content?: unknown;
}

/** Converts the pre-M2.5 single-draft file into a first-class essay. */
export function essayFromLegacyDraft(
  draft: LegacyDraft,
  now = new Date().toISOString(),
): Essay {
  const language = draft.settings?.documentLanguage ?? "es";
  const essay = createEmptyEssay(language, now);
  essay.titlePage.title = language === "es" ? "Borrador" : "Draft";
  if (draft.content !== undefined) essay.content = draft.content;
  return essay;
}

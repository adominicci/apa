import type { FontChoice } from "$lib/model/essay";

/**
 * The seven fonts APA 7 accepts, per
 * https://apastyle.apa.org/style-grammar-guidelines/paper-format/font — three
 * serif and four sans serif, each at its prescribed point size. This map is
 * the single source of truth for on-screen (editor) and preview rendering; the
 * DOCX side keeps its own parallel table in `@tesina/docx-export` (styles.ts)
 * because that package must not depend on the app. Keep the two in sync — any
 * font added here must be added there in the same commit.
 */
export interface FontDescriptor {
  /** Human label (a proper noun — never localized). */
  family: string;
  /** CSS font-family stack for editor + preview, with graceful fallbacks. */
  stack: string;
  /** APA-prescribed point size. */
  sizePt: number;
  /** Grouping for the picker. */
  kind: "serif" | "sans";
}

export const APA_FONTS: Record<FontChoice, FontDescriptor> = {
  "times-new-roman-12": {
    family: "Times New Roman",
    stack: `"Times New Roman", Times, Georgia, serif`,
    sizePt: 12,
    kind: "serif",
  },
  "georgia-11": {
    family: "Georgia",
    stack: `Georgia, "Times New Roman", serif`,
    sizePt: 11,
    kind: "serif",
  },
  "computer-modern-10": {
    family: "Computer Modern",
    stack:
      `"Latin Modern Roman", "CMU Serif", "Computer Modern", Georgia, serif`,
    sizePt: 10,
    kind: "serif",
  },
  "aptos-12": {
    family: "Aptos",
    stack: `Aptos, Calibri, "Segoe UI", "Helvetica Neue", sans-serif`,
    sizePt: 12,
    kind: "sans",
  },
  "calibri-11": {
    family: "Calibri",
    stack: `Calibri, "Segoe UI", "Helvetica Neue", sans-serif`,
    sizePt: 11,
    kind: "sans",
  },
  "arial-11": {
    family: "Arial",
    stack: `Arial, "Helvetica Neue", Helvetica, sans-serif`,
    sizePt: 11,
    kind: "sans",
  },
  "lucida-sans-unicode-10": {
    family: "Lucida Sans Unicode",
    stack: `"Lucida Sans Unicode", "Lucida Grande", "Lucida Sans", sans-serif`,
    sizePt: 10,
    kind: "sans",
  },
};

/** Picker order: serif family first, then sans serif. */
export const APA_FONT_ORDER: FontChoice[] = [
  "times-new-roman-12",
  "georgia-11",
  "computer-modern-10",
  "aptos-12",
  "calibri-11",
  "arial-11",
  "lucida-sans-unicode-10",
];

/** `font-family: …; font-size: …pt` — the value the preview CSS injects. */
export function fontFamilyCss(font: FontChoice): string {
  const f = APA_FONTS[font];
  return `${f.stack}; font-size: ${f.sizePt}pt`;
}

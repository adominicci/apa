import { NODE_NAMES } from "../nodeNames.ts";

/**
 * Live APA structure check: a pure function over the persisted ProseMirror
 * doc JSON (the same tree the preview and DOCX renderers read). Structural
 * rules only — presentation (spacing, fonts, alignment) is locked by the
 * editor and needs no checking. Advisory like the title-page warnings:
 * consumers surface issues but never block saving or export.
 */

interface PMJsonNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: PMJsonNode[];
}

export type ApaCheckRule =
  | "empty-paragraph"
  | "skipped-heading-level"
  | "empty-table-title"
  | "empty-figure-title";

export interface ApaCheckIssue {
  rule: ApaCheckRule;
  /** Child-index path from the doc root to the offending node. */
  path: number[];
  /** skipped-heading-level only: the level found and the deepest allowed. */
  found?: number;
  allowed?: number;
}

function hasText(node: PMJsonNode): boolean {
  if (node.text !== undefined && node.text.trim() !== "") return true;
  return (node.content ?? []).some(hasText);
}

/**
 * Blank means visually and semantically empty: no non-whitespace text and no
 * non-text inline (a citation atom or hard break counts as content, so the
 * one-click Remove can never delete something the user authored).
 */
function isBlankParagraph(node: PMJsonNode): boolean {
  return (node.content ?? []).every((child) =>
    child.type === "text" && (child.text ?? "").trim() === ""
  );
}

/**
 * Checks one doc (shape `sectionAbstract? sectionBody sectionAppendix*`).
 * Heading tracking restarts per section: a section's first heading should be
 * Level 1, and a heading may go at most one level deeper than the previous.
 */
export function checkApaDocument(doc: unknown): ApaCheckIssue[] {
  const issues: ApaCheckIssue[] = [];
  const sections = (doc as PMJsonNode | undefined)?.content ?? [];

  sections.forEach((section, si) => {
    const children = section.content ?? [];
    // The abstract's trailing keywords line is chrome-like, not body content;
    // it must not defeat the placeholder exemption below.
    const blockCount = children.filter((c) =>
      c.type !== NODE_NAMES.keywordsLine
    ).length;
    // Every section opens with a generated heading the user never authors —
    // the paper title for the body, the "Apéndice A" label for appendices —
    // and APA treats it as the de facto Level 1 heading, so an authored
    // first heading may legitimately be Level 1 or Level 2.
    let previousHeading = 1;

    // Scope note: only direct section children are scanned. Blank lines
    // nested inside lists, blockquotes, or table cells are out of scope for
    // this rule set (cells legitimately hold single empty paragraphs).
    children.forEach((child, ci) => {
      const path = [si, ci];

      if (child.type === "paragraph" && isBlankParagraph(child)) {
        // A section's schema requires at least one block, so the single
        // paragraph of an otherwise empty section is a placeholder, not a
        // stray blank line.
        if (blockCount > 1) issues.push({ rule: "empty-paragraph", path });
        return;
      }

      if (child.type === "heading") {
        const level = Number(child.attrs?.level ?? 1);
        const allowed = previousHeading + 1;
        if (level > allowed) {
          issues.push({
            rule: "skipped-heading-level",
            path,
            found: level,
            allowed,
          });
        }
        previousHeading = level;
        return;
      }

      // apaTable → tableTitle table tableNote; figure → figureTitle … — the
      // required title node is always the block's first child.
      if (
        child.type === NODE_NAMES.apaTable && !hasText(child.content?.[0] ?? {})
      ) {
        issues.push({ rule: "empty-table-title", path: [...path, 0] });
        return;
      }
      if (child.type === "figure" && !hasText(child.content?.[0] ?? {})) {
        issues.push({ rule: "empty-figure-title", path: [...path, 0] });
      }
    });
  });

  return issues;
}

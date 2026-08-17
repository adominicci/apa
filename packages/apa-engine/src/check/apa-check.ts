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
 * Checks one doc (shape `sectionAbstract? sectionBody sectionAppendix*`).
 * Heading tracking restarts per section: a section's first heading should be
 * Level 1, and a heading may go at most one level deeper than the previous.
 */
export function checkApaDocument(doc: unknown): ApaCheckIssue[] {
  const issues: ApaCheckIssue[] = [];
  const sections = (doc as PMJsonNode | undefined)?.content ?? [];

  sections.forEach((section, si) => {
    const children = section.content ?? [];
    let previousHeading = 0;

    children.forEach((child, ci) => {
      const path = [si, ci];

      if (child.type === "paragraph" && !hasText(child)) {
        // A section's schema requires at least one block, so the single
        // paragraph of an otherwise empty section is a placeholder, not a
        // stray blank line.
        if (children.length > 1) issues.push({ rule: "empty-paragraph", path });
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
      if (child.type === "apaTable" && !hasText(child.content?.[0] ?? {})) {
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

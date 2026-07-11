/**
 * Citation attrs are persisted verbatim as ProseMirror node attributes:
 * only reference ids plus presentation options, never rendered text.
 * Rendering is a pure function of (attrs, library, locale, context).
 */

export interface CitationLocator {
  type: "page" | "pages" | "paragraph" | "timestamp";
  /** "5", "5–7", "12", "1:30" — printed after the localized label. */
  value: string;
}

export interface CitationItem {
  refId: string;
  locator?: CitationLocator;
  /** Prepended verbatim plus a space: "see" / "véase". */
  prefix?: string;
  /** Appended after ", ": "for a review" / "para una revisión". */
  suffix?: string;
  /** Render only the year — for a narrative mention the user already wrote. */
  suppressAuthor?: boolean;
}

export interface CitationAttrs {
  /** Parenthetical multi-work citations are re-sorted in reference-list order. */
  items: CitationItem[];
  mode: "parenthetical" | "narrative";
}

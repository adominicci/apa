export const sectionKinds = [
  "abstract",
  "body",
  "appendix",
  "references",
] as const;

export type SectionKind = (typeof sectionKinds)[number];

export type MeasuredFragmentKind =
  | "line"
  | "heading"
  | "listItem"
  | "atomic"
  | "tableRow";

export type BreakCandidateKind = "line" | "block" | "tableRow";

/** A document position where a rendered sheet can begin without splitting data. */
export interface BreakCandidate {
  kind: BreakCandidateKind;
  pos: number;
  section: SectionKind;
}

/** Metadata shared by the line fragments in one logical paragraph or list item. */
export interface LineGroup {
  id: string;
  index: number;
  count: number;
  minLinesAtTop?: number;
  minLinesAtBottom?: number;
}

/** A table boundary that allows a page gap only before a complete row. */
export interface TableRowBoundary {
  tableId: string;
  columnCount: number;
}

/**
 * A browser-measured presentation fragment. It carries only derived layout
 * data and a ProseMirror position; it is never serialized into the essay.
 */
export interface MeasuredFragment {
  id: string;
  from: number;
  to: number;
  section: SectionKind;
  kind: MeasuredFragmentKind;
  height: number;
  breakBefore: BreakCandidate;
  forcePageStart?: boolean;
  keepWithNext?: boolean;
  lineGroup?: LineGroup;
  table?: TableRowBoundary;
}

export type PageStartKind = "section" | BreakCandidateKind;

export interface PageStart {
  pageIndex: number;
  pos: number;
  section: SectionKind;
  kind: PageStartKind;
}

export interface TableRowStart {
  pageIndex: number;
  pos: number;
  section: SectionKind;
  tableId: string;
  columnCount: number;
}

export type PaginationReason =
  | "authored-content"
  | "canonical-layout"
  | "document-locale"
  | "font"
  | "font-ready"
  | "asset"
  | "references";

export type PaginationOverflowKind = "atomic" | "tableRow";

/** A bounded, visible overflow treatment for one non-splittable fragment. */
export interface PaginationOverflow {
  fragmentId: string;
  pos: number;
  section: SectionKind;
  kind: PaginationOverflowKind;
}

export type SectionPageCounts = Record<SectionKind, number>;

export interface PaginationPageCount {
  authored: number;
  references: number;
  total: number;
  bySection: SectionPageCounts;
}

/** A plan that can be painted for the exact measurement epoch that produced it. */
export interface StablePaginationPlan {
  status: "stable";
  epoch: number;
  pageStarts: PageStart[];
  tableRowStarts: TableRowStart[];
  overflows: PaginationOverflow[];
  pageCount: PaginationPageCount;
}

/** A stale measurement must not replace the most recently requested plan. */
export interface StalePaginationPlan {
  status: "stale";
  epoch: number;
  latestEpoch: number;
}

export type PaginationPlan = StablePaginationPlan | StalePaginationPlan;

export interface PaginationEnvironment {
  reason: PaginationReason;
  onPageCount?: PageCountCallback;
}

export type PageCountCallback = (pageCount: PaginationPageCount) => void;

export interface PaginationInput {
  epoch: number;
  latestEpoch?: number;
  fragments: readonly MeasuredFragment[];
  referencePageCount?: number;
}

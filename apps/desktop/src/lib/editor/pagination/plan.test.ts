import { describe, expect, it } from "vitest";
import {
  LETTER_PAGE_MARGIN,
  LETTER_PRINTABLE_HEIGHT,
  visualPageGap,
} from "./geometry.ts";
import { planPagination } from "./plan.ts";
import type {
  MeasuredFragment,
  PaginationInput,
  StablePaginationPlan,
} from "./types.ts";

interface FragmentOptions {
  section?: MeasuredFragment["section"];
  kind?: MeasuredFragment["kind"];
  forcePageStart?: boolean;
  keepWithNext?: boolean;
  lineGroup?: MeasuredFragment["lineGroup"];
  table?: MeasuredFragment["table"];
}

function fragment(
  id: string,
  pos: number,
  height: number,
  options: FragmentOptions = {},
): MeasuredFragment {
  const kind = options.kind ?? "line";
  const breakKind = kind === "tableRow"
    ? "tableRow"
    : kind === "line" || kind === "listItem"
    ? "line"
    : "block";
  const section = options.section ?? "body";

  return {
    id,
    from: pos,
    to: pos + 1,
    section,
    kind,
    height,
    breakBefore: { kind: breakKind, pos, section },
    forcePageStart: options.forcePageStart,
    keepWithNext: options.keepWithNext,
    lineGroup: options.lineGroup,
    table: options.table,
  };
}

function stablePlan(input: PaginationInput): StablePaginationPlan {
  const result = planPagination(input);
  expect(result.status).toBe("stable");
  if (result.status !== "stable") throw new Error("Expected a stable plan");
  return result;
}

describe("planPagination", () => {
  it("keeps content that exactly fills the printable height on one page", () => {
    const plan = stablePlan({
      epoch: 1,
      fragments: [
        fragment("opening", 1, 432),
        fragment("closing", 10, 432),
      ],
    });

    expect(plan.pageStarts).toEqual([
      { pageIndex: 0, pos: 1, section: "body", kind: "section" },
    ]);
    expect(plan.pageCount).toEqual({
      authored: 1,
      references: 0,
      total: 1,
      bySection: { abstract: 0, body: 1, appendix: 0, references: 0 },
    });
  });

  it("starts a second page at the first overflowing line", () => {
    const plan = stablePlan({
      epoch: 2,
      fragments: [
        fragment("first", 1, 600),
        fragment("overflow", 10, 300),
      ],
    });

    expect(plan.pageStarts).toEqual([
      { pageIndex: 0, pos: 1, section: "body", kind: "section" },
      { pageIndex: 1, pos: 10, section: "body", kind: "line" },
    ]);
    expect(plan.pageCount.authored).toBe(2);
  });

  it("reports the exact derived gap needed to reach the next printable top", () => {
    const plan = stablePlan({
      epoch: 2,
      fragments: [
        fragment("first", 1, 600),
        fragment("overflow", 10, 300),
      ],
    });

    expect(plan.pageGaps).toEqual([{
      fragmentId: "overflow",
      pageIndex: 1,
      pos: 10,
      section: "body",
      kind: "line",
      height: LETTER_PRINTABLE_HEIGHT - 600 +
        2 * LETTER_PAGE_MARGIN + visualPageGap,
    }]);
  });

  it("reflows backward and removes an unnecessary trailing page after deletion", () => {
    const expanded = stablePlan({
      epoch: 3,
      fragments: [fragment("first", 1, 600), fragment("second", 10, 300)],
    });
    const reduced = stablePlan({
      epoch: 4,
      fragments: [fragment("first", 1, 600), fragment("second", 10, 264)],
    });

    expect(expanded.pageCount.authored).toBe(2);
    expect(reduced.pageStarts).toEqual([
      { pageIndex: 0, pos: 1, section: "body", kind: "section" },
    ]);
    expect(reduced.pageCount.authored).toBe(1);
  });

  it("starts every forced APA section on a new page", () => {
    const plan = stablePlan({
      epoch: 5,
      fragments: [
        fragment("abstract", 1, 200, {
          section: "abstract",
          forcePageStart: true,
        }),
        fragment("body", 20, 200, {
          forcePageStart: true,
        }),
        fragment("appendix", 40, 200, {
          section: "appendix",
          forcePageStart: true,
        }),
      ],
    });

    expect(plan.pageStarts).toEqual([
      { pageIndex: 0, pos: 1, section: "abstract", kind: "section" },
      { pageIndex: 1, pos: 20, section: "body", kind: "section" },
      { pageIndex: 2, pos: 40, section: "appendix", kind: "section" },
    ]);
    expect(plan.pageCount.bySection).toEqual({
      abstract: 1,
      body: 1,
      appendix: 1,
      references: 0,
    });
  });

  it("does not let a shared line-group id swallow a forced appendix start", () => {
    const plan = stablePlan({
      epoch: 5,
      fragments: [
        fragment("body-line", 1, 100, {
          lineGroup: { id: "shared", index: 0, count: 2 },
        }),
        fragment("appendix-line", 20, 100, {
          section: "appendix",
          forcePageStart: true,
          lineGroup: { id: "shared", index: 1, count: 2 },
        }),
      ],
    });

    expect(plan.pageStarts).toEqual([
      { pageIndex: 0, pos: 1, section: "body", kind: "section" },
      { pageIndex: 1, pos: 20, section: "appendix", kind: "section" },
    ]);
    expect(plan.pageCount.bySection).toEqual({
      abstract: 0,
      body: 1,
      appendix: 1,
      references: 0,
    });
  });

  it("does not join a paragraph line to a list item with the same group id", () => {
    const plan = stablePlan({
      epoch: 5,
      fragments: [
        fragment("preface", 1, 784),
        fragment("paragraph-line", 20, 80, {
          lineGroup: { id: "shared", index: 0, count: 3 },
        }),
        fragment("list-line-1", 30, 80, {
          kind: "listItem",
          lineGroup: { id: "shared", index: 1, count: 3 },
        }),
        fragment("list-line-2", 40, 80, {
          kind: "listItem",
          lineGroup: { id: "shared", index: 2, count: 3 },
        }),
      ],
    });

    expect(plan.pageStarts).toEqual([
      { pageIndex: 0, pos: 1, section: "body", kind: "section" },
      { pageIndex: 1, pos: 30, section: "body", kind: "line" },
    ]);
  });

  it("keeps at least two paragraph lines on both sides of a page boundary", () => {
    const plan = stablePlan({
      epoch: 6,
      fragments: [
        fragment("preface", 1, 704),
        fragment("paragraph-1", 20, 80, {
          lineGroup: { id: "paragraph", index: 0, count: 5 },
        }),
        fragment("paragraph-2", 30, 80, {
          lineGroup: { id: "paragraph", index: 1, count: 5 },
        }),
        fragment("paragraph-3", 40, 80, {
          lineGroup: { id: "paragraph", index: 2, count: 5 },
        }),
        fragment("paragraph-4", 50, 80, {
          lineGroup: { id: "paragraph", index: 3, count: 5 },
        }),
        fragment("paragraph-5", 60, 80, {
          lineGroup: { id: "paragraph", index: 4, count: 5 },
        }),
      ],
    });

    expect(plan.pageStarts).toEqual([
      { pageIndex: 0, pos: 1, section: "body", kind: "section" },
      { pageIndex: 1, pos: 40, section: "body", kind: "line" },
    ]);
  });

  it("moves a paragraph when only one line fits at the bottom of a page", () => {
    const plan = stablePlan({
      epoch: 6,
      fragments: [
        fragment("preface", 1, 784),
        fragment("paragraph-1", 20, 80, {
          lineGroup: { id: "paragraph", index: 0, count: 3 },
        }),
        fragment("paragraph-2", 30, 80, {
          lineGroup: { id: "paragraph", index: 1, count: 3 },
        }),
        fragment("paragraph-3", 40, 80, {
          lineGroup: { id: "paragraph", index: 2, count: 3 },
        }),
      ],
    });

    expect(plan.pageStarts).toEqual([
      { pageIndex: 0, pos: 1, section: "body", kind: "section" },
      { pageIndex: 1, pos: 20, section: "body", kind: "line" },
    ]);
  });

  it("moves an earlier line when one line would remain at the top of a page", () => {
    const plan = stablePlan({
      epoch: 6,
      fragments: [
        fragment("preface", 1, 544),
        fragment("paragraph-1", 20, 80, {
          lineGroup: { id: "paragraph", index: 0, count: 5 },
        }),
        fragment("paragraph-2", 30, 80, {
          lineGroup: { id: "paragraph", index: 1, count: 5 },
        }),
        fragment("paragraph-3", 40, 80, {
          lineGroup: { id: "paragraph", index: 2, count: 5 },
        }),
        fragment("paragraph-4", 50, 80, {
          lineGroup: { id: "paragraph", index: 3, count: 5 },
        }),
        fragment("paragraph-5", 60, 80, {
          lineGroup: { id: "paragraph", index: 4, count: 5 },
        }),
      ],
    });

    expect(plan.pageStarts).toEqual([
      { pageIndex: 0, pos: 1, section: "body", kind: "section" },
      { pageIndex: 1, pos: 50, section: "body", kind: "line" },
    ]);
  });

  it("honors a custom three-line minimum at the bottom of a page", () => {
    const plan = stablePlan({
      epoch: 6,
      fragments: [
        fragment("preface", 1, 704),
        fragment("paragraph-1", 20, 80, {
          lineGroup: {
            id: "paragraph",
            index: 0,
            count: 4,
            minLinesAtBottom: 3,
          },
        }),
        fragment("paragraph-2", 30, 80, {
          lineGroup: {
            id: "paragraph",
            index: 1,
            count: 4,
            minLinesAtBottom: 3,
          },
        }),
        fragment("paragraph-3", 40, 80, {
          lineGroup: {
            id: "paragraph",
            index: 2,
            count: 4,
            minLinesAtBottom: 3,
          },
        }),
        fragment("paragraph-4", 50, 80, {
          lineGroup: {
            id: "paragraph",
            index: 3,
            count: 4,
            minLinesAtBottom: 3,
          },
        }),
      ],
    });

    expect(plan.pageStarts).toEqual([
      { pageIndex: 0, pos: 1, section: "body", kind: "section" },
      { pageIndex: 1, pos: 20, section: "body", kind: "line" },
    ]);
  });

  it("honors a custom three-line minimum at the top of a page", () => {
    const plan = stablePlan({
      epoch: 6,
      fragments: [
        fragment("preface", 1, 544),
        fragment("paragraph-1", 20, 80, {
          lineGroup: {
            id: "paragraph",
            index: 0,
            count: 6,
            minLinesAtTop: 3,
          },
        }),
        fragment("paragraph-2", 30, 80, {
          lineGroup: {
            id: "paragraph",
            index: 1,
            count: 6,
            minLinesAtTop: 3,
          },
        }),
        fragment("paragraph-3", 40, 80, {
          lineGroup: {
            id: "paragraph",
            index: 2,
            count: 6,
            minLinesAtTop: 3,
          },
        }),
        fragment("paragraph-4", 50, 80, {
          lineGroup: {
            id: "paragraph",
            index: 3,
            count: 6,
            minLinesAtTop: 3,
          },
        }),
        fragment("paragraph-5", 60, 80, {
          lineGroup: {
            id: "paragraph",
            index: 4,
            count: 6,
            minLinesAtTop: 3,
          },
        }),
        fragment("paragraph-6", 70, 80, {
          lineGroup: {
            id: "paragraph",
            index: 5,
            count: 6,
            minLinesAtTop: 3,
          },
        }),
      ],
    });

    expect(plan.pageStarts).toEqual([
      { pageIndex: 0, pos: 1, section: "body", kind: "section" },
      { pageIndex: 1, pos: 50, section: "body", kind: "line" },
    ]);
  });

  it("moves a heading with its first following line", () => {
    const plan = stablePlan({
      epoch: 7,
      fragments: [
        fragment("preface", 1, 800),
        fragment("heading", 20, 40, {
          kind: "heading",
          keepWithNext: true,
        }),
        fragment("first-line", 30, 40),
      ],
    });

    expect(plan.pageStarts).toEqual([
      { pageIndex: 0, pos: 1, section: "body", kind: "section" },
      { pageIndex: 1, pos: 20, section: "body", kind: "block" },
    ]);
  });

  it("starts a list continuation at a line boundary without a second marker", () => {
    const plan = stablePlan({
      epoch: 8,
      fragments: [
        fragment("preface", 1, 704),
        fragment("item-1", 20, 80, {
          kind: "listItem",
          lineGroup: { id: "item", index: 0, count: 4 },
        }),
        fragment("item-2", 30, 80, {
          kind: "listItem",
          lineGroup: { id: "item", index: 1, count: 4 },
        }),
        fragment("item-3", 40, 80, {
          kind: "listItem",
          lineGroup: { id: "item", index: 2, count: 4 },
        }),
        fragment("item-4", 50, 80, {
          kind: "listItem",
          lineGroup: { id: "item", index: 3, count: 4 },
        }),
      ],
    });

    expect(plan.pageStarts).toEqual([
      { pageIndex: 0, pos: 1, section: "body", kind: "section" },
      { pageIndex: 1, pos: 40, section: "body", kind: "line" },
    ]);
  });

  it("moves an atomic block intact when it does not fit in the remaining space", () => {
    const plan = stablePlan({
      epoch: 9,
      fragments: [
        fragment("preface", 1, 700),
        fragment("figure", 20, 200, { kind: "atomic" }),
      ],
    });

    expect(plan.pageStarts).toEqual([
      { pageIndex: 0, pos: 1, section: "body", kind: "section" },
      { pageIndex: 1, pos: 20, section: "body", kind: "block" },
    ]);
    expect(plan.overflows).toEqual([]);
  });

  it("starts overflowing tables before a complete row", () => {
    const plan = stablePlan({
      epoch: 10,
      fragments: [
        fragment("preface", 1, 800),
        fragment("row-1", 20, 100, {
          kind: "tableRow",
          table: { tableId: "results", columnCount: 3 },
        }),
        fragment("row-2", 30, 100, {
          kind: "tableRow",
          table: { tableId: "results", columnCount: 3 },
        }),
      ],
    });

    expect(plan.pageStarts).toEqual([
      { pageIndex: 0, pos: 1, section: "body", kind: "section" },
      { pageIndex: 1, pos: 20, section: "body", kind: "tableRow" },
    ]);
    expect(plan.tableRowStarts).toEqual([
      {
        pageIndex: 1,
        pos: 20,
        section: "body",
        tableId: "results",
        columnCount: 3,
      },
    ]);
  });

  it("reserves a visual header when a table continues on a new page", () => {
    const repeatedHeader = {
      height: 30,
      cells: [
        { text: "Round", colSpan: 1 },
        { text: "Cards", colSpan: 2 },
      ],
    };
    const plan = stablePlan({
      epoch: 10,
      fragments: [
        fragment("preface", 1, 800),
        fragment("header-row", 20, 30, {
          kind: "tableRow",
          table: { tableId: "results", columnCount: 3 },
        }),
        fragment("row-1", 30, 60, {
          kind: "tableRow",
          table: {
            tableId: "results",
            columnCount: 3,
            repeatedHeader,
          },
        }),
      ],
    });

    expect(plan.pageGaps).toEqual([{
      fragmentId: "row-1",
      pageIndex: 1,
      pos: 30,
      section: "body",
      kind: "tableRow",
      height: LETTER_PRINTABLE_HEIGHT - 830 +
        2 * LETTER_PAGE_MARGIN + visualPageGap + repeatedHeader.height,
    }]);
    expect(plan.tableRowStarts[0]).toMatchObject({ repeatedHeader });
  });

  it("adds separately rendered reference pages to the authored page count", () => {
    const plan = stablePlan({
      epoch: 11,
      fragments: [fragment("body", 1, 864)],
      referencePageCount: 2,
    });

    expect(plan.pageCount).toEqual({
      authored: 1,
      references: 2,
      total: 3,
      bySection: { abstract: 0, body: 1, appendix: 0, references: 0 },
    });
  });

  it("accounts for all authored sections and derived reference pages", () => {
    const plan = stablePlan({
      epoch: 12,
      fragments: [
        fragment("abstract", 1, 864, {
          section: "abstract",
          forcePageStart: true,
        }),
        fragment("body", 20, 864, { forcePageStart: true }),
      ],
      referencePageCount: 3,
    });

    expect(plan.pageCount).toEqual({
      authored: 2,
      references: 3,
      total: 5,
      bySection: { abstract: 1, body: 1, appendix: 0, references: 0 },
    });
  });

  it("advances past zero-height fragments without creating a retry page", () => {
    const plan = stablePlan({
      epoch: 13,
      fragments: [
        fragment("empty-decoration", 1, 0),
        fragment("body", 10, 864),
      ],
    });

    expect(plan.pageStarts).toEqual([
      { pageIndex: 0, pos: 1, section: "body", kind: "section" },
    ]);
    expect(plan.overflows).toEqual([]);
  });

  it("uses fractional CSS pixels without rounding an overflowing line down", () => {
    const plan = stablePlan({
      epoch: 14,
      fragments: [
        fragment("first", 1, 500.25),
        fragment("second", 10, 363.75),
        fragment("overflow", 20, 0.25),
      ],
    });

    expect(plan.pageStarts).toEqual([
      { pageIndex: 0, pos: 1, section: "body", kind: "section" },
      { pageIndex: 1, pos: 20, section: "body", kind: "line" },
    ]);
  });

  it("reports one bounded overflow for an atomic element taller than a page", () => {
    const plan = stablePlan({
      epoch: 15,
      fragments: [fragment("figure", 1, 865, { kind: "atomic" })],
    });

    expect(plan.pageStarts).toHaveLength(1);
    expect(plan.overflows).toEqual([
      { fragmentId: "figure", pos: 1, section: "body", kind: "atomic" },
    ]);
  });

  it("subtracts bounded overflow before spacing the following page", () => {
    const plan = stablePlan({
      epoch: 15,
      fragments: [
        fragment("figure", 1, 900, { kind: "atomic" }),
        fragment("following", 20, 40),
      ],
    });

    expect(plan.pageGaps).toEqual([{
      fragmentId: "following",
      pageIndex: 1,
      pos: 20,
      section: "body",
      kind: "line",
      height: LETTER_PRINTABLE_HEIGHT - 900 +
        2 * LETTER_PAGE_MARGIN + visualPageGap,
    }]);
  });

  it("reports one bounded overflow for a table row taller than a page", () => {
    const plan = stablePlan({
      epoch: 16,
      fragments: [
        fragment("row", 1, 865, {
          kind: "tableRow",
          table: { tableId: "wide-results", columnCount: 4 },
        }),
      ],
    });

    expect(plan.pageStarts).toHaveLength(1);
    expect(plan.overflows).toEqual([
      { fragmentId: "row", pos: 1, section: "body", kind: "tableRow" },
    ]);
  });

  it("returns no authored pages for an empty document", () => {
    const plan = stablePlan({ epoch: 17, fragments: [] });

    expect(plan.pageStarts).toEqual([]);
    expect(plan.pageCount).toEqual({
      authored: 0,
      references: 0,
      total: 0,
      bySection: { abstract: 0, body: 0, appendix: 0, references: 0 },
    });
  });

  it("materializes explicit empty body and appendix sections as finite pages", () => {
    const plan = stablePlan({
      epoch: 17,
      fragments: [],
      emptySections: [
        { section: "body", pos: 1 },
        { section: "appendix", pos: 20 },
      ],
    });

    expect(plan.pageStarts).toEqual([
      { pageIndex: 0, pos: 1, section: "body", kind: "section" },
      { pageIndex: 1, pos: 20, section: "appendix", kind: "section" },
    ]);
    expect(plan.pageCount).toEqual({
      authored: 2,
      references: 0,
      total: 2,
      bySection: { abstract: 0, body: 1, appendix: 1, references: 0 },
    });
  });

  it("rejects a measurement epoch older than the latest request", () => {
    expect(
      planPagination({ epoch: 18, latestEpoch: 19, fragments: [] }),
    ).toEqual({ status: "stale", epoch: 18, latestEpoch: 19 });
  });

  it("returns byte-for-byte equivalent plans for repeated identical input", () => {
    const input: PaginationInput = {
      epoch: 20,
      fragments: [
        fragment("first", 1, 600),
        fragment("atomic", 10, 300, { kind: "atomic" }),
      ],
      referencePageCount: 1,
    };

    expect(planPagination(input)).toEqual(planPagination(input));
  });
});

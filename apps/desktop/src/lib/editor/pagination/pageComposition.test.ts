import { describe, expect, it } from "vitest";
import { composeDocumentPages } from "./pageComposition.ts";
import type { PageStart } from "./types.ts";

function start(
  pageIndex: number,
  pos: number,
  section: PageStart["section"],
): PageStart {
  return { pageIndex, pos, section, kind: "section" };
}

describe("composeDocumentPages", () => {
  it("numbers cover, authored pages, and one empty references page in order", () => {
    const composition = composeDocumentPages({
      authoredPageStarts: [start(0, 1, "body")],
      referencePageCount: 1,
    });

    expect(composition.pages).toEqual([
      { key: "cover", kind: "cover", pageNumber: 1 },
      {
        key: "authored:0:body:1",
        kind: "authored",
        pageNumber: 2,
        authoredPageIndex: 0,
        section: "body",
        pos: 1,
      },
      {
        key: "references:0",
        kind: "references",
        pageNumber: 3,
        referencePageIndex: 0,
      },
    ]);
    expect(composition.total).toBe(3);
  });

  it("keeps optional abstract and multi-page body before references", () => {
    const composition = composeDocumentPages({
      authoredPageStarts: [
        start(0, 1, "abstract"),
        start(1, 40, "body"),
        start(2, 120, "body"),
      ],
      referencePageCount: 2,
    });

    expect(composition.pages.map((page) => [page.kind, page.pageNumber]))
      .toEqual([
        ["cover", 1],
        ["authored", 2],
        ["authored", 3],
        ["authored", 4],
        ["references", 5],
        ["references", 6],
      ]);
  });

  it("inserts all reference pages before every appendix page", () => {
    const composition = composeDocumentPages({
      authoredPageStarts: [
        start(0, 1, "body"),
        start(1, 80, "body"),
        start(2, 160, "appendix"),
        start(3, 240, "appendix"),
        start(4, 320, "appendix"),
      ],
      referencePageCount: 2,
    });

    expect(
      composition.pages.map((page) =>
        page.kind === "authored"
          ? `${page.section}:${page.pageNumber}`
          : `${page.kind}:${page.pageNumber}`
      ),
    ).toEqual([
      "cover:1",
      "body:2",
      "body:3",
      "references:4",
      "references:5",
      "appendix:6",
      "appendix:7",
      "appendix:8",
    ]);
    expect(composition.referenceInsertion).toEqual({ pos: 160, side: -2 });
    expect(composition.total).toBe(8);
  });

  it("uses the document end when no appendix shares the reference boundary", () => {
    const composition = composeDocumentPages({
      authoredPageStarts: [start(0, 1, "body")],
      referencePageCount: 1,
      documentEnd: 99,
    });

    expect(composition.referenceInsertion).toEqual({ pos: 99, side: -2 });
  });

  it("normalizes reference counts without mutating authored starts", () => {
    const starts = [start(0, 1, "body"), start(1, 80, "appendix")];
    const before = JSON.stringify(starts);

    expect(
      composeDocumentPages({
        authoredPageStarts: starts,
        referencePageCount: Number.NaN,
      }).pages.map((page) => page.pageNumber),
    ).toEqual([1, 2, 3, 4]);
    expect(
      composeDocumentPages({
        authoredPageStarts: starts,
        referencePageCount: 2.9,
      }).total,
    ).toBe(5);
    expect(JSON.stringify(starts)).toBe(before);
  });
});

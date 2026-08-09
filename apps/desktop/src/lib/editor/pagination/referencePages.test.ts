import { describe, expect, it } from "vitest";
import { planReferencePages } from "./referencePages.ts";

describe("planReferencePages", () => {
  it("keeps an empty references section on one page", () => {
    expect(planReferencePages({ headingHeight: 48, entries: [] })).toEqual({
      pages: [{ index: 0, entryKeys: [], overflowKeys: [] }],
      pageCount: 1,
    });
  });

  it("fills the first page after its heading and continues whole entries", () => {
    expect(planReferencePages({
      headingHeight: 64,
      entries: [
        { key: "a", height: 400 },
        { key: "b", height: 400 },
        { key: "c", height: 200 },
      ],
    })).toEqual({
      pages: [
        { index: 0, entryKeys: ["a", "b"], overflowKeys: [] },
        { index: 1, entryKeys: ["c"], overflowKeys: [] },
      ],
      pageCount: 2,
    });
  });

  it("shrinks deterministically after an entry is removed", () => {
    const expanded = planReferencePages({
      headingHeight: 64,
      entries: [{ key: "a", height: 600 }, { key: "b", height: 600 }],
    });
    const reduced = planReferencePages({
      headingHeight: 64,
      entries: [{ key: "a", height: 600 }],
    });

    expect(expanded.pageCount).toBe(2);
    expect(reduced.pageCount).toBe(1);
  });

  it("moves the first entry past the heading when it fits a continuation page", () => {
    expect(planReferencePages({
      headingHeight: 64,
      entries: [{ key: "long", height: 820 }],
    })).toEqual({
      pages: [
        { index: 0, entryKeys: [], overflowKeys: [] },
        { index: 1, entryKeys: ["long"], overflowKeys: [] },
      ],
      pageCount: 2,
    });
  });

  it("places an oversize entry once and marks bounded overflow", () => {
    expect(planReferencePages({
      headingHeight: 64,
      entries: [{ key: "long", height: 1200 }],
    })).toEqual({
      pages: [
        { index: 0, entryKeys: [], overflowKeys: [] },
        { index: 1, entryKeys: ["long"], overflowKeys: ["long"] },
      ],
      pageCount: 2,
    });
  });

  it("places multiple oversize entries on separate bounded pages", () => {
    expect(planReferencePages({
      headingHeight: 64,
      entries: [
        { key: "long-a", height: 1200 },
        { key: "long-b", height: 1000 },
      ],
    })).toEqual({
      pages: [
        { index: 0, entryKeys: [], overflowKeys: [] },
        { index: 1, entryKeys: ["long-a"], overflowKeys: ["long-a"] },
        { index: 2, entryKeys: ["long-b"], overflowKeys: ["long-b"] },
      ],
      pageCount: 3,
    });
  });

  it("normalizes invalid measurements without mutating entries", () => {
    const entries = [
      { key: "zero", height: 0 },
      { key: "nan", height: Number.NaN },
    ];
    const before = entries.map(({ key, height }) => ({ key, height }));

    expect(
      planReferencePages({
        headingHeight: Number.NaN,
        entries,
      }).pageCount,
    ).toBe(1);
    expect(entries).toEqual(before);
  });
});

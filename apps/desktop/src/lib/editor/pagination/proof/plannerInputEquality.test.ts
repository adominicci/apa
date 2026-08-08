import { describe, expect, it } from "vitest";
import type { MeasuredFragment } from "../types.ts";
import { samePlannerFragmentInputs } from "./plannerInputEquality.ts";

const lineFragment: MeasuredFragment = {
  id: "line:1",
  from: 2,
  to: 12,
  section: "body",
  kind: "line",
  height: 32,
  breakBefore: { kind: "line", pos: 2, section: "body" },
  forcePageStart: true,
  keepWithNext: true,
  lineGroup: {
    id: "paragraph:1",
    index: 1,
    count: 3,
    minLinesAtTop: 2,
    minLinesAtBottom: 2,
  },
};

const tableFragment: MeasuredFragment = {
  id: "table:20:row:24",
  from: 24,
  to: 36,
  section: "body",
  kind: "tableRow",
  height: 44,
  breakBefore: { kind: "tableRow", pos: 24, section: "body" },
  table: {
    tableId: "table:20",
    columnCount: 3,
    repeatedHeader: {
      height: 44,
      cells: [
        { text: "Round", colSpan: 1 },
        { text: "Packets", colSpan: 2 },
      ],
    },
  },
};

const mutations: ReadonlyArray<
  readonly [string, MeasuredFragment, MeasuredFragment]
> = [
  ["id", lineFragment, { ...lineFragment, id: "line:changed" }],
  ["from", lineFragment, { ...lineFragment, from: 3 }],
  ["to", lineFragment, { ...lineFragment, to: 13 }],
  ["section", lineFragment, { ...lineFragment, section: "appendix" }],
  ["kind", lineFragment, { ...lineFragment, kind: "heading" }],
  ["subpixel height", lineFragment, { ...lineFragment, height: 32.25 }],
  [
    "break kind",
    lineFragment,
    {
      ...lineFragment,
      breakBefore: { ...lineFragment.breakBefore, kind: "block" },
    },
  ],
  [
    "break position",
    lineFragment,
    { ...lineFragment, breakBefore: { ...lineFragment.breakBefore, pos: 3 } },
  ],
  [
    "break section",
    lineFragment,
    {
      ...lineFragment,
      breakBefore: { ...lineFragment.breakBefore, section: "appendix" },
    },
  ],
  [
    "force-page-start",
    lineFragment,
    { ...lineFragment, forcePageStart: false },
  ],
  ["keep-with-next", lineFragment, { ...lineFragment, keepWithNext: false }],
  [
    "line-group id",
    lineFragment,
    {
      ...lineFragment,
      lineGroup: { ...lineFragment.lineGroup!, id: "paragraph:changed" },
    },
  ],
  [
    "line-group index",
    lineFragment,
    { ...lineFragment, lineGroup: { ...lineFragment.lineGroup!, index: 2 } },
  ],
  [
    "line-group count",
    lineFragment,
    { ...lineFragment, lineGroup: { ...lineFragment.lineGroup!, count: 4 } },
  ],
  [
    "line-group top minimum",
    lineFragment,
    {
      ...lineFragment,
      lineGroup: { ...lineFragment.lineGroup!, minLinesAtTop: 3 },
    },
  ],
  [
    "line-group bottom minimum",
    lineFragment,
    {
      ...lineFragment,
      lineGroup: { ...lineFragment.lineGroup!, minLinesAtBottom: 3 },
    },
  ],
  ["line-group presence", lineFragment, {
    ...lineFragment,
    lineGroup: undefined,
  }],
  [
    "table id",
    tableFragment,
    {
      ...tableFragment,
      table: { ...tableFragment.table!, tableId: "table:changed" },
    },
  ],
  [
    "table column count",
    tableFragment,
    {
      ...tableFragment,
      table: { ...tableFragment.table!, columnCount: 4 },
    },
  ],
  [
    "repeated-header height",
    tableFragment,
    {
      ...tableFragment,
      table: {
        ...tableFragment.table!,
        repeatedHeader: {
          ...tableFragment.table!.repeatedHeader!,
          height: 44.25,
        },
      },
    },
  ],
  [
    "repeated-header text",
    tableFragment,
    {
      ...tableFragment,
      table: {
        ...tableFragment.table!,
        repeatedHeader: {
          ...tableFragment.table!.repeatedHeader!,
          cells: [
            { text: "Changed", colSpan: 1 },
            { text: "Packets", colSpan: 2 },
          ],
        },
      },
    },
  ],
  [
    "repeated-header colspan",
    tableFragment,
    {
      ...tableFragment,
      table: {
        ...tableFragment.table!,
        repeatedHeader: {
          ...tableFragment.table!.repeatedHeader!,
          cells: [
            { text: "Round", colSpan: 2 },
            { text: "Packets", colSpan: 1 },
          ],
        },
      },
    },
  ],
  [
    "repeated-header presence",
    tableFragment,
    {
      ...tableFragment,
      table: { ...tableFragment.table!, repeatedHeader: undefined },
    },
  ],
  ["table presence", tableFragment, { ...tableFragment, table: undefined }],
];

describe("native planner-input equality", () => {
  it("accepts a complete value-equivalent copy", () => {
    expect(samePlannerFragmentInputs(
      [lineFragment, tableFragment],
      [structuredClone(lineFragment), structuredClone(tableFragment)],
    )).toBe(true);
  });

  it.each(mutations)("rejects a change to %s", (_field, left, right) => {
    expect(samePlannerFragmentInputs([left], [right])).toBe(false);
  });
});

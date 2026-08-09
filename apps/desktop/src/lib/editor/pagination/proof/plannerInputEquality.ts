import type { MeasuredFragment } from "../types.ts";

/** Test-host contract: equivalent measurements must feed the planner equally. */
export function samePlannerFragmentInputs(
  left: readonly MeasuredFragment[],
  right: readonly MeasuredFragment[],
): boolean {
  return left.length === right.length && left.every((fragment, index) => {
    const other = right[index];
    return other !== undefined && sameFragment(fragment, other);
  });
}

function sameOptional<T>(
  left: T | undefined,
  right: T | undefined,
  compare: (left: T, right: T) => boolean,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return compare(left, right);
}

function sameHeight(left: number, right: number): boolean {
  return left === right;
}

function sameFragment(
  left: MeasuredFragment,
  right: MeasuredFragment,
): boolean {
  return left.id === right.id && left.from === right.from &&
    left.to === right.to && left.section === right.section &&
    left.kind === right.kind && sameHeight(left.height, right.height) &&
    left.breakBefore.kind === right.breakBefore.kind &&
    left.breakBefore.pos === right.breakBefore.pos &&
    left.breakBefore.section === right.breakBefore.section &&
    left.forcePageStart === right.forcePageStart &&
    left.keepWithNext === right.keepWithNext &&
    sameOptional(
      left.lineGroup,
      right.lineGroup,
      (lineGroup, other) =>
        lineGroup.id === other.id && lineGroup.index === other.index &&
        lineGroup.count === other.count &&
        lineGroup.minLinesAtTop === other.minLinesAtTop &&
        lineGroup.minLinesAtBottom === other.minLinesAtBottom,
    ) &&
    sameOptional(
      left.table,
      right.table,
      (table, other) =>
        table.tableId === other.tableId &&
        table.columnCount === other.columnCount &&
        sameOptional(
          table.repeatedHeader,
          other.repeatedHeader,
          (header, otherHeader) =>
            sameHeight(header.height, otherHeader.height) &&
            header.cells.length === otherHeader.cells.length &&
            header.cells.every((cell, index) => {
              const otherCell = otherHeader.cells[index];
              return cell.text === otherCell?.text &&
                cell.colSpan === otherCell.colSpan;
            }),
        ),
    );
}

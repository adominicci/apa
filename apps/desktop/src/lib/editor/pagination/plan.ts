import { LETTER_PRINTABLE_HEIGHT } from "./geometry.ts";
import type {
  BreakCandidate,
  MeasuredFragment,
  PageStart,
  PageStartKind,
  PaginationInput,
  PaginationOverflow,
  PaginationPlan,
  SectionPageCounts,
  TableRowStart,
} from "./types.ts";

const DEFAULT_MIN_LINES = 2;

function measuredHeight(height: number): number {
  return Number.isFinite(height) && height > 0 ? height : 0;
}

function pageStartKind(candidate: BreakCandidate): PageStartKind {
  return candidate.kind;
}

function emptySectionPageCounts(): SectionPageCounts {
  return { abstract: 0, body: 0, appendix: 0, references: 0 };
}

function referencePageCount(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value ?? 0));
}

function sameLineGroup(
  first: MeasuredFragment,
  next: MeasuredFragment | undefined,
): boolean {
  return Boolean(
    first.lineGroup &&
      next?.lineGroup &&
      first.lineGroup.id === next.lineGroup.id,
  );
}

/**
 * Plans derived sheet starts from measured presentation fragments. It has no
 * DOM, editor, or persistence dependency, so every call is deterministic.
 */
export function planPagination(input: PaginationInput): PaginationPlan {
  if (
    input.latestEpoch !== undefined &&
    input.latestEpoch > input.epoch
  ) {
    return {
      status: "stale",
      epoch: input.epoch,
      latestEpoch: input.latestEpoch,
    };
  }

  const stablePageStarts: PageStart[] = [];
  const tableRowStarts: TableRowStart[] = [];
  const overflows: PaginationOverflow[] = [];
  let usedHeight = 0;
  let currentSection: MeasuredFragment["section"] | undefined;

  function startPage(
    fragment: MeasuredFragment,
    kind: PageStartKind,
  ): void {
    const pageIndex = stablePageStarts.length;
    stablePageStarts.push({
      pageIndex,
      pos: fragment.breakBefore.pos,
      section: fragment.section,
      kind,
    });
    if (pageIndex > 0 && kind === "tableRow" && fragment.table) {
      tableRowStarts.push({
        pageIndex,
        pos: fragment.breakBefore.pos,
        section: fragment.section,
        tableId: fragment.table.tableId,
        columnCount: fragment.table.columnCount,
      });
    }
    currentSection = fragment.section;
    usedHeight = 0;
  }

  function ensureSectionStart(fragment: MeasuredFragment): void {
    if (
      stablePageStarts.length === 0 ||
      fragment.forcePageStart ||
      fragment.section !== currentSection
    ) {
      startPage(fragment, "section");
    }
  }

  let index = 0;
  while (index < input.fragments.length) {
    const fragment = input.fragments[index]!;
    ensureSectionStart(fragment);

    if (fragment.lineGroup) {
      let groupEnd = index + 1;
      while (sameLineGroup(fragment, input.fragments[groupEnd])) groupEnd += 1;

      while (index < groupEnd) {
        const groupFragment = input.fragments[index]!;
        const availableHeight = LETTER_PRINTABLE_HEIGHT - usedHeight;
        let fitCount = 0;
        let fittedHeight = 0;

        for (let cursor = index; cursor < groupEnd; cursor += 1) {
          const height = measuredHeight(input.fragments[cursor]!.height);
          if (fittedHeight + height > availableHeight) break;
          fittedHeight += height;
          fitCount += 1;
        }

        if (fitCount === 0) {
          if (usedHeight > 0) {
            startPage(groupFragment, pageStartKind(groupFragment.breakBefore));
            continue;
          }

          // A malformed or extraordinarily tall text line still advances once.
          usedHeight += measuredHeight(groupFragment.height);
          index += 1;
          continue;
        }

        const remainingLines = groupEnd - index;
        const minAtTop = Math.max(
          1,
          fragment.lineGroup.minLinesAtTop ?? DEFAULT_MIN_LINES,
        );
        const minAtBottom = Math.max(
          1,
          fragment.lineGroup.minLinesAtBottom ?? DEFAULT_MIN_LINES,
        );
        let linesToPlace = Math.min(fitCount, remainingLines);

        if (remainingLines > linesToPlace) {
          if (linesToPlace < minAtBottom && usedHeight > 0) {
            startPage(groupFragment, pageStartKind(groupFragment.breakBefore));
            continue;
          }

          const followingLines = remainingLines - linesToPlace;
          if (followingLines < minAtTop) {
            const adjustedLines = remainingLines - minAtTop;
            if (adjustedLines >= minAtBottom) {
              linesToPlace = adjustedLines;
            } else if (usedHeight > 0) {
              startPage(
                groupFragment,
                pageStartKind(groupFragment.breakBefore),
              );
              continue;
            }
          }
        }

        for (let cursor = 0; cursor < linesToPlace; cursor += 1) {
          usedHeight += measuredHeight(input.fragments[index + cursor]!.height);
        }
        index += linesToPlace;

        if (index < groupEnd) {
          const nextLine = input.fragments[index]!;
          startPage(nextLine, pageStartKind(nextLine.breakBefore));
        }
      }
      continue;
    }

    const height = measuredHeight(fragment.height);
    const availableHeight = LETTER_PRINTABLE_HEIGHT - usedHeight;
    const followingFragment = input.fragments[index + 1];
    const pairedHeadingHeight = fragment.keepWithNext && followingFragment
      ? height + measuredHeight(followingFragment.height)
      : height;

    if (
      usedHeight > 0 &&
      (height > availableHeight || pairedHeadingHeight > availableHeight)
    ) {
      startPage(fragment, pageStartKind(fragment.breakBefore));
    }

    if (
      height > LETTER_PRINTABLE_HEIGHT &&
      (fragment.kind === "atomic" || fragment.kind === "tableRow")
    ) {
      overflows.push({
        fragmentId: fragment.id,
        pos: fragment.breakBefore.pos,
        section: fragment.section,
        kind: fragment.kind,
      });
    }

    usedHeight += height;
    index += 1;
  }

  const bySection = emptySectionPageCounts();
  for (const start of stablePageStarts) bySection[start.section] += 1;
  const authored = stablePageStarts.length;
  const references = referencePageCount(input.referencePageCount);

  return {
    status: "stable",
    epoch: input.epoch,
    pageStarts: stablePageStarts,
    tableRowStarts,
    overflows,
    pageCount: {
      authored,
      references,
      total: authored + references,
      bySection,
    },
  };
}

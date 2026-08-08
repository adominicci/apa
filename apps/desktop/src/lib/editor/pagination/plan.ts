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

function isLineFragment(fragment: MeasuredFragment): boolean {
  return fragment.kind === "line" || fragment.kind === "listItem";
}

function sameLineGroup(
  first: MeasuredFragment,
  next: MeasuredFragment | undefined,
): boolean {
  return Boolean(
    first.lineGroup &&
      next?.lineGroup &&
      isLineFragment(first) &&
      isLineFragment(next) &&
      first.lineGroup.id === next.lineGroup.id &&
      first.section === next.section &&
      first.kind === next.kind &&
      !first.forcePageStart &&
      !next.forcePageStart,
  );
}

function fragmentsFor(input: PaginationInput): MeasuredFragment[] {
  const entries = [
    ...input.fragments.map((fragment, index) => ({ fragment, index })),
    ...(input.emptySections ?? []).map((emptySection, index) => ({
      fragment: {
        id:
          `empty-section:${emptySection.section}:${emptySection.pos}:${index}`,
        from: emptySection.pos,
        to: emptySection.pos,
        section: emptySection.section,
        kind: "line" as const,
        height: 0,
        breakBefore: {
          kind: "block" as const,
          pos: emptySection.pos,
          section: emptySection.section,
        },
        forcePageStart: true,
      },
      index: input.fragments.length + index,
    })),
  ];

  return entries.sort((left, right) => {
    const position = left.fragment.breakBefore.pos -
      right.fragment.breakBefore.pos;
    return position || left.index - right.index;
  }).map(({ fragment }) => fragment);
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
  const fragments = fragmentsFor(input);
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
  while (index < fragments.length) {
    const fragment = fragments[index]!;
    ensureSectionStart(fragment);

    if (isLineFragment(fragment) && fragment.lineGroup) {
      let groupEnd = index + 1;
      while (sameLineGroup(fragment, fragments[groupEnd])) groupEnd += 1;

      while (index < groupEnd) {
        const groupFragment = fragments[index]!;
        const availableHeight = LETTER_PRINTABLE_HEIGHT - usedHeight;
        let fitCount = 0;
        let fittedHeight = 0;

        for (let cursor = index; cursor < groupEnd; cursor += 1) {
          const height = measuredHeight(fragments[cursor]!.height);
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
          usedHeight += measuredHeight(fragments[index + cursor]!.height);
        }
        index += linesToPlace;

        if (index < groupEnd) {
          const nextLine = fragments[index]!;
          startPage(nextLine, pageStartKind(nextLine.breakBefore));
        }
      }
      continue;
    }

    const height = measuredHeight(fragment.height);
    const availableHeight = LETTER_PRINTABLE_HEIGHT - usedHeight;
    const followingFragment = fragments[index + 1];
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

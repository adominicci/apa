export interface InlineFlowRect {
  top: number;
  width: number;
  height: number;
}

export interface PositiveAreaRect extends InlineFlowRect {
  right: number;
  bottom: number;
  left: number;
}

export interface AuthoredTextGapIntersection {
  textRectIndex: number;
  gapRectIndex: number;
  overlapWidth: number;
  overlapHeight: number;
}

/** The visible portion of a painted marker after the paper root clips it. */
export function clipPaintedCanvasRectToRoot(
  marker: PositiveAreaRect,
  root: PositiveAreaRect,
): PositiveAreaRect | null {
  const top = Math.max(marker.top, root.top);
  const right = Math.min(marker.right, root.right);
  const bottom = Math.min(marker.bottom, root.bottom);
  const left = Math.max(marker.left, root.left);
  const width = right - left;
  const height = bottom - top;
  return width > 0 && height > 0
    ? { top, right, bottom, left, width, height }
    : null;
}

const LINE_TOP_TOLERANCE = 1;

/** Exact line-box advance represented by visible inline fragment rectangles. */
export function inlineFlowVisualHeight(
  rects: readonly InlineFlowRect[],
  lineHeight: number,
): number {
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return 0;
  const lineTops = rects
    .filter((rect) =>
      rect.width > 0 && rect.height > 0 && Number.isFinite(rect.top)
    )
    .map((rect) => rect.top)
    .sort((left, right) => left - right)
    .filter((top, index, tops) =>
      index === 0 || Math.abs(top - tops[index - 1]!) > LINE_TOP_TOLERANCE
    );
  return lineTops.length * lineHeight;
}

/** Positive-area overlap only; touching edges and empty engine boxes are safe. */
export function authoredTextPaintedCanvasIntersections(
  textRects: readonly PositiveAreaRect[],
  paintedCanvasRects: readonly PositiveAreaRect[],
): AuthoredTextGapIntersection[] {
  return textRects.flatMap((textRect, textRectIndex) => {
    if (textRect.width <= 0 || textRect.height <= 0) return [];
    return paintedCanvasRects.flatMap((gapRect, gapRectIndex) => {
      if (gapRect.width <= 0 || gapRect.height <= 0) return [];
      const overlapWidth = Math.min(textRect.right, gapRect.right) -
        Math.max(textRect.left, gapRect.left);
      const overlapHeight = Math.min(textRect.bottom, gapRect.bottom) -
        Math.max(textRect.top, gapRect.top);
      return overlapWidth > 0 && overlapHeight > 0
        ? [{
          textRectIndex,
          gapRectIndex,
          overlapWidth,
          overlapHeight,
        }]
        : [];
    });
  });
}

/** @deprecated Use authoredTextPaintedCanvasIntersections for painted bands. */
export const authoredTextGapIntersections =
  authoredTextPaintedCanvasIntersections;

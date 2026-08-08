export interface InlineFlowRect {
  top: number;
  width: number;
  height: number;
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

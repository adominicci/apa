export type TextWidthMeasure = (
  text: string,
  style: CSSStyleDeclaration,
) => number | undefined;

function pixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function canvasTextWidth(
  text: string,
  style: CSSStyleDeclaration,
): number | undefined {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return undefined;
  context.font = style.font;
  const base = context.measureText(text).width;
  const spacing = pixels(style.letterSpacing);
  return base + Math.max(0, text.length - 1) * spacing;
}

/** Maps a pointer to the nearest UTF-16 caret offset in a single-line input. */
export function titleOffsetAtPointer(
  input: HTMLInputElement,
  point: Pick<MouseEvent, "clientX" | "clientY">,
  measureText: TextWidthMeasure = canvasTextWidth,
): number | undefined {
  const rect = input.getBoundingClientRect();
  if (
    point.clientX < rect.left || point.clientX >= rect.right ||
    point.clientY < rect.top || point.clientY >= rect.bottom
  ) return undefined;

  const style = getComputedStyle(input);
  const layoutWidth = input.offsetWidth > 0 ? input.offsetWidth : rect.width;
  const scaleX = input.offsetWidth > 0 ? rect.width / input.offsetWidth : 1;
  if (!Number.isFinite(scaleX) || scaleX <= 0) return undefined;
  const leftInset = pixels(style.borderLeftWidth) + pixels(style.paddingLeft);
  const rightInset = pixels(style.borderRightWidth) +
    pixels(style.paddingRight);
  const contentWidth = Math.max(0, layoutWidth - leftInset - rightInset);
  const textWidth = measureText(input.value, style);
  if (textWidth === undefined) return undefined;

  const direction = style.direction === "rtl" ? "rtl" : "ltr";
  const alignment = style.textAlign === "center"
    ? "center"
    : style.textAlign === "right" ||
        (style.textAlign === "end" && direction === "ltr") ||
        (style.textAlign === "start" && direction === "rtl")
    ? "right"
    : "left";
  const unused = Math.max(0, contentWidth - textWidth);
  const alignedOffset = alignment === "center"
    ? unused / 2
    : alignment === "right"
    ? unused
    : 0;
  const target = (point.clientX - rect.left) / scaleX - leftInset +
    input.scrollLeft - alignedOffset;
  if (target <= 0) return 0;
  if (target >= textWidth) return input.value.length;

  let low = 0;
  let high = input.value.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const width = measureText(input.value.slice(0, middle), style);
    if (width === undefined) return undefined;
    if (width < target) low = middle + 1;
    else high = middle;
  }
  const after = measureText(input.value.slice(0, low), style);
  const before = measureText(input.value.slice(0, Math.max(0, low - 1)), style);
  if (after === undefined || before === undefined) return undefined;
  return target - before <= after - target ? Math.max(0, low - 1) : low;
}

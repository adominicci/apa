export const LETTER_PAGE_WIDTH = 816;
export const LETTER_PAGE_HEIGHT = 1056;
export const LETTER_PAGE_MARGIN = 96;
export const LETTER_TEXT_WIDTH = 624;
export const LETTER_PRINTABLE_HEIGHT = 864;

/**
 * Fixed layout inputs for every pagination pass. Canvas fitting may scale the
 * rendered sheets, but it must never change these measurements.
 */
export const canonicalPageGeometry = Object.freeze({
  width: LETTER_PAGE_WIDTH,
  height: LETTER_PAGE_HEIGHT,
  margin: LETTER_PAGE_MARGIN,
  textWidth: LETTER_TEXT_WIDTH,
  printableHeight: LETTER_PRINTABLE_HEIGHT,
});

/** Space painted between sheets; it is intentionally not printable content. */
export const visualPageGap = 28;

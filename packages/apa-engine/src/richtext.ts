/**
 * A run of text carrying the only character formatting an APA reference
 * entry can contain: italics (journal names, book titles, volume numbers).
 * The preview renders runs as HTML (`<em>`) and the DOCX exporter as
 * `TextRun({ italics })`, so formatting survives both output paths.
 */
export interface RichRun {
  text: string;
  italic?: boolean;
}

/** Concatenate adjacent runs that share the same formatting and drop empties. */
export function mergeRuns(runs: readonly RichRun[]): RichRun[] {
  const out: RichRun[] = [];
  for (const run of runs) {
    if (run.text === "") continue;
    const prev = out[out.length - 1];
    if (prev && Boolean(prev.italic) === Boolean(run.italic)) {
      prev.text += run.text;
    } else {
      out.push({ text: run.text, ...(run.italic ? { italic: true } : {}) });
    }
  }
  return out;
}

/** Flatten runs to plain text (sorting keys, search, word counts). */
export function plainText(runs: readonly RichRun[]): string {
  return runs.map((r) => r.text).join("");
}

/**
 * Parse the golden-fixture markup format into runs: asterisks delimit
 * italic spans, e.g. `"García, J. (2020). *El gran libro*. Planeta."`.
 * Asterisks never appear literally in APA reference entries, so no
 * escaping is needed.
 */
export function runsFromMarkup(markup: string): RichRun[] {
  const runs: RichRun[] = [];
  let italic = false;
  for (const segment of markup.split("*")) {
    if (segment !== "") {
      runs.push(italic ? { text: segment, italic: true } : { text: segment });
    }
    italic = !italic;
  }
  return mergeRuns(runs);
}

/** Inverse of {@link runsFromMarkup}; used to print readable test diffs. */
export function runsToMarkup(runs: readonly RichRun[]): string {
  return mergeRuns(runs)
    .map((r) => (r.italic ? `*${r.text}*` : r.text))
    .join("");
}

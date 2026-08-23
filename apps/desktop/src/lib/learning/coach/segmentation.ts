import type { DocLocale } from "@tesina/engine";

export interface TextRange {
  from: number;
  to: number;
}

export interface CoachToken extends TextRange {
  text: string;
  normalized: string;
}

const TOKEN = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;

export function tokens(text: string, language: DocLocale): CoachToken[] {
  return [...text.matchAll(TOKEN)].map((match) => ({
    text: match[0],
    normalized: match[0].toLocaleLowerCase(language),
    from: match.index,
    to: match.index + match[0].length,
  }));
}

function trimmedRange(
  text: string,
  from: number,
  to: number,
): TextRange | null {
  while (from < to && /\s/u.test(text[from]!)) from += 1;
  while (to > from && /\s/u.test(text[to - 1]!)) to -= 1;
  return from < to ? { from, to } : null;
}

export function sentences(text: string): TextRange[] {
  const result: TextRange[] = [];
  let start = 0;
  for (const match of text.matchAll(/[.!?]+(?:["”’']+)?(?=\s|$)/gu)) {
    const range = trimmedRange(text, start, match.index + match[0].length);
    if (range) result.push(range);
    start = match.index + match[0].length;
  }
  const tail = trimmedRange(text, start, text.length);
  if (tail) result.push(tail);
  return result;
}

export function paragraphs(text: string): TextRange[] {
  const result: TextRange[] = [];
  let start = 0;
  for (const match of text.matchAll(/\n\s*\n/gu)) {
    const range = trimmedRange(text, start, match.index);
    if (range) result.push(range);
    start = match.index + match[0].length;
  }
  const tail = trimmedRange(text, start, text.length);
  if (tail) result.push(tail);
  return result;
}

import type { SpellingIssue } from "./types.ts";
import { MAX_SPELLING_TEXT_LENGTH } from "./types.ts";

export type SpellingIssueSource = "paper-title" | "body";

export interface SourceMapUnit {
  source: SpellingIssueSource;
  pos: number;
}

export interface SpellingChunk {
  id: string;
  source: SpellingIssueSource;
  documentStart: number;
  text: string;
  map: Array<SourceMapUnit | null>;
}

export interface MappedSpellingIssue extends SpellingIssue {
  source: SpellingIssueSource;
}

interface JsonNode {
  type?: string;
  text?: string;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  content?: unknown[];
}

const ELIGIBLE_TEXTBLOCKS = new Set([
  "paragraph",
  "heading",
  "tableTitle",
  "tableNote",
  "figureTitle",
  "figureNote",
  "keywordsLine",
]);
const EXCLUDED_INLINE = new Set([
  "citation",
  "apaEquation",
  "equation",
  "figureImage",
]);
const URL_TOKEN = /^(?:https?:\/\/|www\.)/iu;
const IDENTIFIER_TOKEN =
  /^(?:[\p{L}\p{N}]*\w_\w[\p{L}\p{N}_]*|(?=[A-Za-z0-9.:-]*[A-Za-z])(?=[A-Za-z0-9.:-]*\d)[A-Za-z0-9.:-]+)$/u;

function jsonNode(value: unknown): JsonNode {
  return value !== null && typeof value === "object" ? value as JsonNode : {};
}

function nodeSize(value: unknown): number {
  const node = jsonNode(value);
  if (typeof node.text === "string") return node.text.length;
  if (!Array.isArray(node.content)) return 1;
  const contentSize = node.content.reduce<number>(
    (sum, child) => sum + nodeSize(child),
    0,
  );
  return node.type === "doc" ? contentSize : contentSize + 2;
}

function maskTokens(
  text: string,
  map: Array<SourceMapUnit | null>,
): { text: string; map: Array<SourceMapUnit | null> } {
  const chars = text.split("");
  for (const match of text.matchAll(/\S+/gu)) {
    const token = match[0];
    const from = match.index;
    if (!URL_TOKEN.test(token) && !IDENTIFIER_TOKEN.test(token)) continue;
    for (let index = from; index < from + token.length; index += 1) {
      chars[index] = " ";
      map[index] = null;
    }
  }
  return { text: chars.join(""), map };
}

function collectInline(
  value: unknown,
  position: number,
): { text: string; map: Array<SourceMapUnit | null> } {
  const node = jsonNode(value);
  if (typeof node.text === "string") {
    return {
      text: node.text,
      map: Array.from(
        { length: node.text.length },
        (_, index) => ({ source: "body" as const, pos: position + index }),
      ),
    };
  }
  if (EXCLUDED_INLINE.has(node.type ?? "") || !Array.isArray(node.content)) {
    return { text: " ", map: [null] };
  }
  let text = "";
  const map: Array<SourceMapUnit | null> = [];
  let offset = 0;
  for (const child of node.content) {
    const part = collectInline(child, position + offset);
    text += part.text;
    map.push(...part.map);
    offset += nodeSize(child);
  }
  return { text, map };
}

function bodyUnits(
  doc: unknown,
): { text: string; map: Array<SourceMapUnit | null> } {
  const blocks: Array<{ text: string; map: Array<SourceMapUnit | null> }> = [];
  const walk = (value: unknown, position: number): void => {
    const node = jsonNode(value);
    if (ELIGIBLE_TEXTBLOCKS.has(node.type ?? "")) {
      blocks.push(maskTokens(...(() => {
        const part = collectInline(value, position + 1);
        return [part.text, part.map] as const;
      })()));
      return;
    }
    if (!Array.isArray(node.content)) return;
    let offset = 0;
    const contentStart = node.type === "doc" ? position : position + 1;
    for (const child of node.content) {
      walk(child, contentStart + offset);
      offset += nodeSize(child);
    }
  };
  walk(doc, 0);
  const text: string[] = [];
  const map: Array<SourceMapUnit | null> = [];
  blocks.forEach((block, index) => {
    if (index > 0) {
      text.push("\n");
      map.push(null);
    }
    text.push(block.text);
    map.push(...block.map);
  });
  return { text: text.join(""), map };
}

function splitChunks(
  source: SpellingIssueSource,
  text: string,
  map: Array<SourceMapUnit | null>,
): SpellingChunk[] {
  const chunks: SpellingChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + MAX_SPELLING_TEXT_LENGTH, text.length);
    if (end < text.length) {
      let boundary = -1;
      for (let index = end - 1; index >= start; index -= 1) {
        if (/\s/u.test(text[index]!)) {
          boundary = index + 1;
          break;
        }
      }
      if (boundary > start) end = boundary;
      else if (
        end > start && /[\uD800-\uDBFF]/u.test(text[end - 1]!) &&
        /[\uDC00-\uDFFF]/u.test(text[end]!)
      ) end -= 1;
    }
    chunks.push({
      id: `${source}:${chunks.length}`,
      source,
      documentStart: start,
      text: text.slice(start, end),
      map: map.slice(start, end),
    });
    start = end;
  }
  return chunks;
}

export function extractSpellingDocument(title: string, doc: unknown) {
  const titleMap = Array.from(
    { length: title.length },
    (_, pos) => ({ source: "paper-title" as const, pos }),
  );
  const body = bodyUnits(doc);
  return {
    chunks: [
      ...splitChunks("paper-title", title, titleMap),
      ...splitChunks("body", body.text, body.map),
    ],
  };
}

export function mapChunkIssues(
  chunk: SpellingChunk,
  issues: readonly SpellingIssue[],
): MappedSpellingIssue[] | null {
  const sorted = [...issues].sort((a, b) => a.from - b.from || a.to - b.to);
  if (
    sorted.some((issue, index) =>
      issue.from >= issue.to || issue.from < chunk.documentStart ||
      issue.to > chunk.documentStart + chunk.text.length ||
      (index > 0 && issue.from < sorted[index - 1]!.to)
    )
  ) return null;
  const mapped: MappedSpellingIssue[] = [];
  for (const issue of sorted) {
    const from = issue.from - chunk.documentStart;
    const to = issue.to - chunk.documentStart;
    const units = chunk.map.slice(from, to);
    const first = units[0];
    if (
      !first ||
      units.some((unit, index) =>
        !unit || unit.source !== first.source || unit.pos !== first.pos + index
      )
    ) return null;
    mapped.push({
      source: first.source,
      from: first.pos,
      to: first.pos + units.length,
      word: issue.word,
      suggestions: [...issue.suggestions],
    });
  }
  return mapped;
}

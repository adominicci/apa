import { describe, expect, it } from "vitest";
import {
  extractSpellingDocument,
  mapChunkIssues,
  type SpellingChunk,
} from "./extraction.ts";

const text = (value: string, marks?: unknown[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const block = (type: string, content: unknown[]) => ({ type, content });

describe("deterministic spelling extraction", () => {
  it("extracts title and the exact eligible textblock allowlist in source order", () => {
    const doc = block("doc", [
      block("sectionBody", [
        block("paragraph", [text("paragraph")]),
        block("heading", [text("heading")]),
        block("bulletList", [
          block("listItem", [block("paragraph", [text("nested")])]),
        ]),
        block("tableTitle", [text("table title")]),
        block("tableNote", [text("table note")]),
        block("figureTitle", [text("figure title")]),
        block("figureNote", [text("figure note")]),
        block("keywordsLine", [text("keywords")]),
      ]),
    ]);
    const result = extractSpellingDocument("Paper title", doc);
    expect(
      result.chunks.filter((chunk) => chunk.source === "paper-title").map(
        (chunk) => chunk.text,
      ),
    ).toEqual(["Paper title"]);
    expect(
      result.chunks.filter((chunk) => chunk.source === "body").map(
        (chunk) => chunk.text,
      ).join(""),
    ).toBe(
      "paragraph\nheading\nnested\ntable title\ntable note\nfigure title\nfigure note\nkeywords",
    );
  });

  it("joins marked leaves and masks excluded atoms, URLs, and identifiers", () => {
    const doc = block("doc", [block("sectionBody", [
      block("paragraph", [
        text("em", [{ type: "italic" }]),
        text("phasis"),
        text(" "),
        { type: "citation", attrs: { refIds: ["x"] } },
        text(" linked", [{ type: "link", attrs: { href: "https://target" } }]),
        text(" https://example.test APA7 word_name"),
      ]),
      { type: "apaEquation", content: [text("excluded")] },
      { type: "figureImage", attrs: { src: "essays/assets/x.png" } },
    ])]);
    const body = extractSpellingDocument("", doc).chunks.find((chunk) =>
      chunk.source === "body"
    )!;
    expect(body.text).toBe(
      "emphasis   linked                                    ",
    );
    expect(body.map.slice(0, 8).every((unit) => unit !== null)).toBe(true);
    expect(body.map[9]).toBeNull();
    expect(body.map[10]).not.toBeNull();
  });

  it("uses UTF-16 maps, preferred boundaries, and surrogate-safe hard splits", () => {
    const title = `${"x".repeat(65_535)}😀tail`;
    const chunks = extractSpellingDocument(title, { type: "doc" }).chunks;
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.text.length).toBe(65_535);
    expect(chunks[1]!.text.startsWith("😀")).toBe(true);

    const withBoundary = extractSpellingDocument(
      `${"a".repeat(65_530)} word rest`,
      { type: "doc" },
    ).chunks;
    expect(withBoundary[0]!.text.endsWith(" ")).toBe(true);
  });

  it("rejects invalid mapped issue sets atomically but maps contiguous marks", () => {
    const chunk: SpellingChunk = {
      id: "body:0",
      source: "body",
      documentStart: 0,
      text: "bad masked",
      map: [
        { source: "body", pos: 10 },
        { source: "body", pos: 11 },
        { source: "body", pos: 12 },
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ],
    };
    expect(mapChunkIssues(chunk, [{
      from: 0,
      to: 3,
      word: "bad",
      suggestions: ["bed"],
    }])).toEqual([{
      source: "body",
      from: 10,
      to: 13,
      word: "bad",
      suggestions: ["bed"],
    }]);
    expect(mapChunkIssues(chunk, [{
      from: 2,
      to: 5,
      word: "d m",
      suggestions: [],
    }])).toBeNull();
    expect(mapChunkIssues(chunk, [
      { from: 0, to: 2, word: "ba", suggestions: [] },
      { from: 1, to: 3, word: "ad", suggestions: [] },
    ])).toBeNull();
  });
});

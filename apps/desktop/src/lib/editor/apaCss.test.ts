import { describe, expect, it } from "vitest";
import type { FontChoice } from "$lib/model/essay";
import { APA_FONTS } from "$lib/model/fonts";

declare const Deno: {
  readTextFileSync(path: URL): string;
};

const css = Deno.readTextFileSync(new URL("./apa.css", import.meta.url));

const approvedFontSizes: Array<[FontChoice, number]> = [
  ["times-new-roman-12", 12],
  ["georgia-11", 11],
  ["computer-modern-10", 10],
  ["aptos-12", 12],
  ["calibri-11", 11],
  ["arial-11", 11],
  ["lucida-sans-unicode-10", 10],
];

describe("APA editor indentation", () => {
  it("scopes indentation exceptions to their special blocks", () => {
    expect(css).toMatch(
      /\.apa-editor \.tiptap p\s*\{[^}]*text-indent:\s*0\.5in;/s,
    );
    expect(css).toMatch(
      /\.apa-editor \.tiptap li p\s*\{[^}]*text-indent:\s*0;/s,
    );
    expect(css).toMatch(
      /\.apa-editor \.tiptap blockquote p\s*\{[^}]*text-indent:\s*0;/s,
    );
    expect(css).toMatch(
      /\.apa-editor \.tiptap \.apa-table th p,\s*\.apa-editor \.tiptap \.apa-table td p\s*\{[^}]*text-indent:\s*0;/s,
    );
    expect(css).toMatch(/\.tbl-title\s*\{[^}]*text-indent:\s*0;/s);
    expect(css).toMatch(/\.fig-title\s*\{[^}]*text-indent:\s*0;/s);
  });
});

describe("APA editor page-sheets", () => {
  it("uses fixed letter geometry for one continuous paginated editor", () => {
    expect(css).toMatch(
      /\.apa-editor \.paper-sheet\s*\{[^}]*width:\s*816px;[^}]*height:\s*1056px;[^}]*padding:\s*96px;/s,
    );
    expect(css).toMatch(
      /\.apa-editor \.tiptap\s*\{[^}]*width:\s*816px;[^}]*padding:\s*96px;[^}]*background:[^}]*repeating-linear-gradient[^}]*1056px[^}]*1084px/s,
    );
    expect(css).toMatch(
      /\.apa-editor \.tiptap > \.sec\s*\{[^}]*width:\s*624px;[^}]*background:\s*transparent;/s,
    );
    expect(css).not.toContain("aspect-ratio");
    expect(css).not.toMatch(/width:\s*min\(/);
    expect(css).not.toMatch(/\.tiptap > \.sec \+ \.sec\s*\{/);
  });

  it("keeps page chrome isolated from authored content and selection", () => {
    expect(css).toMatch(
      /\.tesina-page-number\s*\{[^}]*position:\s*absolute;[^}]*pointer-events:\s*none;[^}]*user-select:\s*none;/s,
    );
    expect(css).toMatch(
      /\.apa-editor \.tiptap\s*\{[^}]*filter:\s*drop-shadow/s,
    );
    expect(css).toMatch(
      /\.reference-page-stack\s*\{[^}]*display:\s*contents;/s,
    );
    expect(css).toMatch(
      /\.sec-references\s*\{[^}]*height:\s*864px;[^}]*padding:\s*0;/s,
    );
  });
});

describe("APA editor body title", () => {
  it("renders the derived body title as centered bold section chrome", () => {
    expect(css).toMatch(
      /\.apa-editor \.tiptap \.sec-body::before\s*\{[^}]*content:\s*var\(--body-title\);[^}]*text-align:\s*center;[^}]*font-weight:\s*bold;/s,
    );
  });
});

describe("APA editor heading font size", () => {
  it.each(approvedFontSizes)(
    "keeps %s headings at the selected %dpt document size",
    (font, sizePt) => {
      expect(APA_FONTS[font].sizePt).toBe(sizePt);
      expect(css).toMatch(
        /\.apa-editor \.tiptap h1,[\s\S]*?\.apa-editor \.tiptap h5\s*\{[^}]*font-size:\s*var\(--doc-font-size,\s*12pt\);/s,
      );
    },
  );
});

describe("APA editor table headers", () => {
  it("centers header cells without removing the editing-only ghost grid", () => {
    expect(css).toMatch(
      /\.apa-editor \.tiptap \.apa-table th\s*\{[^}]*border-bottom:\s*1px solid var\(--fg\);[^}]*text-align:\s*center;/s,
    );
    expect(css).toMatch(
      /\.apa-editor \.tiptap \.apa-table th,\s*\.apa-editor \.tiptap \.apa-table td\s*\{[^}]*border:\s*1px dashed #cdd2d8;/s,
    );
  });
});

describe("APA editor appendix and run-in presentation", () => {
  it("uses decoration attributes instead of :has() for appendix labels", () => {
    expect(css).not.toContain(":has(");
    expect(css).toMatch(
      /data-appendix-letter[^}]*::before\s*\{[^}]*attr\(data-appendix-letter\)/s,
    );
  });

  it("flows decorated level-4 and level-5 headings into the following paragraph", () => {
    expect(css).toMatch(
      /h4\[data-apa-run-in\],\s*\.apa-editor \.tiptap h5\[data-apa-run-in\]\s*\{[^}]*display:\s*inline;[^}]*padding-left:\s*0\.5in;/s,
    );
    expect(css).toMatch(
      /data-run-in-punctuation="append"[^}]*::after\s*\{[^}]*content:\s*"\. ";/s,
    );
    expect(css).toMatch(
      /data-run-in-punctuation="preserve"[^}]*::after\s*\{[^}]*content:\s*" ";/s,
    );
    expect(css).toMatch(
      /h5\[data-apa-run-in\] \+ p\s*\{[^}]*display:\s*inline;[^}]*text-indent:\s*0;/s,
    );
  });
});

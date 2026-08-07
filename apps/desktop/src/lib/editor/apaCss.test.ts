import { describe, expect, it } from "vitest";

declare const Deno: {
  readTextFileSync(path: URL): string;
};

const css = Deno.readTextFileSync(new URL("./apa.css", import.meta.url));

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

describe("APA editor body title", () => {
  it("renders the derived body title as centered bold section chrome", () => {
    expect(css).toMatch(
      /\.apa-editor \.tiptap \.sec-body::before\s*\{[^}]*content:\s*var\(--body-title\);[^}]*text-align:\s*center;[^}]*font-weight:\s*bold;/s,
    );
  });
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

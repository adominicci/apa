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

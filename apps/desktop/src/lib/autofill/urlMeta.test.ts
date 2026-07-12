import { describe, expect, it } from "vitest";
import {
  extractUrlMeta,
  hasUsableMeta,
  urlMetaToReference,
} from "./urlMeta.ts";

describe("extractUrlMeta", () => {
  it("reads Highwire citation_* tags into a journal article shape", () => {
    const html = `
      <html><head>
        <meta name="citation_title" content="Reading habits &amp; recall">
        <meta name="citation_author" content="Salgado, Nora">
        <meta name="citation_author" content="Ferrer, Hugo">
        <meta name="citation_publication_date" content="2020/05/03">
        <meta name="citation_journal_title" content="Journal of Imaginary Studies">
        <meta name="citation_volume" content="12">
        <meta name="citation_issue" content="3">
        <meta name="citation_firstpage" content="45">
        <meta name="citation_lastpage" content="67">
        <meta name="citation_doi" content="10.1234/jis.2020.045">
        <title>Publisher — Reading habits</title>
      </head><body></body></html>`;
    const meta = extractUrlMeta(html);
    expect(meta.title).toBe("Reading habits & recall");
    expect(meta.authors).toEqual(["Salgado, Nora", "Ferrer, Hugo"]);
    expect(meta).toMatchObject({ year: 2020, month: 5, day: 3 });
    expect(meta.journal).toBe("Journal of Imaginary Studies");
    expect(meta.volume).toBe("12");
    expect(meta.doi).toBe("10.1234/jis.2020.045");
    expect(hasUsableMeta(meta)).toBe(true);

    const ref = urlMetaToReference(meta, "https://example.org/a", "id-1");
    expect(ref.type).toBe("journalArticle");
    if (ref.type === "journalArticle") {
      expect(ref.journal).toBe("Journal of Imaginary Studies");
      expect(ref.authors[0]).toEqual({
        kind: "person",
        family: "Salgado",
        given: "Nora",
      });
      expect(ref.pageStart).toBe("45");
    }
  });

  it("falls back to OpenGraph/article for a news page → website", () => {
    const html = `
      <html><head>
        <meta property="og:title" content="A field guide to citations">
        <meta property="og:site_name" content="The Daily Imaginary">
        <meta property="article:published_time" content="2023-07-11T09:00:00Z">
        <meta name="author" content="Ana María Ruiz">
      </head><body></body></html>`;
    const meta = extractUrlMeta(html);
    expect(meta.title).toBe("A field guide to citations");
    expect(meta.siteName).toBe("The Daily Imaginary");
    expect(meta).toMatchObject({ year: 2023, month: 7, day: 11 });
    expect(meta.authors).toEqual(["Ana María Ruiz"]);

    const ref = urlMetaToReference(meta, "https://news.example/x", "id-2");
    expect(ref.type).toBe("website");
    if (ref.type === "website") {
      expect(ref.siteName).toBe("The Daily Imaginary");
    }
  });

  it("reads schema.org JSON-LD when meta tags are absent", () => {
    const html = `
      <html><head>
        <script type="application/ld+json">
        {"@type":"NewsArticle","headline":"Notes on note-taking",
         "datePublished":"2019-01-15",
         "author":[{"@type":"Person","name":"Carla Ibáñez"}]}
        </script>
      </head><body></body></html>`;
    const meta = extractUrlMeta(html);
    expect(meta.title).toBe("Notes on note-taking");
    expect(meta.authors).toEqual(["Carla Ibáñez"]);
    expect(meta.year).toBe(2019);
  });

  it("treats a JS-only shell with no metadata as unusable", () => {
    const shell = `<html><head><title>Loading…</title></head>
      <body><div id="root"></div></body></html>`;
    const meta = extractUrlMeta(shell);
    // A bare title with no author/date/doi/journal is not enough.
    expect(hasUsableMeta(meta)).toBe(false);
  });

  it("returns no-date website when only a title is present", () => {
    const ref = urlMetaToReference(
      { title: "Untitled resource", authors: [] },
      "https://x.example",
      "id-3",
    );
    expect(ref.type).toBe("website");
    expect(ref.date).toEqual({ noDate: true });
  });
});

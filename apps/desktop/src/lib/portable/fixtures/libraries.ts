/**
 * Deterministic representative library fixtures (task 1.3). Three profiles —
 * empty, large-text, and figure-heavy — whose measured sizes justify the
 * numeric limits in ../limits.ts. Everything is injected/counter-based so two
 * runs (or two processes) produce byte-identical content.
 */

import type { Reference } from "@tesina/engine";
import type { Essay } from "$lib/model/essay";
import type { RefCollection } from "$lib/model/collections";
import { bmpBytes, gifBytes, jpegBytes, pngBytes } from "./images.ts";

export interface SharedLibraryFixture {
  schemaVersion: 1;
  references: Reference[];
  collections: RefCollection[];
}

export interface LibraryFixture {
  essays: Essay[];
  library: SharedLibraryFixture;
  /** Reachable figure bytes keyed by `essays/assets/<uuid>.<ext>` path. */
  assets: Record<string, Uint8Array>;
  /** Present on disk but referenced by no essay; must never be archived. */
  orphanAssets: Record<string, Uint8Array>;
}

/** Stable, obviously synthetic UUID for fixture item `n` in space `space`. */
export function fixtureUuid(space: number, n: number): string {
  const mid = space.toString(16).padStart(4, "0");
  const tail = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8${mid.slice(1)}-${tail}`;
}

const FIXTURE_TIME = "2026-01-15T12:00:00.000Z";

function fixtureReference(n: number): Reference {
  return {
    type: "journalArticle",
    id: fixtureUuid(1, n),
    authors: [
      { kind: "person", family: `Autora${n}`, given: "M. J." },
      { kind: "group", name: `Grupo de Estudio ${n}` },
    ],
    date: { year: 2000 + (n % 26) },
    title: `Estudio longitudinal número ${n} sobre memoria de trabajo`,
    journal: "Revista Sintética de Psicología",
    volume: String(10 + (n % 40)),
    issue: String(1 + (n % 4)),
    pageStart: String(100 + n),
    pageEnd: String(120 + n),
    doi: `10.9999/fixture.${n}`,
  };
}

function paragraph(text: string): unknown {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function citationNode(refIds: string[]): unknown {
  return {
    type: "citation",
    attrs: {
      items: refIds.map((refId) => ({ refId })),
      mode: "parenthetical",
    },
  };
}

function figureNode(src: string, title: string): unknown {
  return {
    type: "figure",
    content: [
      { type: "figureTitle", content: [{ type: "text", text: title }] },
      { type: "figureImage", attrs: { src, alt: title } },
      { type: "figureNote", content: [{ type: "text", text: "Nota." }] },
    ],
  };
}

interface EssayFixtureOptions {
  paragraphs: number;
  paragraphWords: number;
  citedRefs: Reference[];
  figureSrcs: string[];
  language?: "es" | "en";
}

function fixtureEssay(n: number, options: EssayFixtureOptions): Essay {
  const { paragraphs, paragraphWords, citedRefs, figureSrcs } = options;
  const words = Array.from(
    { length: paragraphWords },
    (_, w) => `palabra${(w + n) % 977}`,
  ).join(" ");
  const body: unknown[] = [];
  for (let p = 0; p < paragraphs; p += 1) {
    body.push(paragraph(words));
    if (citedRefs.length > 0 && p % 3 === 0) {
      body.push({
        type: "paragraph",
        content: [
          { type: "text", text: "Como demuestra la evidencia " },
          citationNode(
            citedRefs.slice(0, 1 + (p % citedRefs.length)).map((r) => r.id),
          ),
        ],
      });
    }
  }
  for (const [i, src] of figureSrcs.entries()) {
    body.push(figureNode(src, `Figura sintética ${i + 1}`));
  }
  return {
    schemaVersion: 2,
    id: fixtureUuid(2, n),
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    settings: {
      documentLanguage: options.language ?? "es",
      variant: "student",
      font: "times-new-roman-12",
      paperSize: "us-letter",
      includeUncitedReferences: false,
    },
    titlePage: {
      title: `Ensayo sintético ${n}`,
      authors: ["Estudiante Ejemplo"],
      affiliations: ["Universidad Sintética"],
      course: "PSY-101",
      instructor: "Docente Ejemplo",
    },
    content: { type: "doc", content: [{ type: "sectionBody", content: body }] },
    referencesSnapshot: citedRefs,
  };
}

export function emptyLibraryFixture(): LibraryFixture {
  return {
    essays: [],
    library: { schemaVersion: 1, references: [], collections: [] },
    assets: {},
    orphanAssets: {},
  };
}

/**
 * ~120 essays of long running text citing a 300-entry shared library. This is
 * far beyond a realistic student library and anchors the JSON/entity limits.
 */
export function largeTextLibraryFixture(): LibraryFixture {
  const references = Array.from({ length: 300 }, (_, n) => fixtureReference(n));
  const collections: RefCollection[] = Array.from({ length: 12 }, (_, c) => ({
    id: fixtureUuid(3, c),
    name: `Colección ${c}`,
    refIds: references.slice(c * 20, c * 20 + 20).map((r) => r.id),
  }));
  const essays = Array.from({ length: 120 }, (_, n) =>
    fixtureEssay(n, {
      paragraphs: 40,
      paragraphWords: 120,
      citedRefs: references.slice(n % 280, (n % 280) + 6),
      figureSrcs: [],
      language: n % 4 === 0 ? "en" : "es",
    }));
  return {
    essays,
    library: { schemaVersion: 1, references, collections },
    assets: {},
    orphanAssets: {},
  };
}

/**
 * A dozen essays with figures across every supported image format, plus an
 * orphan asset that must never reach an archive.
 */
export function figureHeavyLibraryFixture(): LibraryFixture {
  const references = Array.from({ length: 30 }, (_, n) => fixtureReference(n));
  const assets: Record<string, Uint8Array> = {};
  const essays: Essay[] = [];
  const makers = [
    (n: number) => ({ ext: "png", bytes: pngBytes(640 + n, 480) }),
    (n: number) => ({ ext: "jpg", bytes: jpegBytes(800, 600 + n) }),
    (n: number) => ({ ext: "gif", bytes: gifBytes(320, 240, 2 + (n % 3)) }),
    (n: number) => ({ ext: "bmp", bytes: bmpBytes(64, 48 + n) }),
  ];
  for (let n = 0; n < 12; n += 1) {
    const srcs: string[] = [];
    for (let f = 0; f < 3; f += 1) {
      const { ext, bytes } = makers[(n + f) % makers.length](n);
      const src = `essays/assets/${fixtureUuid(4, n * 8 + f)}.${ext}`;
      assets[src] = bytes;
      srcs.push(src);
    }
    essays.push(
      fixtureEssay(n, {
        paragraphs: 10,
        paragraphWords: 80,
        citedRefs: references.slice(n, n + 3),
        figureSrcs: srcs,
      }),
    );
  }
  return {
    essays,
    library: {
      schemaVersion: 1,
      references,
      collections: [
        {
          id: fixtureUuid(3, 99),
          name: "Con figuras",
          refIds: references.slice(0, 10).map((r) => r.id),
        },
      ],
    },
    assets,
    orphanAssets: {
      [`essays/assets/${fixtureUuid(4, 9999)}.png`]: pngBytes(32, 32),
    },
  };
}

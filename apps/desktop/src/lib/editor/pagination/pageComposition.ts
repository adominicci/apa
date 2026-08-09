import type { PageStart, SectionKind } from "./types.ts";

export type ComposedDocumentPage =
  | { key: string; kind: "cover"; pageNumber: number }
  | {
    key: string;
    kind: "authored";
    pageNumber: number;
    authoredPageIndex: number;
    section: SectionKind;
    pos: number;
  }
  | {
    key: string;
    kind: "references";
    pageNumber: number;
    referencePageIndex: number;
  };

export interface PageCompositionInput {
  authoredPageStarts: readonly PageStart[];
  referencePageCount: number;
  documentEnd?: number;
}

export interface DocumentPageComposition {
  pages: ComposedDocumentPage[];
  total: number;
  referenceInsertion: { pos: number; side: -2 };
}

export function composeDocumentPages(
  input: PageCompositionInput,
): DocumentPageComposition {
  const referencePageCount = Number.isFinite(input.referencePageCount)
    ? Math.max(1, Math.floor(input.referencePageCount))
    : 1;
  const firstAppendixIndex = input.authoredPageStarts.findIndex((start) =>
    start.section === "appendix"
  );
  const insertionIndex = firstAppendixIndex === -1
    ? input.authoredPageStarts.length
    : firstAppendixIndex;
  const insertionPos = firstAppendixIndex === -1
    ? input.documentEnd ?? input.authoredPageStarts.at(-1)?.pos ?? 0
    : input.authoredPageStarts[firstAppendixIndex]!.pos;
  const orderedSources: Array<
    | { kind: "authored"; start: PageStart }
    | { kind: "references"; index: number }
  > = input.authoredPageStarts.slice(0, insertionIndex).map((start) => ({
    kind: "authored" as const,
    start,
  }));
  for (let index = 0; index < referencePageCount; index += 1) {
    orderedSources.push({ kind: "references", index });
  }
  orderedSources.push(
    ...input.authoredPageStarts.slice(insertionIndex).map((start) => ({
      kind: "authored" as const,
      start,
    })),
  );

  const pages: ComposedDocumentPage[] = [
    { key: "cover", kind: "cover", pageNumber: 1 },
    ...orderedSources.map((source, index): ComposedDocumentPage => {
      const pageNumber = index + 2;
      if (source.kind === "references") {
        return {
          key: `references:${source.index}`,
          kind: "references",
          pageNumber,
          referencePageIndex: source.index,
        };
      }
      const { start } = source;
      return {
        key: `authored:${start.pageIndex}:${start.section}`,
        kind: "authored",
        pageNumber,
        authoredPageIndex: start.pageIndex,
        section: start.section,
        pos: start.pos,
      };
    }),
  ];

  return {
    pages,
    total: pages.length,
    referenceInsertion: { pos: insertionPos, side: -2 },
  };
}

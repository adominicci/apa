// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@tiptap/pm/view";
import { createTesinaEditor } from "../createEditor.ts";
import { LETTER_PRINTABLE_HEIGHT } from "./geometry.ts";
import type { PaginationReason, StablePaginationPlan } from "./types.ts";
import {
  browserPaginationLayoutAdapter,
  canonicalLayoutLength,
  canonicalLayoutScale,
  createNamedAtomicFragment,
  createPaginationMeasurer,
  measureTextLineSamples,
  type PaginationLayoutAdapter,
  type TextLineProbe,
} from "./measure.ts";
import { planPagination } from "./plan.ts";
import { NODE_NAMES } from "@tesina/engine";

function lineProbe(
  linesByOffset: readonly (number | null)[],
  positionBase: number,
  topBase = 100,
): TextLineProbe & { calls: number } {
  return {
    length: linesByOffset.length,
    calls: 0,
    rects(endExclusive) {
      this.calls += 1;
      const lines = new Map<number, number>();
      for (
        let offset = 0;
        offset < Math.min(endExclusive, linesByOffset.length);
        offset += 1
      ) {
        const line = linesByOffset[offset];
        if (line === null || line === undefined) continue;
        lines.set(line, (lines.get(line) ?? 0) + 1);
      }
      return [...lines].map(([line, characters]) => ({
        top: topBase + line * 20,
        bottom: topBase + line * 20 + 16,
        width: characters * 8,
        height: 16,
      }));
    },
    positionAt(offset) {
      return positionBase + offset;
    },
  };
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => resolve = done);
  return { promise, resolve };
}

function fakeView(): EditorView {
  return { dom: {} } as unknown as EditorView;
}

function adapterWithReadiness(
  readiness: Promise<void>,
): PaginationLayoutAdapter & {
  reads: number;
  observing: boolean;
  invalidate?: (reason: PaginationReason) => void;
} {
  return {
    reads: 0,
    observing: false,
    async waitUntilReady(_view, signal) {
      await readiness;
      if (signal.aborted) throw signal.reason;
    },
    readLayout() {
      this.reads += 1;
      return {
        fragments: [{
          id: "body-line-1",
          from: 2,
          to: 12,
          section: "body",
          kind: "line",
          height: 24,
          breakBefore: { kind: "line", pos: 2, section: "body" },
          lineGroup: { id: "p:1", index: 0, count: 1 },
        }],
        emptySections: [],
      };
    },
    observe(_view, onInvalidate) {
      this.observing = true;
      this.invalidate = onInvalidate;
      return () => this.observing = false;
    },
    invalidate: undefined as ((reason: PaginationReason) => void) | undefined,
  } as PaginationLayoutAdapter & {
    reads: number;
    observing: boolean;
    invalidate?: (reason: PaginationReason) => void;
  };
}

describe("pagination DOM measurement lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fails a permanently stalled font or image readiness wait on a fixed deadline", async () => {
    vi.useFakeTimers();
    const adapter = adapterWithReadiness(new Promise<void>(() => {}));
    const measurer = createPaginationMeasurer({
      view: fakeView(),
      adapter,
      onInvalidate: () => {},
      readinessTimeoutMs: 25,
    });
    const pending = measurer.read({
      epoch: 1,
      signal: new AbortController().signal,
      latestEpoch: () => 1,
    });

    const rejection = expect(pending).rejects.toThrow(
      "Pagination layout inputs did not become ready within 25ms",
    );
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(adapter.reads).toBe(0);
    measurer.destroy();
  });

  it("normalizes transformed browser geometry back to canonical CSS pixels", () => {
    expect(canonicalLayoutScale(612, 816)).toBe(0.75);
    expect(canonicalLayoutLength(18, 0.75)).toBe(24);
    expect(canonicalLayoutScale(0, 816)).toBe(1);
    expect(canonicalLayoutLength(24, Number.NaN)).toBe(24);
  });

  it("recognizes the real apaEquation node name as a named atomic fragment", () => {
    const fragment = createNamedAtomicFragment(
      {
        type: { name: "apaEquation" },
        nodeSize: 1,
      } as unknown as Parameters<typeof createNamedAtomicFragment>[0],
      17,
      "body",
      64,
    );

    expect(fragment).toEqual({
      id: "apaEquation:17",
      from: 17,
      to: 18,
      section: "body",
      kind: "atomic",
      height: 64,
      breakBefore: { kind: "block", pos: 17, section: "body" },
    });
  });

  it("discards an epoch superseded while fonts or images are becoming ready", async () => {
    const ready = deferred();
    const adapter = adapterWithReadiness(ready.promise);
    let latestEpoch = 1;
    const measurer = createPaginationMeasurer({
      view: fakeView(),
      adapter,
      onInvalidate: () => {},
    });
    const pending = measurer.read({
      epoch: 1,
      signal: new AbortController().signal,
      latestEpoch: () => latestEpoch,
    });

    latestEpoch = 2;
    ready.resolve();

    await expect(pending).resolves.toEqual({
      status: "stale",
      epoch: 1,
      latestEpoch: 2,
    });
    expect(adapter.reads).toBe(0);
    measurer.destroy();
  });

  it("returns adapter geometry only for the current epoch", async () => {
    const adapter = adapterWithReadiness(Promise.resolve());
    const measurer = createPaginationMeasurer({
      view: fakeView(),
      adapter,
      onInvalidate: () => {},
    });

    const result = await measurer.read({
      epoch: 7,
      signal: new AbortController().signal,
      latestEpoch: () => 7,
    });

    expect(result).toMatchObject({
      status: "measured",
      epoch: 7,
      fragments: [{ id: "body-line-1", height: 24 }],
    });
    measurer.destroy();
  });

  it("disconnects observers and ignores invalidation callbacks after teardown", () => {
    const adapter = adapterWithReadiness(Promise.resolve());
    const invalidations: PaginationReason[] = [];
    const measurer = createPaginationMeasurer({
      view: fakeView(),
      adapter,
      onInvalidate: (reason) => invalidations.push(reason),
    });

    adapter.invalidate?.("asset");
    expect(invalidations).toEqual(["asset"]);
    expect(adapter.observing).toBe(true);

    measurer.destroy();
    adapter.invalidate?.("canonical-layout");
    expect(adapter.observing).toBe(false);
    expect(invalidations).toEqual(["asset"]);
  });

  it("observes authored images without treating derived page chrome as an asset", () => {
    class TestResizeObserver {
      static instances: TestResizeObserver[] = [];
      readonly observed: Element[] = [];
      disconnected = false;

      constructor(readonly callback: ResizeObserverCallback) {
        TestResizeObserver.instances.push(this);
      }

      observe(target: Element) {
        this.observed.push(target);
      }

      unobserve() {}

      disconnect() {
        this.disconnected = true;
      }

      trigger() {
        this.callback([], this as unknown as ResizeObserver);
      }
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const root = document.createElement("div");
    const image = document.createElement("img");
    const gap = document.createElement("div");
    gap.dataset.paginationGap = "true";
    const pageNumber = document.createElement("span");
    pageNumber.dataset.paginationPageNumber = "2";
    root.append(image, gap, pageNumber);
    const invalidations: PaginationReason[] = [];

    const stop = browserPaginationLayoutAdapter.observe(
      { dom: root } as unknown as EditorView,
      (reason) => invalidations.push(reason),
    );
    const observer = TestResizeObserver.instances[0]!;

    expect(observer.observed).toEqual([image]);
    expect(observer.observed).not.toContain(root);
    expect(observer.observed).not.toContain(gap);
    expect(observer.observed).not.toContain(pageNumber);
    gap.style.height = "96px";
    pageNumber.textContent = "3";
    expect(invalidations).toEqual([]);

    observer.trigger();
    expect(invalidations).toEqual(["asset"]);

    const laterImage = document.createElement("img");
    root.append(laterImage);
    laterImage.dispatchEvent(new Event("load"));
    expect(invalidations).toEqual(["asset", "asset"]);
    expect(observer.observed).toContain(laterImage);

    stop();
    expect(observer.disconnected).toBe(true);
    laterImage.dispatchEvent(new Event("error"));
    observer.trigger();
    expect(invalidations).toEqual(["asset", "asset"]);
  });
});

describe("text line sampling", () => {
  it("preserves exact line-start positions across marked text nodes and whitespace", () => {
    const plain = lineProbe([0, 0, 1, 1], 10);
    const marked = lineProbe([0, null, 1, 1, null, 2], 20);

    expect(measureTextLineSamples([plain, marked])).toEqual([
      { top: 100, bottom: 116, pos: 10 },
      { top: 120, bottom: 136, pos: 12 },
      { top: 140, bottom: 156, pos: 25 },
    ]);
  });

  it("uses normalized scaled and gap-free geometry supplied by the browser probe", () => {
    const transformedAndNormalized = lineProbe([0, 0, 1], 40, 24);

    expect(measureTextLineSamples([transformedAndNormalized])).toEqual([
      { top: 24, bottom: 40, pos: 40 },
      { top: 44, bottom: 60, pos: 42 },
    ]);
  });

  it("reduces 2,251 character probes to the line-count logarithmic bound", () => {
    const characters = 2_251;
    const visualLines = 50;
    const probe = lineProbe(
      Array.from(
        { length: characters },
        (_, offset) =>
          Math.min(
            visualLines - 1,
            Math.floor(offset * visualLines / characters),
          ),
      ),
      2,
    );

    const lines = measureTextLineSamples([probe]);

    expect(lines).toHaveLength(visualLines);
    expect(probe.calls).toBeLessThan(700);
    expect(probe.calls).toBeLessThan(characters / 3);
  });

  it("routes production browser measurement through bounded line probes", () => {
    const mount = document.createElement("div");
    document.body.append(mount);
    const text = "x".repeat(120);
    const editor = createTesinaEditor({
      element: mount,
      content: {
        type: "doc",
        content: [{
          type: NODE_NAMES.sectionBody,
          content: [{
            type: "paragraph",
            content: [{ type: "text", text }],
          }],
        }],
      },
      newlyCreated: true,
      citationEnv: { refsById: new Map(), locale: "en" },
      referenceEnv: { references: [], locale: "en", emptyLabel: "unused" },
      paginationEnv: null,
    });
    const paragraphPos = 1;
    const paragraph = editor.view.nodeDOM(paragraphPos) as HTMLElement;
    const textNode = paragraph.firstChild!;
    vi.spyOn(paragraph, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 100, 624, 60),
    );
    let rangeCalls = 0;
    const rangeSpy = vi.spyOn(document, "createRange").mockImplementation(
      () => {
        let endExclusive = 0;
        return {
          setStart(node: Node) {
            expect(node).toBe(textNode);
          },
          setEnd(node: Node, offset: number) {
            expect(node).toBe(textNode);
            endExclusive = offset;
          },
          getClientRects() {
            rangeCalls += 1;
            return Array.from(
              { length: Math.ceil(endExclusive / 40) },
              (_, line) =>
                new DOMRect(
                  0,
                  100 + line * 20,
                  Math.min(40, endExclusive - line * 40) * 8,
                  16,
                ),
            ) as unknown as DOMRectList;
          },
        } as unknown as Range;
      },
    );
    const getComputedStyle = globalThis.getComputedStyle.bind(globalThis);
    const styleSpy = vi.spyOn(globalThis, "getComputedStyle")
      .mockImplementation(
        (element, pseudoElement) =>
          pseudoElement
            ? {
              display: "none",
              content: "none",
            } as CSSStyleDeclaration
            : getComputedStyle(element),
      );

    try {
      const snapshot = browserPaginationLayoutAdapter.readLayout(editor.view);
      const lines = snapshot.fragments.filter((fragment) =>
        fragment.lineGroup?.id === `text:${paragraphPos}`
      );

      expect(lines.map((line) => line.breakBefore.pos)).toEqual([
        editor.view.posAtDOM(textNode, 0),
        editor.view.posAtDOM(textNode, 40),
        editor.view.posAtDOM(textNode, 80),
      ]);
      expect(rangeCalls).toBeLessThan(30);
    } finally {
      styleSpy.mockRestore();
      rangeSpy.mockRestore();
      editor.destroy();
      mount.remove();
    }
  });

  it("measures trailing and hard-break-only visual lines through the production adapter", () => {
    const mount = document.createElement("div");
    document.body.append(mount);
    const editor = createTesinaEditor({
      element: mount,
      content: {
        type: "doc",
        content: [{
          type: NODE_NAMES.sectionBody,
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Lead" },
                { type: "hardBreak" },
              ],
            },
            {
              type: "paragraph",
              content: [{ type: "hardBreak" }, { type: "hardBreak" }],
            },
          ],
        }],
      },
      newlyCreated: true,
      citationEnv: { refsById: new Map(), locale: "en" },
      referenceEnv: { references: [], locale: "en", emptyLabel: "unused" },
      paginationEnv: null,
    });
    const paragraphPositions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph") paragraphPositions.push(pos);
      return true;
    });
    const trailingPos = paragraphPositions[0]!;
    const breakOnlyPos = paragraphPositions[1]!;
    const trailing = editor.view.nodeDOM(trailingPos) as HTMLElement;
    const breakOnly = editor.view.nodeDOM(breakOnlyPos) as HTMLElement;
    const textNode = trailing.firstChild!;
    const trailingBreaks = [...trailing.querySelectorAll("br")];
    const breakOnlyBreaks = [...breakOnly.querySelectorAll("br")];

    expect(trailingBreaks.map((element) => element.className)).toEqual([
      "",
      "ProseMirror-trailingBreak",
    ]);
    expect(breakOnlyBreaks.map((element) => element.className)).toEqual([
      "",
      "",
      "ProseMirror-trailingBreak",
    ]);
    vi.spyOn(trailing, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 100, 624, 40),
    );
    vi.spyOn(breakOnly, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 200, 624, 60),
    );
    trailingBreaks.forEach((element, index) => {
      vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
        new DOMRect(32, 100 + index * 20, 0, 16),
      );
    });
    breakOnlyBreaks.forEach((element, index) => {
      vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 200 + index * 20, 0, 16),
      );
    });
    const derivedGap = document.createElement("span");
    derivedGap.dataset.paginationGap = "true";
    const derivedGapBreak = document.createElement("br");
    derivedGap.append(derivedGapBreak);
    trailing.append(derivedGap);
    vi.spyOn(derivedGap, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 180, 0, 0),
    );
    vi.spyOn(derivedGapBreak, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 180, 0, 16),
    );
    const rangeSpy = vi.spyOn(document, "createRange").mockImplementation(
      () =>
        ({
          setStart(node: Node) {
            expect(node).toBe(textNode);
          },
          setEnd(node: Node) {
            expect(node).toBe(textNode);
          },
          getClientRects() {
            return [new DOMRect(0, 100, 32, 16)] as unknown as DOMRectList;
          },
        }) as unknown as Range,
    );
    const getComputedStyle = globalThis.getComputedStyle.bind(globalThis);
    const styleSpy = vi.spyOn(globalThis, "getComputedStyle")
      .mockImplementation(
        (element, pseudoElement) =>
          pseudoElement
            ? {
              display: "none",
              content: "none",
            } as CSSStyleDeclaration
            : getComputedStyle(element),
      );

    try {
      const snapshot = browserPaginationLayoutAdapter.readLayout(editor.view);
      const trailingLines = snapshot.fragments.filter((fragment) =>
        fragment.lineGroup?.id === `text:${trailingPos}`
      );
      const breakOnlyLines = snapshot.fragments.filter((fragment) =>
        fragment.lineGroup?.id === `text:${breakOnlyPos}`
      );
      const trailingParent = trailingBreaks[1]!.parentNode!;

      expect(trailingLines.map((line) => line.breakBefore.pos)).toEqual([
        editor.view.posAtDOM(textNode, 0),
        editor.view.posAtDOM(
          trailingParent,
          [...trailingParent.childNodes].indexOf(trailingBreaks[1]!),
        ),
      ]);
      expect(breakOnlyLines.map((line) => line.breakBefore.pos)).toEqual(
        breakOnlyBreaks.map((element) => {
          const parent = element.parentNode!;
          return editor.view.posAtDOM(
            parent,
            [...parent.childNodes].indexOf(element),
          );
        }),
      );
    } finally {
      styleSpy.mockRestore();
      rangeSpy.mockRestore();
      editor.destroy();
      mount.remove();
    }
  });

  it("keeps widow groups separate for consecutive paragraphs in one list item", () => {
    const mount = document.createElement("div");
    document.body.append(mount);
    const lineText = "abcdefghijabcdefghijabcdefghij";
    const editor = createTesinaEditor({
      element: mount,
      content: {
        type: "doc",
        content: [{
          type: NODE_NAMES.sectionBody,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Preface" }],
            },
            {
              type: "bulletList",
              content: [{
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: lineText }],
                  },
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: lineText }],
                  },
                ],
              }],
            },
          ],
        }],
      },
      newlyCreated: true,
      citationEnv: { refsById: new Map(), locale: "en" },
      referenceEnv: { references: [], locale: "en", emptyLabel: "unused" },
      paginationEnv: null,
    });
    const paragraphPositions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph") paragraphPositions.push(pos);
      return true;
    });
    const [prefacePos, firstListParagraphPos, secondListParagraphPos] =
      paragraphPositions;
    const preface = editor.view.nodeDOM(prefacePos!) as HTMLElement;
    const firstListParagraph = editor.view.nodeDOM(
      firstListParagraphPos!,
    ) as HTMLElement;
    const secondListParagraph = editor.view.nodeDOM(
      secondListParagraphPos!,
    ) as HTMLElement;
    const prefaceText = preface.firstChild!;
    const firstListText = firstListParagraph.firstChild!;
    const secondListText = secondListParagraph.firstChild!;
    const measurements = new Map<Node, { height: number; top: number }>([
      [prefaceText, { height: 544, top: 100 }],
      [firstListText, { height: 80, top: 644 }],
      [secondListText, { height: 80, top: 884 }],
    ]);
    vi.spyOn(preface, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 100, 624, 544),
    );
    vi.spyOn(firstListParagraph, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 644, 624, 240),
    );
    vi.spyOn(secondListParagraph, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 884, 624, 240),
    );
    let measuredNode: Node | null = null;
    let endExclusive = 0;
    const rangeSpy = vi.spyOn(document, "createRange").mockImplementation(
      () =>
        ({
          setStart(node: Node) {
            measuredNode = node;
          },
          setEnd(node: Node, offset: number) {
            measuredNode = node;
            endExclusive = offset;
          },
          getClientRects() {
            const measurement = measuredNode
              ? measurements.get(measuredNode)
              : undefined;
            if (!measurement) return [] as unknown as DOMRectList;
            if (measuredNode === prefaceText) {
              return [
                new DOMRect(0, measurement.top, 56, measurement.height),
              ] as unknown as DOMRectList;
            }
            return Array.from(
              { length: Math.ceil(endExclusive / 10) },
              (_, line) =>
                new DOMRect(
                  0,
                  measurement.top + line * measurement.height,
                  Math.min(10, endExclusive - line * 10) * 8,
                  measurement.height,
                ),
            ) as unknown as DOMRectList;
          },
        }) as unknown as Range,
    );
    const getComputedStyle = globalThis.getComputedStyle.bind(globalThis);
    const styleSpy = vi.spyOn(globalThis, "getComputedStyle")
      .mockImplementation(
        (element, pseudoElement) =>
          pseudoElement
            ? {
              display: "none",
              content: "none",
            } as CSSStyleDeclaration
            : element === preface
            ? {
              lineHeight: "544px",
              fontSize: "16px",
              marginTop: "0px",
              marginBottom: "0px",
            } as CSSStyleDeclaration
            : element === firstListParagraph ||
                element === secondListParagraph
            ? {
              lineHeight: "80px",
              fontSize: "16px",
              marginTop: "0px",
              marginBottom: "0px",
            } as CSSStyleDeclaration
            : getComputedStyle(element),
      );

    try {
      const snapshot = browserPaginationLayoutAdapter.readLayout(editor.view);
      const firstParagraphLines = snapshot.fragments.filter((fragment) =>
        fragment.breakBefore.pos >= firstListParagraphPos! + 1 &&
        fragment.breakBefore.pos <
          firstListParagraphPos! + editor.state.doc.nodeAt(
              firstListParagraphPos!,
            )!.nodeSize
      );
      const secondParagraphLines = snapshot.fragments.filter((fragment) =>
        fragment.breakBefore.pos >= secondListParagraphPos! + 1 &&
        fragment.breakBefore.pos <
          secondListParagraphPos! + editor.state.doc.nodeAt(
              secondListParagraphPos!,
            )!.nodeSize
      );

      expect(firstParagraphLines).toHaveLength(3);
      expect(secondParagraphLines).toHaveLength(3);
      expect(firstParagraphLines[0]!.lineGroup?.id).not.toBe(
        secondParagraphLines[0]!.lineGroup?.id,
      );
      const plan = planPagination({
        epoch: 1,
        fragments: snapshot.fragments,
        emptySections: snapshot.emptySections,
      });
      expect(plan.status).toBe("stable");
      if (plan.status !== "stable") throw new Error("expected stable plan");
      expect(plan.pageStarts[1]?.pos).toBe(
        secondParagraphLines[0]!.breakBefore.pos,
      );
    } finally {
      styleSpy.mockRestore();
      rangeSpy.mockRestore();
      editor.destroy();
      mount.remove();
    }
  });

  it("splits oversized editable table titles and notes at real browser line boundaries", () => {
    const mount = document.createElement("div");
    document.body.append(mount);
    const titleText = "T".repeat(100);
    const noteText = "N".repeat(100);
    const editor = createTesinaEditor({
      element: mount,
      content: {
        type: "doc",
        content: [{
          type: NODE_NAMES.sectionBody,
          content: [{
            type: NODE_NAMES.apaTable,
            content: [
              {
                type: NODE_NAMES.tableTitle,
                content: [{ type: "text", text: titleText }],
              },
              {
                type: "table",
                content: [{
                  type: "tableRow",
                  content: [{
                    type: "tableCell",
                    content: [{ type: "paragraph" }],
                  }],
                }],
              },
              {
                type: "tableNote",
                content: [{ type: "text", text: noteText }],
              },
            ],
          }],
        }],
      },
      newlyCreated: true,
      citationEnv: { refsById: new Map(), locale: "en" },
      referenceEnv: { references: [], locale: "en", emptyLabel: "unused" },
      paginationEnv: null,
    });
    const positions = new Map<string, number>();
    editor.state.doc.descendants((node, pos) => {
      if (
        node.type.name === NODE_NAMES.tableTitle ||
        node.type.name === "tableNote"
      ) {
        positions.set(node.type.name, pos);
      }
      return true;
    });
    const titlePos = positions.get(NODE_NAMES.tableTitle)!;
    const notePos = positions.get("tableNote")!;
    const title = editor.view.nodeDOM(titlePos) as HTMLElement;
    const note = editor.view.nodeDOM(notePos) as HTMLElement;
    const titleNode = title.firstChild!;
    const noteNode = note.firstChild!;
    vi.spyOn(title, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 100, 624, 1_000),
    );
    vi.spyOn(note, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 1_200, 624, 1_000),
    );
    let measuredNode: Node | null = null;
    let endExclusive = 0;
    const rangeSpy = vi.spyOn(document, "createRange").mockImplementation(
      () =>
        ({
          setStart(node: Node) {
            measuredNode = node;
          },
          setEnd(node: Node, offset: number) {
            measuredNode = node;
            endExclusive = offset;
          },
          getClientRects() {
            const top = measuredNode === titleNode
              ? 100
              : measuredNode === noteNode
              ? 1_200
              : null;
            if (top === null) return [] as unknown as DOMRectList;
            return Array.from(
              { length: Math.ceil(endExclusive / 2) },
              (_, line) =>
                new DOMRect(
                  0,
                  top + line * 20,
                  Math.min(2, endExclusive - line * 2) * 8,
                  16,
                ),
            ) as unknown as DOMRectList;
          },
        }) as unknown as Range,
    );
    const getComputedStyle = globalThis.getComputedStyle.bind(globalThis);
    const styleSpy = vi.spyOn(globalThis, "getComputedStyle")
      .mockImplementation(
        (element, pseudoElement) =>
          pseudoElement
            ? {
              display: "none",
              content: "none",
            } as CSSStyleDeclaration
            : element === title || element === note
            ? {
              lineHeight: "20px",
              fontSize: "16px",
              marginTop: "0px",
              marginBottom: "0px",
              borderTopWidth: "0px",
              borderBottomWidth: "0px",
            } as CSSStyleDeclaration
            : getComputedStyle(element),
      );

    try {
      const snapshot = browserPaginationLayoutAdapter.readLayout(editor.view);
      const titleLines = snapshot.fragments.filter((fragment) =>
        fragment.lineGroup?.id === `tableTitle:${titlePos}`
      );
      const noteLines = snapshot.fragments.filter((fragment) =>
        fragment.lineGroup?.id === `tableNote:${notePos}`
      );
      expect(titleLines).toHaveLength(50);
      expect(noteLines).toHaveLength(50);
      expect(titleLines.map((fragment) => fragment.breakBefore.pos)).toEqual(
        Array.from(
          { length: 50 },
          (_, index) => editor.view.posAtDOM(titleNode, index * 2),
        ),
      );
      expect(noteLines.map((fragment) => fragment.breakBefore.pos)).toEqual(
        Array.from(
          { length: 50 },
          (_, index) => editor.view.posAtDOM(noteNode, index * 2),
        ),
      );

      const plan = planPagination({
        epoch: 1,
        fragments: snapshot.fragments,
        emptySections: snapshot.emptySections,
      });
      expect(plan.status).toBe("stable");
      if (plan.status !== "stable") throw new Error("expected stable plan");
      expect(
        plan.pageStarts.some((start) =>
          start.pos > titlePos && start.pos < titlePos + titleText.length
        ),
      ).toBe(true);
      expect(
        plan.pageStarts.some((start) =>
          start.pos > notePos && start.pos < notePos + noteText.length
        ),
      ).toBe(true);
    } finally {
      styleSpy.mockRestore();
      rangeSpy.mockRestore();
      editor.destroy();
      mount.remove();
    }
  });

  it("splits an oversized block heading at real browser line boundaries", () => {
    const mount = document.createElement("div");
    document.body.append(mount);
    const headingText = "H".repeat(100);
    const editor = createTesinaEditor({
      element: mount,
      content: {
        type: "doc",
        content: [{
          type: NODE_NAMES.sectionBody,
          content: [
            {
              type: "heading",
              attrs: { level: 1 },
              content: [{ type: "text", text: headingText }],
            },
            { type: "paragraph", content: [{ type: "text", text: "Body" }] },
          ],
        }],
      },
      newlyCreated: true,
      citationEnv: { refsById: new Map(), locale: "en" },
      referenceEnv: { references: [], locale: "en", emptyLabel: "unused" },
      paginationEnv: null,
    });
    let headingPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading") headingPos = pos;
      return headingPos < 0;
    });
    const heading = editor.view.nodeDOM(headingPos) as HTMLElement;
    const headingNode = heading.firstChild!;
    vi.spyOn(heading, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 100, 624, 1_000),
    );
    let endExclusive = 0;
    const rangeSpy = vi.spyOn(document, "createRange").mockImplementation(
      () =>
        ({
          setStart() {},
          setEnd(_node: Node, offset: number) {
            endExclusive = offset;
          },
          getClientRects() {
            return Array.from(
              { length: Math.ceil(endExclusive / 2) },
              (_, line) =>
                new DOMRect(
                  0,
                  100 + line * 20,
                  Math.min(2, endExclusive - line * 2) * 8,
                  16,
                ),
            ) as unknown as DOMRectList;
          },
        }) as unknown as Range,
    );
    const getComputedStyle = globalThis.getComputedStyle.bind(globalThis);
    const styleSpy = vi.spyOn(globalThis, "getComputedStyle")
      .mockImplementation(
        (element, pseudoElement) =>
          pseudoElement
            ? { display: "none", content: "none" } as CSSStyleDeclaration
            : element === heading
            ? {
              lineHeight: "20px",
              fontSize: "16px",
              marginTop: "0px",
              marginBottom: "0px",
              borderTopWidth: "0px",
              borderBottomWidth: "0px",
            } as CSSStyleDeclaration
            : getComputedStyle(element),
      );

    try {
      const snapshot = browserPaginationLayoutAdapter.readLayout(editor.view);
      const headingLines = snapshot.fragments.filter((fragment) =>
        fragment.lineGroup?.id === `heading:${headingPos}`
      );
      expect(headingLines).toHaveLength(50);
      expect(headingLines.map((fragment) => fragment.breakBefore.pos)).toEqual(
        Array.from(
          { length: 50 },
          (_, index) => editor.view.posAtDOM(headingNode, index * 2),
        ),
      );
      const plan = planPagination({
        epoch: 1,
        fragments: snapshot.fragments,
        emptySections: snapshot.emptySections,
      });
      expect(plan.status).toBe("stable");
      if (plan.status !== "stable") throw new Error("expected stable plan");
      expect(
        plan.pageStarts.some((start) =>
          start.pos > headingPos && start.pos < headingPos + headingText.length
        ),
      ).toBe(true);
    } finally {
      styleSpy.mockRestore();
      rangeSpy.mockRestore();
      editor.destroy();
      mount.remove();
    }
  });

  it("measures run-in heading-only lines before the shared paragraph line", () => {
    const mount = document.createElement("div");
    document.body.append(mount);
    const editor = createTesinaEditor({
      element: mount,
      content: {
        type: "doc",
        content: [{
          type: NODE_NAMES.sectionBody,
          content: [
            {
              type: "heading",
              attrs: { level: 4 },
              content: [{ type: "text", text: "ABCDEF" }],
            },
            {
              type: "paragraph",
              content: [{ type: "text", text: "Body" }],
            },
          ],
        }],
      },
      newlyCreated: true,
      citationEnv: { refsById: new Map(), locale: "en" },
      referenceEnv: { references: [], locale: "en", emptyLabel: "unused" },
      paginationEnv: null,
    });
    let headingPos = -1;
    let paragraphPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading") headingPos = pos;
      if (node.type.name === "paragraph") paragraphPos = pos;
      return true;
    });
    const heading = editor.view.nodeDOM(headingPos) as HTMLElement;
    const paragraph = editor.view.nodeDOM(paragraphPos) as HTMLElement;
    expect(heading.dataset["apaRunIn"]).toBe("true");
    const headingNode = heading.firstChild!;
    const paragraphNode = paragraph.firstChild!;
    const existingGap = document.createElement("span");
    existingGap.dataset["paginationGap"] = "line";
    heading.append(existingGap);
    vi.spyOn(existingGap, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 120, 816, 200),
    );
    vi.spyOn(heading, "getClientRects").mockReturnValue(
      [
        new DOMRect(0, 100, 16, 16),
        new DOMRect(0, 320, 16, 16),
        new DOMRect(0, 340, 16, 16),
      ] as unknown as DOMRectList,
    );
    vi.spyOn(paragraph, "getClientRects").mockReturnValue(
      [
        new DOMRect(16, 340, 16, 16),
        new DOMRect(0, 360, 16, 16),
      ] as unknown as DOMRectList,
    );
    let measuredNode: Node | null = null;
    let endExclusive = 0;
    const rangeSpy = vi.spyOn(document, "createRange").mockImplementation(
      () =>
        ({
          setStart(node: Node) {
            measuredNode = node;
          },
          setEnd(node: Node, offset: number) {
            measuredNode = node;
            endExclusive = offset;
          },
          getClientRects() {
            const tops = measuredNode === headingNode
              ? [100, 320, 340]
              : measuredNode === paragraphNode
              ? [340, 360]
              : [];
            return Array.from(
              { length: Math.ceil(endExclusive / 2) },
              (_, line) =>
                new DOMRect(
                  0,
                  tops[line]!,
                  Math.min(2, endExclusive - line * 2) * 8,
                  16,
                ),
            ) as unknown as DOMRectList;
          },
        }) as unknown as Range,
    );
    const getComputedStyle = globalThis.getComputedStyle.bind(globalThis);
    const styleSpy = vi.spyOn(globalThis, "getComputedStyle")
      .mockImplementation(
        (element, pseudoElement) =>
          pseudoElement
            ? { display: "none", content: "none" } as CSSStyleDeclaration
            : element === heading || element === paragraph
            ? {
              lineHeight: "20px",
              fontSize: "16px",
              marginTop: "0px",
              marginBottom: "0px",
              borderTopWidth: "0px",
              borderBottomWidth: "0px",
            } as CSSStyleDeclaration
            : getComputedStyle(element),
      );

    try {
      const snapshot = browserPaginationLayoutAdapter.readLayout(editor.view);
      const headingOnlyLines = snapshot.fragments.filter((fragment) =>
        fragment.id.startsWith(`runInHeading:${headingPos}:line:`)
      );
      const paragraphLines = snapshot.fragments.filter((fragment) =>
        fragment.lineGroup?.id === `text:${paragraphPos}`
      );
      expect(headingOnlyLines).toHaveLength(2);
      expect(headingOnlyLines.map((fragment) => fragment.breakBefore.pos))
        .toEqual([
          editor.view.posAtDOM(headingNode, 0),
          editor.view.posAtDOM(headingNode, 2),
        ]);
      expect(headingOnlyLines[0]?.lineGroup).toMatchObject({
        id: `runInHeading:${headingPos}`,
        index: 0,
        count: 1,
      });
      expect(headingOnlyLines.at(-1)?.kind).toBe("heading");
      expect(headingOnlyLines.at(-1)?.lineGroup).toBeUndefined();
      expect(headingOnlyLines.at(-1)?.keepWithNext).toBe(true);
      expect(paragraphLines).toHaveLength(2);
      expect(
        [...headingOnlyLines, ...paragraphLines].reduce(
          (total, fragment) => total + fragment.height,
          0,
        ),
      ).toBe(80);
      const plan = planPagination({
        epoch: 1,
        fragments: [
          {
            id: "preface",
            from: 1,
            to: 2,
            section: "body",
            kind: "line",
            height: LETTER_PRINTABLE_HEIGHT - 40,
            breakBefore: { kind: "line", pos: 1, section: "body" },
          },
          ...headingOnlyLines,
          ...paragraphLines,
        ],
      });
      expect(plan.status).toBe("stable");
      if (plan.status !== "stable") throw new Error("Expected stable plan");
      expect([
        headingOnlyLines[0]?.from,
        headingOnlyLines.at(-1)?.from,
      ]).toContain(plan.pageStarts[1]?.pos);
      expect(
        plan.pageStarts.some((start) => start.pos === paragraphLines[0]?.from),
      ).toBe(false);
    } finally {
      styleSpy.mockRestore();
      rangeSpy.mockRestore();
      editor.destroy();
      mount.remove();
    }
  });

  it("remeasures a painted atomic overflow from its reachable scroll extent", () => {
    const mount = document.createElement("div");
    document.body.append(mount);
    const editor = createTesinaEditor({
      element: mount,
      content: {
        type: "doc",
        content: [{
          type: NODE_NAMES.sectionBody,
          content: [{
            type: "figure",
            content: [
              {
                type: NODE_NAMES.figureTitle,
                content: [{ type: "text", text: "Oversize proof" }],
              },
              { type: "figureImage", attrs: { src: "", alt: "proof" } },
              {
                type: "figureNote",
                content: [{ type: "text", text: "Reachable note" }],
              },
            ],
          }],
        }],
      },
      newlyCreated: true,
      citationEnv: { refsById: new Map(), locale: "en" },
      referenceEnv: { references: [], locale: "en", emptyLabel: "unused" },
      paginationEnv: null,
    });
    let figurePos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "figure") figurePos = pos;
      return figurePos < 0;
    });
    const figure = editor.view.nodeDOM(figurePos) as HTMLElement;
    figure.dataset["paginationOverflow"] = "atomic";
    vi.spyOn(figure, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 100, 624, 832),
    );
    Object.defineProperty(figure, "clientHeight", {
      configurable: true,
      value: 832,
    });
    Object.defineProperty(figure, "scrollHeight", {
      configurable: true,
      value: 960,
    });
    const getComputedStyle = globalThis.getComputedStyle.bind(globalThis);
    const styleSpy = vi.spyOn(globalThis, "getComputedStyle")
      .mockImplementation(
        (element, pseudoElement) =>
          pseudoElement
            ? {
              display: "none",
              content: "none",
            } as CSSStyleDeclaration
            : element === figure
            ? {
              marginTop: "16px",
              marginBottom: "16px",
              borderTopWidth: "0px",
              borderBottomWidth: "0px",
            } as CSSStyleDeclaration
            : getComputedStyle(element),
      );

    try {
      const snapshot = browserPaginationLayoutAdapter.readLayout(editor.view);
      const atomic = snapshot.fragments.find((fragment) =>
        fragment.id === `figure:${figurePos}`
      );
      expect(atomic?.height).toBe(992);
      const plan = planPagination({
        epoch: 1,
        fragments: snapshot.fragments,
        emptySections: snapshot.emptySections,
      });
      expect(plan.status).toBe("stable");
      if (plan.status !== "stable") throw new Error("expected stable plan");
      expect(plan.overflows).toEqual([{
        fragmentId: `figure:${figurePos}`,
        pos: figurePos,
        section: "body",
        kind: "atomic",
        maxHeight: LETTER_PRINTABLE_HEIGHT,
      }]);
    } finally {
      styleSpy.mockRestore();
      editor.destroy();
      mount.remove();
    }
  });

  it("remeasures a painted table-row overflow from its reachable scroll extent", () => {
    const mount = document.createElement("div");
    document.body.append(mount);
    const editor = createTesinaEditor({
      element: mount,
      content: {
        type: "doc",
        content: [{
          type: NODE_NAMES.sectionBody,
          content: [{
            type: NODE_NAMES.apaTable,
            content: [
              {
                type: NODE_NAMES.tableTitle,
                content: [{ type: "text", text: "Oversize row" }],
              },
              {
                type: "table",
                content: [{
                  type: "tableRow",
                  content: [{
                    type: "tableCell",
                    content: [{
                      type: "paragraph",
                      content: [{ type: "text", text: "Reachable cell" }],
                    }],
                  }],
                }],
              },
              { type: "tableNote" },
            ],
          }],
        }],
      },
      newlyCreated: true,
      citationEnv: { refsById: new Map(), locale: "en" },
      referenceEnv: { references: [], locale: "en", emptyLabel: "unused" },
      paginationEnv: null,
    });
    let rowPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableRow") rowPos = pos;
      return rowPos < 0;
    });
    const row = editor.view.nodeDOM(rowPos) as HTMLElement;
    row.dataset["paginationOverflow"] = "tableRow";
    const scale = 0.75;
    const canonicalTop = 100;
    let shrunk = false;
    Object.defineProperty(editor.view.dom, "offsetWidth", {
      configurable: true,
      value: 816,
    });
    vi.spyOn(editor.view.dom, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 612, 3_000),
    );
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue(
      new DOMRect(
        0,
        canonicalTop * scale,
        624 * scale,
        864 * scale,
      ),
    );
    Object.defineProperty(row, "clientHeight", {
      configurable: true,
      value: 864,
    });
    Object.defineProperty(row, "scrollHeight", {
      configurable: true,
      value: 864,
    });
    const firstCell = row.querySelector<HTMLElement>("td")!;
    const gap = document.createElement("span");
    gap.dataset["paginationGap"] = "tableRow";
    const misplacedGapPaint = document.createElement("span");
    gap.append(misplacedGapPaint);
    const fractionalContent = document.createElement("span");
    firstCell.append(gap, fractionalContent);
    vi.spyOn(gap, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 400 * scale, 624 * scale, 124 * scale),
    );
    vi.spyOn(misplacedGapPaint, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 1_200 * scale, 624 * scale, 28 * scale),
    );
    vi.spyOn(fractionalContent, "getBoundingClientRect")
      .mockImplementation(() => {
        const intrinsicHeight = shrunk ? 824 : 988.25;
        const bottom = canonicalTop + intrinsicHeight - row.scrollTop;
        return new DOMRect(
          0,
          (bottom - 16) * scale,
          624 * scale,
          16 * scale,
        );
      });
    row.scrollTop = 40;
    const getComputedStyle = globalThis.getComputedStyle.bind(globalThis);
    const styleSpy = vi.spyOn(globalThis, "getComputedStyle")
      .mockImplementation(
        (element, pseudoElement) =>
          pseudoElement
            ? {
              display: "none",
              content: "none",
            } as CSSStyleDeclaration
            : element === row
            ? {
              marginTop: "0px",
              marginBottom: "0px",
              borderTopWidth: "0px",
              borderBottomWidth: "0px",
            } as CSSStyleDeclaration
            : getComputedStyle(element),
      );

    try {
      let firstOverflows: StablePaginationPlan["overflows"] | undefined;
      for (let pass = 0; pass < 2; pass += 1) {
        const snapshot = browserPaginationLayoutAdapter.readLayout(editor.view);
        const tableRow = snapshot.fragments.find((fragment) =>
          fragment.breakBefore.pos === rowPos && fragment.kind === "tableRow"
        );
        expect(tableRow?.height).toBe(864.25);
        const plan = planPagination({
          epoch: 1,
          fragments: snapshot.fragments,
          emptySections: snapshot.emptySections,
        });
        expect(plan.status).toBe("stable");
        if (plan.status !== "stable") throw new Error("expected stable plan");
        expect(plan.overflows).toContainEqual({
          fragmentId: tableRow?.id,
          pos: rowPos,
          section: "body",
          kind: "tableRow",
          maxHeight: LETTER_PRINTABLE_HEIGHT,
        });
        if (firstOverflows) expect(plan.overflows).toEqual(firstOverflows);
        firstOverflows = plan.overflows;
      }

      shrunk = true;
      const shrunkSnapshot = browserPaginationLayoutAdapter.readLayout(
        editor.view,
      );
      const shrunkRow = shrunkSnapshot.fragments.find((fragment) =>
        fragment.breakBefore.pos === rowPos && fragment.kind === "tableRow"
      );
      expect(shrunkRow?.height).toBe(740);
      const shrunkPlan = planPagination({
        epoch: 1,
        fragments: shrunkSnapshot.fragments,
        emptySections: shrunkSnapshot.emptySections,
      });
      expect(shrunkPlan.status).toBe("stable");
      if (shrunkPlan.status !== "stable") {
        throw new Error("expected stable plan");
      }
      expect(shrunkPlan.overflows).toEqual([]);
    } finally {
      styleSpy.mockRestore();
      editor.destroy();
      mount.remove();
    }
  });

  it("keeps a transformed fractional atomic overflow stable and clears it after shrink", () => {
    const mount = document.createElement("div");
    document.body.append(mount);
    const editor = createTesinaEditor({
      element: mount,
      content: {
        type: "doc",
        content: [{
          type: NODE_NAMES.sectionBody,
          content: [{
            type: "figure",
            content: [
              {
                type: NODE_NAMES.figureTitle,
                content: [{ type: "text", text: "Fractional overflow" }],
              },
              { type: "figureImage", attrs: { src: "", alt: "proof" } },
              { type: "figureNote" },
            ],
          }],
        }],
      },
      newlyCreated: true,
      citationEnv: { refsById: new Map(), locale: "en" },
      referenceEnv: { references: [], locale: "en", emptyLabel: "unused" },
      paginationEnv: null,
    });
    let figurePos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "figure") figurePos = pos;
      return figurePos < 0;
    });
    const figure = editor.view.nodeDOM(figurePos) as HTMLElement;
    const fractionalContent = document.createElement("span");
    const gap = document.createElement("span");
    gap.dataset["paginationGap"] = "line";
    const misplacedGapPaint = document.createElement("span");
    gap.append(misplacedGapPaint);
    figure.append(gap, fractionalContent);
    const scale = 0.75;
    const canonicalTop = 100;
    let phase: "unpainted" | "painted" | "shrunk" = "unpainted";
    Object.defineProperty(editor.view.dom, "offsetWidth", {
      configurable: true,
      value: 816,
    });
    vi.spyOn(editor.view.dom, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 612, 3_000),
    );
    vi.spyOn(figure, "getBoundingClientRect").mockImplementation(() => {
      const canonicalHeight = phase === "unpainted"
        ? 956.25
        : phase === "painted"
        ? 832
        : 824;
      return new DOMRect(
        0,
        canonicalTop * scale,
        624 * scale,
        canonicalHeight * scale,
      );
    });
    vi.spyOn(gap, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 400 * scale, 624 * scale, 124 * scale),
    );
    vi.spyOn(misplacedGapPaint, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 1_200 * scale, 624 * scale, 28 * scale),
    );
    vi.spyOn(fractionalContent, "getBoundingClientRect")
      .mockImplementation(() => {
        const intrinsicHeight = phase === "shrunk" ? 824 : 956.25;
        const bottom = canonicalTop + intrinsicHeight - figure.scrollTop;
        return new DOMRect(
          0,
          (bottom - 16) * scale,
          624 * scale,
          16 * scale,
        );
      });
    figure.scrollTop = 40;
    Object.defineProperty(figure, "clientHeight", {
      configurable: true,
      get: () => phase === "shrunk" ? 824 : 832,
    });
    Object.defineProperty(figure, "scrollHeight", {
      configurable: true,
      get: () => phase === "shrunk" ? 824 : 832,
    });
    const getComputedStyle = globalThis.getComputedStyle.bind(globalThis);
    const styleSpy = vi.spyOn(globalThis, "getComputedStyle")
      .mockImplementation(
        (element, pseudoElement) =>
          pseudoElement
            ? {
              display: "none",
              content: "none",
            } as CSSStyleDeclaration
            : element === figure
            ? {
              marginTop: "16px",
              marginBottom: "16px",
              borderTopWidth: "0px",
              borderBottomWidth: "0px",
            } as CSSStyleDeclaration
            : getComputedStyle(element),
      );

    try {
      const firstSnapshot = browserPaginationLayoutAdapter.readLayout(
        editor.view,
      );
      const firstPlan = planPagination({
        epoch: 1,
        fragments: firstSnapshot.fragments,
        emptySections: firstSnapshot.emptySections,
      });
      expect(firstPlan.status).toBe("stable");
      if (firstPlan.status !== "stable") {
        throw new Error("expected stable plan");
      }
      expect(firstPlan.overflows).toHaveLength(1);

      phase = "painted";
      figure.dataset["paginationOverflow"] = "atomic";
      for (let pass = 0; pass < 2; pass += 1) {
        const paintedSnapshot = browserPaginationLayoutAdapter.readLayout(
          editor.view,
        );
        const paintedAtomic = paintedSnapshot.fragments.find((fragment) =>
          fragment.id === `figure:${figurePos}`
        );
        expect(paintedAtomic?.height).toBe(864.25);
        const paintedPlan = planPagination({
          epoch: 1,
          fragments: paintedSnapshot.fragments,
          emptySections: paintedSnapshot.emptySections,
        });
        expect(paintedPlan.status).toBe("stable");
        if (paintedPlan.status !== "stable") {
          throw new Error("expected stable plan");
        }
        expect(paintedPlan.overflows).toEqual(firstPlan.overflows);
      }

      phase = "shrunk";
      const shrunkSnapshot = browserPaginationLayoutAdapter.readLayout(
        editor.view,
      );
      const shrunkAtomic = shrunkSnapshot.fragments.find((fragment) =>
        fragment.id === `figure:${figurePos}`
      );
      expect(shrunkAtomic?.height).toBe(732);
      const shrunkPlan = planPagination({
        epoch: 1,
        fragments: shrunkSnapshot.fragments,
        emptySections: shrunkSnapshot.emptySections,
      });
      expect(shrunkPlan.status).toBe("stable");
      if (shrunkPlan.status !== "stable") {
        throw new Error("expected stable plan");
      }
      expect(shrunkPlan.overflows).toEqual([]);
    } finally {
      styleSpy.mockRestore();
      editor.destroy();
      mount.remove();
    }
  });
});

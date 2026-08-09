// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@tiptap/pm/view";
import { createTesinaEditor } from "../createEditor.ts";
import type { PaginationReason } from "./types.ts";
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
          type: "sectionBody",
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
          type: "sectionBody",
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
          type: "sectionBody",
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
});

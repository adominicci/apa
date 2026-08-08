import type { Node as PMNode } from "@tiptap/pm/model";
import { TableMap } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";
import type {
  EmptySection,
  MeasuredFragment,
  PaginationReason,
  RepeatedTableHeader,
  SectionKind,
} from "./types.ts";

export interface MeasureRequest {
  epoch: number;
  signal: AbortSignal;
  latestEpoch(): number;
}

export type MeasurementResult =
  | {
    status: "measured";
    epoch: number;
    fragments: readonly MeasuredFragment[];
    emptySections: readonly EmptySection[];
  }
  | {
    status: "stale";
    epoch: number;
    latestEpoch: number;
  };

export interface PaginationLayoutSnapshot {
  fragments: readonly MeasuredFragment[];
  emptySections: readonly EmptySection[];
}

export interface PaginationLayoutAdapter {
  waitUntilReady(view: EditorView, signal: AbortSignal): Promise<void>;
  readLayout(view: EditorView): PaginationLayoutSnapshot;
  observe(
    view: EditorView,
    onInvalidate: (reason: PaginationReason) => void,
  ): () => void;
}

export interface PaginationMeasurer {
  read(request: MeasureRequest): Promise<MeasurementResult>;
  destroy(): void;
}

export interface PaginationMeasurerOptions {
  view: EditorView;
  onInvalidate(reason: PaginationReason): void;
  adapter?: PaginationLayoutAdapter;
}

interface LineSample {
  top: number;
  bottom: number;
  pos: number;
}

interface LineMeasurement {
  top: number;
  bottom: number;
  pos: number;
}

const GAP_SELECTOR = "[data-pagination-gap], [data-pagination-proof-gap]";
const LINE_TOLERANCE = 0.75;

function staleResult(request: MeasureRequest): MeasurementResult {
  return {
    status: "stale",
    epoch: request.epoch,
    latestEpoch: Math.max(request.latestEpoch(), request.epoch),
  };
}

function isStale(
  request: MeasureRequest,
  destroyed: boolean,
): boolean {
  return destroyed || request.signal.aborted ||
    request.latestEpoch() !== request.epoch;
}

export function createPaginationMeasurer(
  options: PaginationMeasurerOptions,
): PaginationMeasurer {
  const adapter = options.adapter ?? browserPaginationLayoutAdapter;
  let destroyed = false;
  const stopObserving = adapter.observe(options.view, (reason) => {
    if (!destroyed) options.onInvalidate(reason);
  });

  return {
    async read(request) {
      try {
        await adapter.waitUntilReady(options.view, request.signal);
      } catch (error) {
        if (isStale(request, destroyed)) return staleResult(request);
        throw error;
      }
      if (isStale(request, destroyed)) return staleResult(request);
      const snapshot = adapter.readLayout(options.view);
      if (isStale(request, destroyed)) return staleResult(request);
      return {
        status: "measured",
        epoch: request.epoch,
        fragments: snapshot.fragments,
        emptySections: snapshot.emptySections,
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopObserving();
    },
  };
}

function abortPromise(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

async function waitForImage(
  image: HTMLImageElement,
  signal: AbortSignal,
): Promise<void> {
  if (image.complete || signal.aborted) return;
  await new Promise<void>((resolve) => {
    const settle = () => {
      image.removeEventListener("load", settle);
      image.removeEventListener("error", settle);
      signal.removeEventListener("abort", settle);
      resolve();
    };
    image.addEventListener("load", settle, { once: true });
    image.addEventListener("error", settle, { once: true });
    signal.addEventListener("abort", settle, { once: true });
  });
}

async function waitForBrowserInputs(
  view: EditorView,
  signal: AbortSignal,
): Promise<void> {
  const ownerDocument = view.dom.ownerDocument;
  if (ownerDocument.fonts) {
    await Promise.race([
      ownerDocument.fonts.ready.then(() => {}),
      abortPromise(signal),
    ]);
  }
  if (signal.aborted) return;
  await Promise.all(
    [...view.dom.querySelectorAll<HTMLImageElement>("img")].map((image) =>
      waitForImage(image, signal)
    ),
  );
}

function observeBrowserInputs(
  view: EditorView,
  onInvalidate: (reason: PaginationReason) => void,
): () => void {
  const ownerDocument = view.dom.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  let active = true;
  const onAsset = (event: Event) => {
    if (
      active && ownerWindow?.HTMLImageElement &&
      event.target instanceof ownerWindow.HTMLImageElement
    ) {
      onInvalidate("asset");
    }
  };
  view.dom.addEventListener("load", onAsset, true);
  view.dom.addEventListener("error", onAsset, true);

  const ResizeObserverConstructor = ownerWindow?.ResizeObserver ??
    globalThis.ResizeObserver;
  const resizeObserver = typeof ResizeObserverConstructor === "function"
    ? new ResizeObserverConstructor(() => {
      if (active) onInvalidate("asset");
    })
    : undefined;
  resizeObserver?.observe(view.dom);

  ownerDocument.fonts?.ready.then(() => {
    if (active) onInvalidate("font-ready");
  });

  return () => {
    active = false;
    resizeObserver?.disconnect();
    view.dom.removeEventListener("load", onAsset, true);
    view.dom.removeEventListener("error", onAsset, true);
  };
}

function cssNumber(value: string): number {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}

function lineHeight(style: CSSStyleDeclaration, fallback: number): number {
  const exact = cssNumber(style.lineHeight);
  if (exact > 0) return exact;
  const fontSize = cssNumber(style.fontSize);
  return fontSize > 0 ? fontSize * 1.2 : Math.max(1, fallback);
}

function paginationGaps(element: Element): DOMRect[] {
  return [...element.querySelectorAll<HTMLElement>(GAP_SELECTOR)].map((gap) =>
    gap.getBoundingClientRect()
  );
}

function heightWithoutGaps(element: HTMLElement): number {
  const ownerWindow = element.ownerDocument.defaultView;
  if (!ownerWindow) return element.getBoundingClientRect().height;
  const rect = element.getBoundingClientRect();
  const style = ownerWindow.getComputedStyle(element);
  const descendantGapHeight = paginationGaps(element).reduce(
    (total, gap) => total + gap.height,
    0,
  );
  return Math.max(
    0,
    rect.height - descendantGapHeight + cssNumber(style.marginTop) +
      cssNumber(style.marginBottom),
  );
}

function normalizedTop(top: number, gaps: readonly DOMRect[]): number {
  return top - gaps.reduce(
    (total, gap) =>
      gap.bottom <= top + LINE_TOLERANCE ? total + gap.height : total,
    0,
  );
}

function mapDomPosition(
  view: EditorView,
  node: Node,
  offset: number,
  fallback: number,
): number {
  try {
    return view.posAtDOM(node, offset);
  } catch {
    return fallback;
  }
}

function lineMeasurements(
  view: EditorView,
  element: HTMLElement,
  fallbackPos: number,
): LineMeasurement[] {
  const ownerDocument = element.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  const showText = ownerWindow?.NodeFilter.SHOW_TEXT ?? 4;
  const samples: LineSample[] = [];
  const gaps = paginationGaps(element);
  const walker = ownerDocument.createTreeWalker(element, showText);
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current.parentElement?.closest(GAP_SELECTOR)) continue;
    const value = current.nodeValue ?? "";
    for (let offset = 0; offset < value.length; offset += 1) {
      const range = ownerDocument.createRange();
      range.setStart(current, offset);
      range.setEnd(current, offset + 1);
      const rect = range.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const top = normalizedTop(rect.top, gaps);
      samples.push({
        top,
        bottom: top + rect.height,
        pos: mapDomPosition(view, current, offset, fallbackPos + offset),
      });
    }
  }

  const lines: LineMeasurement[] = [];
  for (
    const sample of samples.sort((left, right) =>
      left.top - right.top || left.pos - right.pos
    )
  ) {
    const line = lines.find((entry) =>
      Math.abs(entry.top - sample.top) <= LINE_TOLERANCE
    );
    if (line) {
      line.bottom = Math.max(line.bottom, sample.bottom);
      line.pos = Math.min(line.pos, sample.pos);
    } else {
      lines.push({ ...sample });
    }
  }

  if (lines.length === 0) {
    const rect = element.getBoundingClientRect();
    const style = ownerWindow?.getComputedStyle(element);
    const height = style
      ? lineHeight(style, rect.height)
      : Math.max(1, rect.height);
    return [{
      top: normalizedTop(rect.top, gaps),
      bottom: rect.top + height,
      pos: fallbackPos,
    }];
  }
  return lines.sort((left, right) =>
    left.top - right.top || left.pos - right.pos
  );
}

function sectionKind(node: PMNode): SectionKind | null {
  switch (node.type.name) {
    case "sectionAbstract":
      return "abstract";
    case "sectionBody":
      return "body";
    case "sectionAppendix":
      return "appendix";
    default:
      return null;
  }
}

function elementAt(view: EditorView, pos: number): HTMLElement | null {
  const dom = view.nodeDOM(pos);
  return dom instanceof view.dom.ownerDocument.defaultView!.HTMLElement
    ? dom
    : null;
}

function ancestorPosition(
  doc: PMNode,
  pos: number,
  typeName: string,
): number | null {
  const inside = Math.min(doc.content.size, Math.max(0, pos + 1));
  const resolved = doc.resolve(inside);
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    if (resolved.node(depth).type.name === typeName) {
      return resolved.before(depth);
    }
  }
  return null;
}

function pseudoBlockHeight(element: HTMLElement): number {
  const ownerWindow = element.ownerDocument.defaultView;
  if (!ownerWindow) return 0;
  const style = ownerWindow.getComputedStyle(element, "::before");
  if (
    style.display === "none" || style.content === "none" ||
    style.content === "normal" || style.content === ""
  ) {
    return 0;
  }
  const fallback = lineHeight(style, cssNumber(style.fontSize));
  const firstAuthoredChild = [...element.children].find((child) =>
    !child.matches(GAP_SELECTOR) && child.getAttribute("aria-hidden") !== "true"
  );
  if (!(firstAuthoredChild instanceof ownerWindow.HTMLElement)) {
    return fallback;
  }
  const elementStyle = ownerWindow.getComputedStyle(element);
  const childStyle = ownerWindow.getComputedStyle(firstAuthoredChild);
  const contentTop = element.getBoundingClientRect().top +
    cssNumber(elementStyle.borderTopWidth) + cssNumber(elementStyle.paddingTop);
  const childTop = normalizedTop(
    firstAuthoredChild.getBoundingClientRect().top,
    paginationGaps(element),
  );
  const measured = childTop - contentTop - cssNumber(childStyle.marginTop);
  return Math.max(fallback, measured);
}

function blockFragment(
  id: string,
  pos: number,
  node: PMNode,
  section: SectionKind,
  kind: MeasuredFragment["kind"],
  height: number,
  keepWithNext = false,
): MeasuredFragment {
  return {
    id,
    from: pos,
    to: pos + node.nodeSize,
    section,
    kind,
    height,
    breakBefore: { kind: "block", pos, section },
    ...(keepWithNext ? { keepWithNext: true } : {}),
  };
}

function repeatedTableHeader(
  parent: PMNode | null,
  rowElement: HTMLElement,
): RepeatedTableHeader | undefined {
  if (parent?.type.name !== "table" || parent.childCount < 2) return undefined;
  const headerRow = parent.firstChild;
  if (
    !headerRow || headerRow.childCount === 0 ||
    !Array.from(
      { length: headerRow.childCount },
      (_, index) => headerRow.child(index).type.name === "tableHeader",
    ).every(Boolean)
  ) {
    return undefined;
  }

  const headerElement = rowElement.parentElement?.firstElementChild;
  if (!(headerElement instanceof HTMLElement) || headerElement === rowElement) {
    return undefined;
  }

  return {
    height: heightWithoutGaps(headerElement),
    cells: Array.from({ length: headerRow.childCount }, (_, index) => {
      const cell = headerRow.child(index);
      const colSpan = Number(cell.attrs["colspan"]);
      return {
        text: cell.textContent,
        colSpan: Number.isFinite(colSpan) && colSpan > 0 ? colSpan : 1,
      };
    }),
  };
}

function textFragments(
  view: EditorView,
  node: PMNode,
  pos: number,
  element: HTMLElement,
  section: SectionKind,
  listItemPos: number | null,
): MeasuredFragment[] {
  const lines = lineMeasurements(view, element, pos + 1);
  const ownerWindow = element.ownerDocument.defaultView;
  const style = ownerWindow?.getComputedStyle(element);
  const fallbackLineHeight = style
    ? lineHeight(style, element.getBoundingClientRect().height)
    : 1;
  const groupId = listItemPos === null ? `text:${pos}` : `list:${listItemPos}`;
  const kind = listItemPos === null ? "line" as const : "listItem" as const;
  return lines.map((line, index) => {
    const next = lines[index + 1];
    const height = next
      ? Math.max(0, next.top - line.top)
      : Math.max(fallbackLineHeight, line.bottom - line.top);
    const from = line.pos;
    const to = next?.pos ?? Math.max(from, pos + node.nodeSize - 1);
    return {
      id: `${groupId}:line:${index}`,
      from,
      to,
      section,
      kind,
      height,
      breakBefore: { kind: "line", pos: from, section },
      lineGroup: { id: groupId, index, count: lines.length },
    };
  });
}

function readBrowserLayout(view: EditorView): PaginationLayoutSnapshot {
  const fragments: MeasuredFragment[] = [];
  const emptySections: EmptySection[] = [];
  const doc = view.state.doc;

  doc.forEach((sectionNode, sectionPos) => {
    const section = sectionKind(sectionNode);
    if (!section) return;
    const sectionFragments: MeasuredFragment[] = [];
    const sectionElement = elementAt(view, sectionPos);
    const generatedHeight = sectionElement
      ? pseudoBlockHeight(sectionElement)
      : 0;
    if (generatedHeight > 0) {
      sectionFragments.push({
        id: `section:${sectionPos}:generated-heading`,
        from: sectionPos + 1,
        to: sectionPos + 1,
        section,
        kind: "heading",
        height: generatedHeight,
        breakBefore: { kind: "block", pos: sectionPos + 1, section },
        forcePageStart: true,
        keepWithNext: true,
      });
    }

    sectionNode.descendants((node, relativePos, parent) => {
      const pos = sectionPos + 1 + relativePos;
      const element = elementAt(view, pos);
      if (!element) return true;

      if (node.type.name === "apaTable") {
        const ownerWindow = element.ownerDocument.defaultView;
        const marginTop = ownerWindow
          ? cssNumber(ownerWindow.getComputedStyle(element).marginTop)
          : 0;
        if (marginTop > 0) {
          sectionFragments.push(blockFragment(
            `apaTable:${pos}:margin-top`,
            pos,
            node,
            section,
            "heading",
            marginTop,
            true,
          ));
        }
        return true;
      }

      if (node.type.name === "table") {
        const ownerWindow = element.ownerDocument.defaultView;
        const tableElement = ownerWindow?.HTMLTableElement &&
            element instanceof ownerWindow.HTMLTableElement
          ? element
          : element.querySelector("table");
        if (!tableElement) return true;
        const rowHeight = Array.from(tableElement.rows).reduce(
          (total, row) => total + row.getBoundingClientRect().height,
          0,
        );
        const tableChromeHeight = Math.max(
          0,
          heightWithoutGaps(tableElement) - rowHeight,
        );
        if (tableChromeHeight > 0) {
          sectionFragments.push(blockFragment(
            `table:${pos}:chrome`,
            pos,
            node,
            section,
            "heading",
            tableChromeHeight,
            true,
          ));
        }
        return true;
      }

      if (node.type.name === "figure" || node.type.name === "equationBlock") {
        sectionFragments.push(blockFragment(
          `${node.type.name}:${pos}`,
          pos,
          node,
          section,
          "atomic",
          heightWithoutGaps(element),
        ));
        return false;
      }

      if (node.type.name === "tableRow") {
        const tablePos = ancestorPosition(doc, pos, "apaTable") ?? pos;
        const columnCount = parent?.type.name === "table"
          ? TableMap.get(parent).width
          : node.childCount;
        const repeatedHeader = repeatedTableHeader(parent, element);
        sectionFragments.push({
          id: `table:${tablePos}:row:${pos}`,
          from: pos,
          to: pos + node.nodeSize,
          section,
          kind: "tableRow",
          height: heightWithoutGaps(element),
          breakBefore: { kind: "tableRow", pos, section },
          table: {
            tableId: `table:${tablePos}`,
            columnCount,
            ...(repeatedHeader ? { repeatedHeader } : {}),
          },
        });
        return false;
      }

      if (node.type.name === "heading") {
        // APA levels 4–5 are rendered inline with the following paragraph.
        // Their width already participates in that paragraph's native line
        // geometry, so a second vertical height would count the shared line
        // twice. Keep the zero-height fragment for the pre-heading break and
        // keep-with-next rule.
        const isRunIn = element.hasAttribute("data-apa-run-in");
        sectionFragments.push(blockFragment(
          `heading:${pos}`,
          pos,
          node,
          section,
          "heading",
          isRunIn ? 0 : heightWithoutGaps(element),
          true,
        ));
        return false;
      }

      if (node.type.name === "tableTitle" || node.type.name === "tableNote") {
        const tablePos = ancestorPosition(doc, pos, "apaTable");
        const tableElement = tablePos === null
          ? null
          : elementAt(view, tablePos);
        const ownerWindow = tableElement?.ownerDocument.defaultView;
        const wrapperBottomMargin = node.type.name === "tableNote" &&
            tableElement && ownerWindow
          ? cssNumber(ownerWindow.getComputedStyle(tableElement).marginBottom)
          : 0;
        sectionFragments.push(blockFragment(
          `${node.type.name}:${pos}`,
          pos,
          node,
          section,
          "heading",
          heightWithoutGaps(element) + wrapperBottomMargin,
          node.type.name === "tableTitle",
        ));
        return false;
      }

      if (node.type.name === "paragraph" || node.type.name === "keywordsLine") {
        sectionFragments.push(...textFragments(
          view,
          node,
          pos,
          element,
          section,
          ancestorPosition(doc, pos, "listItem"),
        ));
        return false;
      }

      if (node.isBlock && node.isLeaf) {
        sectionFragments.push(blockFragment(
          `${node.type.name}:${pos}`,
          pos,
          node,
          section,
          "atomic",
          heightWithoutGaps(element),
        ));
        return false;
      }
      return true;
    });

    if (sectionFragments.length === 0) {
      emptySections.push({ section, pos: sectionPos + 1 });
    } else if (!sectionFragments.some((fragment) => fragment.forcePageStart)) {
      sectionFragments[0] = { ...sectionFragments[0]!, forcePageStart: true };
    }
    fragments.push(...sectionFragments);
  });

  return { fragments, emptySections };
}

export const browserPaginationLayoutAdapter: PaginationLayoutAdapter = {
  waitUntilReady: waitForBrowserInputs,
  readLayout: readBrowserLayout,
  observe: observeBrowserInputs,
};

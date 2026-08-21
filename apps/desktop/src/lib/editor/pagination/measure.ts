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
import { LETTER_PRINTABLE_HEIGHT } from "./geometry.ts";
import { NODE_NAMES } from "@tesina/engine";

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
  readinessTimeoutMs?: number;
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

export interface TextLineProbeRect {
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** Browser-backed text-node geometry used to locate exact wrapped line starts. */
export interface TextLineProbe {
  length: number;
  rects(endExclusive: number): readonly TextLineProbeRect[];
  positionAt(offset: number): number;
}

interface LayoutRect {
  top: number;
  bottom: number;
  width: number;
  height: number;
}

const GAP_SELECTOR = "[data-pagination-gap], [data-pagination-proof-gap]";
const LINE_TOLERANCE = 0.75;
export const DEFAULT_PAGINATION_READINESS_TIMEOUT_MS = 5_000;

export function canonicalLayoutScale(
  visualWidth: number,
  layoutWidth: number,
): number {
  if (
    !Number.isFinite(visualWidth) || visualWidth <= 0 ||
    !Number.isFinite(layoutWidth) || layoutWidth <= 0
  ) return 1;
  const scale = visualWidth / layoutWidth;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export function canonicalLayoutLength(value: number, scale: number): number {
  return Number.isFinite(scale) && scale > 0 ? value / scale : value;
}

function canonicalRect(rect: DOMRect, scale: number): LayoutRect {
  return {
    top: canonicalLayoutLength(rect.top, scale),
    bottom: canonicalLayoutLength(rect.bottom, scale),
    width: canonicalLayoutLength(rect.width, scale),
    height: canonicalLayoutLength(rect.height, scale),
  };
}

function browserLayoutScale(element: HTMLElement): number {
  return canonicalLayoutScale(
    element.getBoundingClientRect().width,
    element.offsetWidth,
  );
}

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
  const readinessTimeoutMs = Math.max(
    1,
    options.readinessTimeoutMs ?? DEFAULT_PAGINATION_READINESS_TIMEOUT_MS,
  );
  let destroyed = false;
  const stopObserving = adapter.observe(options.view, (reason) => {
    if (!destroyed) options.onInvalidate(reason);
  });

  return {
    async read(request) {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          adapter.waitUntilReady(options.view, request.signal),
          abortPromise(request.signal),
          new Promise<void>((_resolve, reject) => {
            deadline = setTimeout(
              () =>
                reject(
                  new Error(
                    `Pagination layout inputs did not become ready within ${readinessTimeoutMs}ms`,
                  ),
                ),
              readinessTimeoutMs,
            );
          }),
        ]);
      } catch (error) {
        if (isStale(request, destroyed)) return staleResult(request);
        throw error;
      } finally {
        if (deadline !== undefined) clearTimeout(deadline);
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
  const ResizeObserverConstructor = ownerWindow?.ResizeObserver ??
    globalThis.ResizeObserver;
  const resizeObserver = typeof ResizeObserverConstructor === "function"
    ? new ResizeObserverConstructor(() => {
      if (active) onInvalidate("asset");
    })
    : undefined;
  const observeImage = (image: HTMLImageElement) => {
    resizeObserver?.observe(image);
  };
  const onAsset = (event: Event) => {
    if (
      active && ownerWindow?.HTMLImageElement &&
      event.target instanceof ownerWindow.HTMLImageElement
    ) {
      observeImage(event.target);
      onInvalidate("asset");
    }
  };
  view.dom.addEventListener("load", onAsset, true);
  view.dom.addEventListener("error", onAsset, true);
  view.dom.querySelectorAll<HTMLImageElement>("img").forEach(observeImage);

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

function paginationGaps(element: Element, scale: number): LayoutRect[] {
  return [...element.querySelectorAll<HTMLElement>(GAP_SELECTOR)].map((gap) =>
    canonicalRect(gap.getBoundingClientRect(), scale)
  );
}

function descendantScrollExtent(
  element: HTMLElement,
  rect: LayoutRect,
  scale: number,
): number {
  let bottom = rect.top;
  for (const descendant of element.querySelectorAll<HTMLElement>("*")) {
    if (descendant.closest(GAP_SELECTOR)) continue;
    const descendantRect = canonicalRect(
      descendant.getBoundingClientRect(),
      scale,
    );
    if (descendantRect.width <= 0 || descendantRect.height <= 0) continue;
    bottom = Math.max(bottom, descendantRect.bottom);
  }
  return Math.max(0, bottom - rect.top + element.scrollTop);
}

function heightWithoutGaps(element: HTMLElement, scale: number): number {
  const ownerWindow = element.ownerDocument.defaultView;
  const rect = canonicalRect(element.getBoundingClientRect(), scale);
  if (!ownerWindow) return rect.height;
  const style = ownerWindow.getComputedStyle(element);
  const paintedOverflow = element.dataset["paginationOverflow"];
  const isPaintedOverflow = paintedOverflow === "atomic" ||
    paintedOverflow === "tableRow";
  const borderHeight = cssNumber(style.borderTopWidth) +
    cssNumber(style.borderBottomWidth);
  const intrinsicHeight = isPaintedOverflow
    ? Math.max(
      rect.height,
      element.scrollHeight + borderHeight,
      descendantScrollExtent(element, rect, scale) +
        cssNumber(style.borderBottomWidth),
    )
    : rect.height;
  const descendantGapHeight = paginationGaps(element, scale).reduce(
    (total, gap) => total + gap.height,
    0,
  );
  return Math.max(
    0,
    intrinsicHeight - descendantGapHeight + cssNumber(style.marginTop) +
      cssNumber(style.marginBottom),
  );
}

function normalizedTop(top: number, gaps: readonly LayoutRect[]): number {
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

function visibleProbeRects(
  probe: TextLineProbe,
  endExclusive: number,
): TextLineProbeRect[] {
  return probe.rects(endExclusive).filter((rect) =>
    rect.width > 0 && rect.height > 0
  );
}

function distinctProbeLines(
  rects: readonly TextLineProbeRect[],
): TextLineProbeRect[] {
  const lines: TextLineProbeRect[] = [];
  for (const rect of rects) {
    const line = lines.find((entry) =>
      Math.abs(entry.top - rect.top) <= LINE_TOLERANCE
    );
    if (line) {
      line.bottom = Math.max(line.bottom, rect.bottom);
      line.width += rect.width;
    } else {
      lines.push({ ...rect });
    }
  }
  return lines.sort((left, right) => left.top - right.top);
}

function firstVisibleOffsetForLine(
  probe: TextLineProbe,
  lineTop: number,
  prefixCache: Map<number, readonly TextLineProbeRect[]>,
): number {
  let low = 1;
  let high = probe.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    let rects = prefixCache.get(middle);
    if (!rects) {
      rects = visibleProbeRects(probe, middle);
      prefixCache.set(middle, rects);
    }
    const lastTop = rects.at(-1)?.top;
    if (lastTop === undefined || lastTop < lineTop - LINE_TOLERANCE) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return Math.max(0, low - 1);
}

function mergeLineSamples(
  samples: readonly LineSample[],
): LineMeasurement[] {
  const lines: LineMeasurement[] = [];
  for (
    const sample of [...samples].sort((left, right) =>
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
  return lines;
}

/**
 * Enumerates each text node once, then locates only the first visible
 * character on each wrapped line with cached binary prefix probes.
 */
export function measureTextLineSamples(
  probes: readonly TextLineProbe[],
): LineMeasurement[] {
  const samples: LineSample[] = [];
  for (const probe of probes) {
    if (probe.length <= 0) continue;
    const fullRects = visibleProbeRects(probe, probe.length);
    const lines = distinctProbeLines(fullRects);
    const prefixCache = new Map<number, readonly TextLineProbeRect[]>([
      [probe.length, fullRects],
    ]);
    for (const line of lines) {
      const offset = firstVisibleOffsetForLine(
        probe,
        line.top,
        prefixCache,
      );
      samples.push({
        top: line.top,
        bottom: line.bottom,
        pos: probe.positionAt(offset),
      });
    }
  }

  return mergeLineSamples(samples);
}

function hardBreakLineSamples(
  view: EditorView,
  element: HTMLElement,
  fallbackPos: number,
  fallbackLineHeight: number,
  scale: number,
  gaps: readonly LayoutRect[],
): LineSample[] {
  const samples: LineSample[] = [];
  for (const breakElement of element.querySelectorAll("br")) {
    if (breakElement.closest(GAP_SELECTOR)) continue;
    const parent = breakElement.parentNode;
    if (!parent) continue;
    const offset = [...parent.childNodes].indexOf(breakElement);
    if (offset < 0) continue;
    const rect = canonicalRect(breakElement.getBoundingClientRect(), scale);
    const top = normalizedTop(rect.top, gaps);
    if (!Number.isFinite(top)) continue;
    samples.push({
      top,
      bottom: top + Math.max(rect.height, fallbackLineHeight),
      pos: mapDomPosition(view, parent, offset, fallbackPos),
    });
  }
  return samples;
}

function lineMeasurements(
  view: EditorView,
  element: HTMLElement,
  fallbackPos: number,
  scale: number,
  normalizationElement: Element = element,
): LineMeasurement[] {
  const ownerDocument = element.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  const showText = ownerWindow?.NodeFilter.SHOW_TEXT ?? 4;
  const gaps = paginationGaps(normalizationElement, scale);
  const elementRect = canonicalRect(element.getBoundingClientRect(), scale);
  const style = ownerWindow?.getComputedStyle(element);
  const fallbackLineHeight = style
    ? lineHeight(style, elementRect.height)
    : Math.max(1, elementRect.height);
  const probes: TextLineProbe[] = [];
  const walker = ownerDocument.createTreeWalker(element, showText);
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current.parentElement?.closest(GAP_SELECTOR)) continue;
    const value = current.nodeValue ?? "";
    if (value.length === 0) continue;
    probes.push({
      length: value.length,
      rects(endExclusive) {
        const range = ownerDocument.createRange();
        range.setStart(current, 0);
        range.setEnd(current, Math.min(value.length, endExclusive));
        return [...range.getClientRects()].map((browserRect) => {
          const rect = canonicalRect(browserRect, scale);
          const top = normalizedTop(rect.top, gaps);
          return {
            top,
            bottom: top + rect.height,
            width: rect.width,
            height: rect.height,
          };
        });
      },
      positionAt(offset) {
        return mapDomPosition(view, current, offset, fallbackPos + offset);
      },
    });
  }
  const lines = mergeLineSamples([
    ...measureTextLineSamples(probes),
    ...hardBreakLineSamples(
      view,
      element,
      fallbackPos,
      fallbackLineHeight,
      scale,
      gaps,
    ),
  ]);

  if (lines.length === 0) {
    return [{
      top: normalizedTop(elementRect.top, gaps),
      bottom: elementRect.top + fallbackLineHeight,
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
    case NODE_NAMES.sectionBody:
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

function pseudoBlockHeight(element: HTMLElement, scale: number): number {
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
  const contentTop = canonicalRect(element.getBoundingClientRect(), scale).top +
    cssNumber(elementStyle.borderTopWidth) + cssNumber(elementStyle.paddingTop);
  const childTop = normalizedTop(
    canonicalRect(firstAuthoredChild.getBoundingClientRect(), scale).top,
    paginationGaps(element, scale),
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

/** Named atomic wrappers whose complete visual box moves as one fragment. */
export function createNamedAtomicFragment(
  node: PMNode,
  pos: number,
  section: SectionKind,
  height: number,
): MeasuredFragment | null {
  if (node.type.name !== "figure" && node.type.name !== "apaEquation") {
    return null;
  }
  return blockFragment(
    `${node.type.name}:${pos}`,
    pos,
    node,
    section,
    "atomic",
    height,
  );
}

function repeatedTableHeader(
  parent: PMNode | null,
  rowElement: HTMLElement,
  scale: number,
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
    height: heightWithoutGaps(headerElement, scale),
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
  scale: number,
  groupPrefix = "text",
): MeasuredFragment[] {
  const lines = lineMeasurements(view, element, pos + 1, scale);
  const ownerWindow = element.ownerDocument.defaultView;
  const style = ownerWindow?.getComputedStyle(element);
  const fallbackLineHeight = style
    ? lineHeight(
      style,
      canonicalRect(element.getBoundingClientRect(), scale).height,
    )
    : 1;
  const groupId = listItemPos === null
    ? `${groupPrefix}:${pos}`
    : `list:${listItemPos}:text:${pos}`;
  const kind = listItemPos === null ? "line" as const : "listItem" as const;
  const fragments = measuredLineFragments(
    node,
    pos,
    section,
    groupId,
    kind,
    lines,
    fallbackLineHeight,
  );
  return fragments;
}

function measuredLineFragments(
  node: PMNode,
  pos: number,
  section: SectionKind,
  groupId: string,
  kind: "line" | "listItem",
  lines: readonly LineMeasurement[],
  fallbackLineHeight: number,
): MeasuredFragment[] {
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

function runInHeadingFragments(
  view: EditorView,
  node: PMNode,
  pos: number,
  element: HTMLElement,
  section: SectionKind,
  scale: number,
): MeasuredFragment[] {
  const normalizationElement = element.parentElement ?? element;
  const headingLines = lineMeasurements(
    view,
    element,
    pos + 1,
    scale,
    normalizationElement,
  );
  let paragraphElement = element.nextElementSibling;
  while (
    paragraphElement &&
    (paragraphElement.matches(GAP_SELECTOR) ||
      paragraphElement.getAttribute("aria-hidden") === "true")
  ) {
    paragraphElement = paragraphElement.nextElementSibling;
  }
  const ownerWindow = element.ownerDocument.defaultView;
  const paragraphLines = ownerWindow?.HTMLElement &&
      paragraphElement instanceof ownerWindow.HTMLElement &&
      paragraphElement.tagName === "P"
    ? lineMeasurements(
      view,
      paragraphElement,
      pos + node.nodeSize + 1,
      scale,
      normalizationElement,
    )
    : [];
  const paragraphFirstTop = paragraphLines[0]?.top;
  const headingOnlyLines = paragraphFirstTop === undefined
    ? headingLines
    : headingLines.filter((line) =>
      line.top < paragraphFirstTop - LINE_TOLERANCE
    );
  if (headingOnlyLines.length === 0) {
    return [blockFragment(
      `heading:${pos}`,
      pos,
      node,
      section,
      "heading",
      0,
      true,
    )];
  }
  const style = ownerWindow?.getComputedStyle(element);
  const fallbackLineHeight = style
    ? lineHeight(
      style,
      canonicalRect(element.getBoundingClientRect(), scale).height,
    )
    : 1;
  const fragments = measuredLineFragments(
    node,
    pos,
    section,
    `runInHeading:${pos}`,
    "line",
    headingOnlyLines,
    fallbackLineHeight,
  );
  return fragments.map((fragment, index) =>
    index === fragments.length - 1
      ? {
        ...fragment,
        kind: "heading" as const,
        lineGroup: undefined,
        keepWithNext: true,
      }
      : {
        ...fragment,
        lineGroup: fragment.lineGroup
          ? { ...fragment.lineGroup, count: fragments.length - 1 }
          : undefined,
      }
  );
}

function paginatedTextBlockFragments(
  view: EditorView,
  node: PMNode,
  pos: number,
  element: HTMLElement,
  section: SectionKind,
  scale: number,
  totalHeight: number,
): MeasuredFragment[] {
  const typeName = node.type.name;
  const keepWholeWithNext = typeName === NODE_NAMES.tableTitle;
  if (totalHeight <= LETTER_PRINTABLE_HEIGHT) {
    return [blockFragment(
      `${typeName}:${pos}`,
      pos,
      node,
      section,
      "heading",
      totalHeight,
      keepWholeWithNext,
    )];
  }

  const lines = textFragments(
    view,
    node,
    pos,
    element,
    section,
    null,
    scale,
    typeName,
  );
  const ownerWindow = element.ownerDocument.defaultView;
  const style = ownerWindow?.getComputedStyle(element);
  const beforeHeight = Math.max(
    0,
    (style ? cssNumber(style.marginTop) : 0) +
      (typeName === NODE_NAMES.tableTitle
        ? pseudoBlockHeight(element, scale)
        : 0),
  );
  const lineHeight = lines.reduce(
    (total, fragment) =>
      total +
      (Number.isFinite(fragment.height) ? Math.max(0, fragment.height) : 0),
    0,
  );
  const afterHeight = Math.max(0, totalHeight - beforeHeight - lineHeight);
  const fragments: MeasuredFragment[] = [];
  if (beforeHeight > 0) {
    fragments.push(blockFragment(
      `${typeName}:${pos}:before-lines`,
      pos,
      node,
      section,
      "heading",
      beforeHeight,
      true,
    ));
  }
  fragments.push(...lines);
  if (afterHeight > 0) {
    const endPos = Math.max(pos, pos + node.nodeSize - 1);
    fragments.push({
      id: `${typeName}:${pos}:after-lines`,
      from: endPos,
      to: endPos,
      section,
      kind: "heading",
      height: afterHeight,
      breakBefore: { kind: "block", pos: endPos, section },
      ...(keepWholeWithNext ? { keepWithNext: true } : {}),
    });
  }
  return fragments;
}

const MARGIN_COLLAPSING_BLOCKS = new Set([
  NODE_NAMES.apaTable,
  "figure",
  "apaEquation",
]);

function collapsedVerticalMargin(first: number, second: number): number {
  return Math.max(0, first, second) + Math.min(0, first, second);
}

function collapseAdjacentAtomicMargins(
  view: EditorView,
  sectionNode: PMNode,
  sectionPos: number,
  fragments: MeasuredFragment[],
): void {
  let previousBottomMargin: number | null = null;
  sectionNode.forEach((node, offset) => {
    if (!MARGIN_COLLAPSING_BLOCKS.has(node.type.name)) {
      previousBottomMargin = null;
      return;
    }
    const pos = sectionPos + 1 + offset;
    const element = elementAt(view, pos);
    const ownerWindow = element?.ownerDocument.defaultView;
    if (!element || !ownerWindow) {
      previousBottomMargin = null;
      return;
    }
    const style = ownerWindow.getComputedStyle(element);
    const topMargin = cssNumber(style.marginTop);
    const bottomMargin = cssNumber(style.marginBottom);
    if (previousBottomMargin !== null) {
      // Each block measurement already owns both of its margins. Adjacent
      // vertical margins collapse in native layout, so assign the shared
      // margin to the previous block and remove only the duplicated portion
      // from the current block's first fragment.
      const duplicatedMargin = previousBottomMargin + topMargin -
        collapsedVerticalMargin(previousBottomMargin, topMargin);
      const fragmentIndex = fragments.findIndex((fragment) =>
        fragment.from >= pos && fragment.to <= pos + node.nodeSize
      );
      if (fragmentIndex >= 0 && duplicatedMargin !== 0) {
        const fragment = fragments[fragmentIndex]!;
        fragments[fragmentIndex] = {
          ...fragment,
          height: Math.max(0, fragment.height - duplicatedMargin),
        };
      }
    }
    previousBottomMargin = bottomMargin;
  });
}

function readBrowserLayout(view: EditorView): PaginationLayoutSnapshot {
  const fragments: MeasuredFragment[] = [];
  const emptySections: EmptySection[] = [];
  const doc = view.state.doc;
  const scale = browserLayoutScale(view.dom);

  doc.forEach((sectionNode, sectionPos) => {
    const section = sectionKind(sectionNode);
    if (!section) return;
    const sectionFragments: MeasuredFragment[] = [];
    const sectionElement = elementAt(view, sectionPos);
    const generatedHeight = sectionElement
      ? pseudoBlockHeight(sectionElement, scale)
      : 0;
    if (generatedHeight > 0) {
      sectionFragments.push({
        id: `section:${sectionPos}:generated-heading`,
        from: sectionPos,
        to: sectionPos,
        section,
        kind: "heading",
        height: generatedHeight,
        breakBefore: { kind: "block", pos: sectionPos, section },
        forcePageStart: true,
        keepWithNext: true,
      });
    }

    sectionNode.descendants((node, relativePos, parent) => {
      const pos = sectionPos + 1 + relativePos;
      const element = elementAt(view, pos);
      if (!element) return true;

      if (node.type.name === NODE_NAMES.apaTable) {
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
        const rowHeight = Array.from(tableElement.rows)
          .filter((row) => !row.matches(GAP_SELECTOR))
          .reduce(
            (total, row) =>
              total + canonicalRect(row.getBoundingClientRect(), scale).height,
            0,
          );
        const tableChromeHeight = Math.max(
          0,
          heightWithoutGaps(tableElement, scale) - rowHeight,
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

      const namedAtomicFragment = createNamedAtomicFragment(
        node,
        pos,
        section,
        heightWithoutGaps(element, scale),
      );
      if (namedAtomicFragment) {
        sectionFragments.push(namedAtomicFragment);
        return false;
      }

      if (node.type.name === "tableRow") {
        const tablePos = ancestorPosition(doc, pos, NODE_NAMES.apaTable) ?? pos;
        const columnCount = parent?.type.name === "table"
          ? TableMap.get(parent).width
          : node.childCount;
        const repeatedHeader = repeatedTableHeader(parent, element, scale);
        sectionFragments.push({
          id: `table:${tablePos}:row:${pos}`,
          from: pos,
          to: pos + node.nodeSize,
          section,
          kind: "tableRow",
          height: heightWithoutGaps(element, scale),
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
        sectionFragments.push(
          ...isRunIn
            ? runInHeadingFragments(
              view,
              node,
              pos,
              element,
              section,
              scale,
            )
            : paginatedTextBlockFragments(
              view,
              node,
              pos,
              element,
              section,
              scale,
              heightWithoutGaps(element, scale),
            ),
        );
        return false;
      }

      if (
        node.type.name === NODE_NAMES.tableTitle ||
        node.type.name === "tableNote"
      ) {
        const tablePos = ancestorPosition(doc, pos, NODE_NAMES.apaTable);
        const tableElement = tablePos === null
          ? null
          : elementAt(view, tablePos);
        const ownerWindow = tableElement?.ownerDocument.defaultView;
        const wrapperBottomMargin = node.type.name === "tableNote" &&
            tableElement && ownerWindow
          ? cssNumber(ownerWindow.getComputedStyle(tableElement).marginBottom)
          : 0;
        sectionFragments.push(...paginatedTextBlockFragments(
          view,
          node,
          pos,
          element,
          section,
          scale,
          heightWithoutGaps(element, scale) + wrapperBottomMargin,
        ));
        return false;
      }

      if (
        node.type.name === "paragraph" ||
        node.type.name === NODE_NAMES.keywordsLine
      ) {
        sectionFragments.push(...textFragments(
          view,
          node,
          pos,
          element,
          section,
          ancestorPosition(doc, pos, "listItem"),
          scale,
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
          heightWithoutGaps(element, scale),
        ));
        return false;
      }
      return true;
    });

    collapseAdjacentAtomicMargins(
      view,
      sectionNode,
      sectionPos,
      sectionFragments,
    );

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

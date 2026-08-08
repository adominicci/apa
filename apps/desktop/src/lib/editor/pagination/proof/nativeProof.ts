import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { createTesinaEditor } from "../../createEditor.ts";
import { insertCitation } from "../../citation.ts";
import {
  createPaginationMeasurer,
  type PaginationMeasurer,
} from "../measure.ts";
import type { MeasuredFragment, RepeatedTableHeader } from "../types.ts";
import { createLongDocumentFixtures } from "./longDocumentFixture.ts";
import {
  createDisposablePaginationProofPlugin,
  disposablePaginationProofKey,
  type DisposablePaginationProofPlan,
  setDisposablePaginationProofPlan,
} from "./disposablePaginationProof.ts";
import {
  createNativeProofBridge,
  type NativeProofBridgeScope,
} from "./nativeBridge.ts";
import { startProofPageWatchdog } from "./proofPageWatchdog.ts";
import "./nativeProof.css";

interface ProofResult {
  passed: boolean;
  engine: string;
  checks: Record<string, boolean>;
  metrics: Record<string, number | string>;
  error?: string;
}

const nativeBridge = createNativeProofBridge(
  globalThis as unknown as NativeProofBridgeScope,
);

function diagnostic(stage: string, detail: Record<string, unknown> = {}): void {
  nativeBridge.postDiagnostic({
    stage,
    ...detail,
  });
}

diagnostic("module-start", { readyState: document.readyState });

let frameIndex = 0;
const frame = (action?: () => void) =>
  new Promise<void>((resolve) => {
    const index = ++frameIndex;
    diagnostic("frame-request", {
      index,
      visibilityState: document.visibilityState,
    });
    requestAnimationFrame(() => {
      action?.();
      diagnostic("frame-resolve", {
        index,
        visibilityState: document.visibilityState,
      });
      resolve();
    });
  });

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing proof element: ${selector}`);
  return element;
}

function positionOfParagraph(doc: PMNode, needle: string): number {
  const result = maybePositionOfParagraph(doc, needle);
  if (result === null) throw new Error(`Paragraph not found: ${needle}`);
  return result;
}

function maybePositionOfParagraph(doc: PMNode, needle: string): number | null {
  let result: number | null = null;
  doc.descendants((node, pos) => {
    if (result !== null) return false;
    if (node.type.name === "paragraph" && node.textContent.includes(needle)) {
      result = pos;
      return false;
    }
    return true;
  });
  return result;
}

function positionsOf(doc: PMNode, type: string): number[] {
  const result: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === type) result.push(pos);
    return true;
  });
  return result;
}

function sameRepeatedHeader(
  left: RepeatedTableHeader | undefined,
  right: RepeatedTableHeader | undefined,
): boolean {
  if (!left || !right) return left === right;
  return Math.abs(left.height - right.height) < 0.5 &&
    left.cells.length === right.cells.length &&
    left.cells.every((cell, index) => {
      const other = right.cells[index];
      return cell.text === other?.text && cell.colSpan === other.colSpan;
    });
}

function sameTableFragmentMetrics(
  left: readonly MeasuredFragment[],
  right: readonly MeasuredFragment[],
): boolean {
  return left.length === right.length && left.every((fragment, index) => {
    const other = right[index];
    if (!other) return false;
    const sameTable = !fragment.table || !other.table
      ? fragment.table === other.table
      : fragment.table.tableId === other.table.tableId &&
        fragment.table.columnCount === other.table.columnCount &&
        sameRepeatedHeader(
          fragment.table.repeatedHeader,
          other.table.repeatedHeader,
        );
    return fragment.id === other.id && fragment.from === other.from &&
      fragment.to === other.to && fragment.section === other.section &&
      fragment.kind === other.kind &&
      Math.abs(fragment.height - other.height) < 0.5 &&
      fragment.breakBefore.kind === other.breakBefore.kind &&
      fragment.breakBefore.pos === other.breakBefore.pos && sameTable;
  });
}

function textHasMarkBetween(
  doc: PMNode,
  from: number,
  to: number,
  markName: string,
): boolean {
  let sawText = false;
  let everyTextHasMark = true;
  doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return true;
    sawText = true;
    if (!node.marks.some((mark) => mark.type.name === markName)) {
      everyTextHasMark = false;
    }
    return true;
  });
  return sawText && everyTextHasMark;
}

function deriveTrailingFigurePlan(
  doc: PMNode,
  epoch: number,
): DisposablePaginationProofPlan {
  const figures = positionsOf(doc, "figure");
  return {
    epoch,
    gaps: figures.length > 1
      ? [{ kind: "block", pos: figures[1]!, height: 180 }]
      : [],
  };
}

function closeEnough(left: DOMRect, right: DOMRect): boolean {
  return Math.abs(left.top - right.top) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5 &&
    Math.abs(left.width - right.width) < 0.5;
}

interface LayoutSnapshot {
  body: DOMRect;
  gap: DOMRect;
  documentHeight: number;
  resizeRevision: number;
}

function captureLayout(
  body: HTMLElement,
  gap: HTMLElement,
  resizeRevision = 0,
): LayoutSnapshot {
  return {
    body: body.getBoundingClientRect(),
    gap: gap.getBoundingClientRect(),
    documentHeight: document.documentElement.scrollHeight,
    resizeRevision,
  };
}

function sameLayout(left: LayoutSnapshot, right: LayoutSnapshot): boolean {
  return closeEnough(left.body, right.body) &&
    closeEnough(left.gap, right.gap) &&
    left.documentHeight === right.documentHeight &&
    left.resizeRevision === right.resizeRevision;
}

async function waitForCondition(
  description: string,
  condition: () => boolean,
  maxFrames = 120,
): Promise<number> {
  for (let frames = 0; frames <= maxFrames; frames += 1) {
    if (condition()) return frames;
    await frame();
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function waitForStableLayout(
  body: HTMLElement,
  gap: HTMLElement,
  readResizeRevision: () => number = () => 0,
  consecutiveStableFrames = 3,
  maxFrames = 120,
): Promise<{ snapshot: LayoutSnapshot; frames: number }> {
  let previous = captureLayout(body, gap, readResizeRevision());
  let stableFrames = 0;
  for (let frames = 1; frames <= maxFrames; frames += 1) {
    await frame();
    const current = captureLayout(body, gap, readResizeRevision());
    stableFrames = sameLayout(previous, current) ? stableFrames + 1 : 0;
    if (stableFrames >= consecutiveStableFrames) {
      return { snapshot: current, frames };
    }
    previous = current;
  }
  throw new Error("Layout did not stabilize before the native proof deadline");
}

async function waitForStableMeasurement(
  description: string,
  measure: () => number,
  consecutiveStableFrames = 3,
  maxFrames = 120,
): Promise<{ value: number; frames: number }> {
  let previous = measure();
  let stableFrames = 0;
  for (let frames = 1; frames <= maxFrames; frames += 1) {
    await frame();
    const current = measure();
    stableFrames = Math.abs(previous - current) < 0.5 ? stableFrames + 1 : 0;
    if (stableFrames >= consecutiveStableFrames) {
      return { value: current, frames };
    }
    previous = current;
  }
  throw new Error(`${description} did not stabilize`);
}

function domSelectionPosition(editor: Editor): number | null {
  const selection = document.getSelection();
  if (!selection?.focusNode) return null;
  try {
    return editor.view.posAtDOM(selection.focusNode, selection.focusOffset);
  } catch {
    return null;
  }
}

async function runProof(): Promise<ProofResult> {
  diagnostic("proof-start");
  const fixture = createLongDocumentFixtures().en;
  diagnostic("fixture-created");
  const mount = requireElement<HTMLElement>("#proof-mount");
  const shell = requireElement<HTMLElement>("#proof-shell");
  shell.style.setProperty(
    "--body-title",
    JSON.stringify(
      "A Synthetic Archive Study of Community Seed Records, Seasonal Rainfall, Volunteer Checks, Envelope Labels, and Long-Term Planning Across Several Invented Coastal Districts",
    ),
  );
  const editor = createTesinaEditor({
    element: mount,
    content: fixture.content,
    newlyCreated: true,
    citationEnv: {
      refsById: new Map(
        fixture.references.map((reference) => [reference.id, reference]),
      ),
      locale: "en",
    },
    referenceEnv: {
      references: fixture.references,
      locale: "en",
      emptyLabel: "unused",
    },
  });
  diagnostic("editor-created");
  editor.registerPlugin(createDisposablePaginationProofPlugin());
  diagnostic("proof-plugin-registered");
  let paginationMeasurer: PaginationMeasurer | undefined;

  try {
    diagnostic("fonts-wait", { status: document.fonts.status });
    await document.fonts.ready;
    diagnostic("fonts-ready", { status: document.fonts.status });
    const resourceWaitFrames = await waitForCondition(
      "the document and fonts to finish loading",
      () =>
        document.readyState === "complete" &&
        document.fonts.status === "loaded" &&
        [...document.images].every((image) => image.complete),
    );
    diagnostic("initial-layout-inputs-ready", { resourceWaitFrames });
    const initialJson = JSON.stringify(editor.getJSON());
    const paragraphPos = positionOfParagraph(
      editor.state.doc,
      "Invented paragraph 1",
    );
    paginationMeasurer = createPaginationMeasurer({
      view: editor.view,
      onInvalidate: (reason) =>
        diagnostic("measurement-invalidated", { reason }),
    });
    const initialMeasurement = await paginationMeasurer.read({
      epoch: 1,
      signal: new AbortController().signal,
      latestEpoch: () => 1,
    });
    if (initialMeasurement.status !== "measured") {
      throw new Error("Initial production measurement was stale");
    }
    const paragraphLines = initialMeasurement.fragments.filter((fragment) =>
      fragment.lineGroup?.id === `text:${paragraphPos}`
    );
    const tableFragments = initialMeasurement.fragments.filter((fragment) =>
      fragment.kind === "tableRow"
    );
    const repeatedTableHeader = tableFragments[1]?.table?.repeatedHeader;
    const bodySectionPos = positionsOf(editor.state.doc, "sectionBody")[0]!;
    const bodySection = editor.view.nodeDOM(bodySectionPos) as HTMLElement;
    const firstBodyBlock = [...bodySection.children].find((child) =>
      !child.matches("[data-pagination-gap], [data-pagination-proof-gap]")
    ) as HTMLElement | undefined;
    if (!firstBodyBlock) throw new Error("Body section has no authored block");
    const bodySectionStyle = getComputedStyle(bodySection);
    const firstBodyBlockStyle = getComputedStyle(firstBodyBlock);
    const bodyContentTop = bodySection.getBoundingClientRect().top +
      Number.parseFloat(bodySectionStyle.borderTopWidth) +
      Number.parseFloat(bodySectionStyle.paddingTop);
    const generatedHeadingVisualHeight =
      firstBodyBlock.getBoundingClientRect().top - bodyContentTop -
      Number.parseFloat(firstBodyBlockStyle.marginTop);
    const generatedHeadingMeasuredHeight = initialMeasurement.fragments.find(
      (fragment) =>
        fragment.id === `section:${bodySectionPos}:generated-heading`,
    )?.height ?? 0;
    const generatedHeadingMeasurementMatchesVisualSpan = Math.abs(
      generatedHeadingMeasuredHeight - generatedHeadingVisualHeight,
    ) < 0.5;
    const firstTablePos = positionsOf(editor.state.doc, "apaTable")[0]!;
    const firstTableNode = editor.state.doc.nodeAt(firstTablePos)!;
    const firstTable = editor.view.nodeDOM(firstTablePos) as HTMLElement;
    const firstTableStyle = getComputedStyle(firstTable);
    const firstTableVisualHeight = firstTable.getBoundingClientRect().height +
      Number.parseFloat(firstTableStyle.marginTop) +
      Number.parseFloat(firstTableStyle.marginBottom);
    const firstTableFragments = initialMeasurement.fragments.filter(
      (fragment) =>
        fragment.from >= firstTablePos &&
        fragment.to <= firstTablePos + firstTableNode.nodeSize,
    );
    const firstTableMeasuredHeight = firstTableFragments.reduce(
      (total, fragment) => total + fragment.height,
      0,
    );
    const tableWrapperMarginsMeasured = Math.abs(
      firstTableMeasuredHeight - firstTableVisualHeight,
    ) < 0.5;
    const runInHeadingPos = positionsOf(editor.state.doc, "heading")[0]!;
    const runInBodyPos = positionOfParagraph(
      editor.state.doc,
      "Each volunteer checked the oldest packet first",
    );
    const runInHeading = editor.view.nodeDOM(runInHeadingPos) as HTMLElement;
    const runInBody = editor.view.nodeDOM(runInBodyPos) as HTMLElement;
    const runInLineTops = [
      ...Array.from(runInHeading.getClientRects()),
      ...Array.from(runInBody.getClientRects()),
    ].map((rect) => rect.top).sort((left, right) => left - right).filter(
      (top, index, tops) => index === 0 || Math.abs(top - tops[index - 1]!) > 1,
    );
    const runInLineHeight = Number.parseFloat(
      getComputedStyle(runInBody).lineHeight,
    );
    // Inline client rects expose glyph ink rather than their line boxes. Count
    // the distinct native line positions, then apply the native line-height.
    const runInVisualHeight = runInLineTops.length * runInLineHeight;
    const measuredRunInHeight = initialMeasurement.fragments.filter(
      (fragment) =>
        fragment.id === `heading:${runInHeadingPos}` ||
        fragment.lineGroup?.id === `text:${runInBodyPos}`,
    ).reduce((total, fragment) => total + fragment.height, 0);
    const runInMeasurementMatchesVisualSpan = Math.abs(
      measuredRunInHeight - runInVisualHeight,
    ) < 0.5;
    const equationPos = positionsOf(editor.state.doc, "apaEquation")[0]!;
    const adjacentFigurePos = positionsOf(editor.state.doc, "figure")[1]!;
    const equationNode = editor.state.doc.nodeAt(equationPos)!;
    const adjacentFigureNode = editor.state.doc.nodeAt(adjacentFigurePos)!;
    const equationElement = editor.view.nodeDOM(equationPos) as HTMLElement;
    const adjacentFigureElement = editor.view.nodeDOM(
      adjacentFigurePos,
    ) as HTMLElement;
    const equationRect = equationElement.getBoundingClientRect();
    const adjacentFigureRect = adjacentFigureElement.getBoundingClientRect();
    const equationStyle = getComputedStyle(equationElement);
    const adjacentFigureStyle = getComputedStyle(adjacentFigureElement);
    const adjacentAtomicVisualAdvance = adjacentFigureRect.bottom +
      Number.parseFloat(adjacentFigureStyle.marginBottom) -
      (equationRect.top - Number.parseFloat(equationStyle.marginTop));
    const adjacentAtomicMeasuredAdvance = initialMeasurement.fragments.filter(
      (fragment) =>
        fragment.from >= equationPos &&
        fragment.to <= adjacentFigurePos + adjacentFigureNode.nodeSize,
    ).reduce((total, fragment) => total + fragment.height, 0);
    const adjacentAtomicMarginsMeasuredOnce =
      equationPos + equationNode.nodeSize === adjacentFigurePos &&
      equationElement.nextElementSibling === adjacentFigureElement &&
      Math.abs(
          adjacentAtomicMeasuredAdvance - adjacentAtomicVisualAdvance,
        ) < 0.5;
    const starts = paragraphLines.map((fragment) => fragment.breakBefore.pos);
    if (starts.length < 4) {
      throw new Error(
        `Expected at least four measured paragraph lines, got ${starts.length}`,
      );
    }
    const lineGapPos = starts[3]!;
    setDisposablePaginationProofPlan(editor, {
      epoch: 1,
      gaps: [{ kind: "line", pos: lineGapPos, height: 180 }],
    });
    const gapWaitFrames = await waitForCondition(
      "the first derived line-gap plan",
      () => !!document.querySelector("[data-pagination-proof-gap='line']"),
    );
    const lineGap = requireElement<HTMLElement>(
      "[data-pagination-proof-gap='line']",
    );
    const body = requireElement<HTMLElement>("[data-sec='body']");
    let resizeRevision = 0;
    const resizeObserver = new ResizeObserver(() => resizeRevision += 1);
    resizeObserver.observe(shell);
    resizeObserver.observe(body);
    resizeObserver.observe(lineGap);
    const hiddenStableLayout = await waitForStableLayout(
      body,
      lineGap,
      () => resizeRevision,
    );
    const normalizedMeasurement = await paginationMeasurer.read({
      epoch: 2,
      signal: new AbortController().signal,
      latestEpoch: () => 2,
    });
    if (normalizedMeasurement.status !== "measured") {
      throw new Error("Normalized production measurement was stale");
    }
    const normalizedParagraphLines = normalizedMeasurement.fragments.filter(
      (fragment) => fragment.lineGroup?.id === `text:${paragraphPos}`,
    );
    const existingDecorationsNormalized =
      normalizedParagraphLines.length === paragraphLines.length &&
      normalizedParagraphLines.every((fragment, index) => {
        const before = paragraphLines[index];
        return before?.from === fragment.from && before.to === fragment.to &&
          Math.abs(before.height - fragment.height) < 0.5;
      });
    const firstPlannedGap = hiddenStableLayout.snapshot.gap;
    const lineGapParentTag = lineGap.parentElement?.tagName ?? "none";
    const lineGapInsideParagraph = lineGapParentTag === "P";
    const resizeRevisionAtReveal = resizeRevision;
    await frame(() => shell.dataset["firstPlan"] = "stable");

    // Sampling in the frame after reveal observes the geometry used by the
    // first visible paint. Readiness itself is condition-based above/below.
    await frame();
    const firstVisibleLayout = captureLayout(body, lineGap, resizeRevision);
    const visibleStableLayout = await waitForStableLayout(
      body,
      lineGap,
      () => resizeRevision,
    );
    const conditionalFirstPaint = document.visibilityState === "visible" &&
      getComputedStyle(shell).visibility === "visible" &&
      firstVisibleLayout.resizeRevision === resizeRevisionAtReveal &&
      visibleStableLayout.snapshot.resizeRevision === resizeRevisionAtReveal &&
      sameLayout(hiddenStableLayout.snapshot, firstVisibleLayout) &&
      sameLayout(firstVisibleLayout, visibleStableLayout.snapshot);
    resizeObserver.disconnect();

    const beforeCaret = editor.view.coordsAtPos(lineGapPos - 1);
    const afterCaret = editor.view.coordsAtPos(lineGapPos + 1);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, lineGapPos - 2),
      ),
    );
    editor.view.focus();
    await waitForCondition(
      "a collapsed DOM caret immediately before the line gap",
      () => {
        const domSelection = document.getSelection();
        const pos = domSelectionPosition(editor);
        return domSelection?.isCollapsed === true && pos !== null &&
          pos < lineGapPos;
      },
    );
    const selectionToMove = document.getSelection();
    if (!selectionToMove || typeof selectionToMove.modify !== "function") {
      throw new Error("WKWebView Selection.modify is unavailable");
    }
    const caretStartPos = domSelectionPosition(editor);
    let caretMoveCount = 0;
    let caretAfterTraversal = caretStartPos;
    while (
      caretAfterTraversal !== null && caretAfterTraversal <= lineGapPos &&
      caretMoveCount < 12
    ) {
      selectionToMove.modify("move", "forward", "character");
      caretMoveCount += 1;
      await frame();
      caretAfterTraversal = domSelectionPosition(editor);
    }
    await waitForCondition(
      "ProseMirror to observe the DOM caret beyond the line gap",
      () =>
        editor.state.selection.empty &&
        editor.state.selection.head > lineGapPos,
      30,
    );
    const caretAfterTraversalCoords = editor.view.coordsAtPos(
      editor.state.selection.head,
    );
    const nativeInputPosition = editor.state.selection.head;
    const caretStayedFocused = editor.view.hasFocus();
    const caretEndpointInAuthoredText = editor.state.doc.resolve(
      nativeInputPosition,
    ).parent.inlineContent;
    const beforeNativeInputJson = JSON.stringify(editor.getJSON());
    let nativeInputEventCount = 0;
    const recordNativeInput = (event: Event) => {
      if (
        event instanceof InputEvent && event.inputType === "insertText" &&
        event.data === "Q"
      ) {
        nativeInputEventCount += 1;
      }
    };
    editor.view.dom.addEventListener("input", recordNativeInput);
    const nativeInputAccepted = document.execCommand(
      "insertText",
      false,
      "Q",
    );
    await waitForCondition(
      "native contenteditable input to update the ProseMirror document",
      () => JSON.stringify(editor.getJSON()) !== beforeNativeInputJson,
      30,
    );
    editor.view.dom.removeEventListener("input", recordNativeInput);
    const nativeInputChangedJson = JSON.stringify(editor.getJSON()) !==
      beforeNativeInputJson;
    const nativeInputInsertedAtTraversal = editor.state.doc.textBetween(
      nativeInputPosition,
      nativeInputPosition + 1,
      "",
      "",
    ) === "Q";
    const nativeCaretAfterInputPosition = editor.state.selection.head;
    const nativeInputUndoAccepted = editor.commands.undo();
    await waitForCondition(
      "one undo to restore the native input",
      () => JSON.stringify(editor.getJSON()) === beforeNativeInputJson,
      30,
    );
    const nativeInputUndoRestored = JSON.stringify(editor.getJSON()) ===
      beforeNativeInputJson;

    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, lineGapPos - 6, lineGapPos + 6),
      ),
    );
    editor.view.focus();
    await waitForCondition(
      "the DOM selection spanning the line gap",
      () => document.getSelection()?.isCollapsed === false,
      30,
    );
    const domSelection = document.getSelection();
    const expectedSelection = editor.state.doc.textBetween(
      lineGapPos - 6,
      lineGapPos + 6,
      "",
      "",
    );
    const selectionAcrossGapProven =
      editor.state.selection.from === lineGapPos - 6 &&
      editor.state.selection.to === lineGapPos + 6 &&
      domSelection?.isCollapsed === false &&
      domSelection.toString() === expectedSelection;
    diagnostic("selection-snapshot", {
      stateFrom: editor.state.selection.from,
      stateTo: editor.state.selection.to,
      expectedSelection,
      domCollapsed: domSelection?.isCollapsed ?? null,
      domText: domSelection?.toString() ?? null,
      selectionAcrossGapProven,
    });

    const beforeFormattingJson = JSON.stringify(editor.getJSON());
    const formattingAccepted = editor.chain().focus().toggleBold().run();
    const formattingAppliedAcrossGap = textHasMarkBetween(
      editor.state.doc,
      lineGapPos - 6,
      lineGapPos + 6,
      "bold",
    );
    const formattingUndoAccepted = editor.commands.undo();
    const formattingUndoRestored = JSON.stringify(editor.getJSON()) ===
      beforeFormattingJson;
    const formattingRedoAccepted = editor.commands.redo();
    const formattingRedoRestored = textHasMarkBetween(
      editor.state.doc,
      lineGapPos - 6,
      lineGapPos + 6,
      "bold",
    );
    const formattingFinalUndoAccepted = editor.commands.undo();
    const formattingFinalUndoRestored = JSON.stringify(editor.getJSON()) ===
      beforeFormattingJson;

    const beforeCitationJson = JSON.stringify(editor.getJSON());
    const citationsBeforeInsert = positionsOf(editor.state.doc, "citation")
      .length;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, lineGapPos + 3),
      ),
    );
    insertCitation(editor, {
      items: [{ refId: "proof-ref-1" }],
      mode: "parenthetical",
    });
    const citationPositionsAfterInsert = positionsOf(
      editor.state.doc,
      "citation",
    );
    const citationInsertedBeyondGap =
      citationPositionsAfterInsert.length === citationsBeforeInsert + 1 &&
      citationPositionsAfterInsert.some((pos) => pos > lineGapPos);
    const citationUndoAccepted = editor.commands.undo();
    const citationUndoRestored = JSON.stringify(editor.getJSON()) ===
      beforeCitationJson;

    const paragraphPositions = positionsOf(editor.state.doc, "paragraph");
    const scrollParagraphPos = paragraphPositions.at(-1)!;
    const scrollParagraph = editor.state.doc.nodeAt(scrollParagraphPos);
    const scrollTargetPos = scrollParagraphPos + Math.max(
      1,
      (scrollParagraph?.content.size ?? 1) - 1,
    );
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, scrollTargetPos),
      ).scrollIntoView(),
    );
    await waitForCondition(
      "scroll-to-caret to reveal the authored target",
      () => {
        const coords = editor.view.coordsAtPos(scrollTargetPos);
        return editor.state.selection.head === scrollTargetPos &&
          coords.top >= 0 && coords.bottom <= globalThis.innerHeight;
      },
      30,
    );
    const scrolledCaretCoords = editor.view.coordsAtPos(scrollTargetPos);
    const scrollToCaretProven = globalThis.scrollY > 0 &&
      scrolledCaretCoords.top >= 0 &&
      scrolledCaretCoords.bottom <= globalThis.innerHeight;

    const beforeUndoJson = JSON.stringify(editor.getJSON());
    editor.view.dispatch(editor.state.tr.insertText("Z", lineGapPos + 2));
    setDisposablePaginationProofPlan(editor, {
      epoch: 2,
      gaps: [{ kind: "line", pos: lineGapPos, height: 180 }],
    });
    const undoAccepted = editor.commands.undo();
    const afterUndoJson = JSON.stringify(editor.getJSON());

    const rowPositions = positionsOf(editor.state.doc, "tableRow");
    setDisposablePaginationProofPlan(editor, {
      epoch: 3,
      gaps: [{
        kind: "tableRow",
        pos: rowPositions[3]!,
        height: 180,
        columns: 3,
      }],
    });
    await frame();
    const gapRow = requireElement<HTMLTableRowElement>(
      "tr[data-pagination-proof-gap='tableRow']",
    );
    const rowBefore = gapRow.previousElementSibling?.getBoundingClientRect();
    const rowAfter = gapRow.nextElementSibling?.getBoundingClientRect();
    const tableGapParentTag = gapRow.parentElement?.tagName ?? "none";
    const tableGapPreviousTag = gapRow.previousElementSibling?.tagName ??
      "none";
    const tableGapNextTag = gapRow.nextElementSibling?.tagName ?? "none";
    const validTableRowStructure = tableGapParentTag === "TBODY" &&
      gapRow.cells.length === 1 && gapRow.cells[0]?.colSpan === 3;
    const tableGapMeasurement = await paginationMeasurer.read({
      epoch: 3,
      signal: new AbortController().signal,
      latestEpoch: () => 3,
    });
    if (tableGapMeasurement.status !== "measured") {
      throw new Error("Table-gap production measurement was stale");
    }
    const tableGapFragments = tableGapMeasurement.fragments.filter(
      (fragment) =>
        fragment.from >= firstTablePos &&
        fragment.to <= firstTablePos + firstTableNode.nodeSize,
    );
    const tableGapMeasurementsNormalized = sameTableFragmentMetrics(
      firstTableFragments,
      tableGapFragments,
    );

    const figurePos = positionsOf(editor.state.doc, "figure")[0]!;
    setDisposablePaginationProofPlan(editor, {
      epoch: 4,
      gaps: [{ kind: "block", pos: figurePos, height: 180 }],
    });
    await frame();
    const blockGap = requireElement<HTMLElement>(
      "[data-pagination-proof-gap='block']",
    );
    const figure = requireElement<HTMLElement>("[data-apa-figure]");
    const blockGapRect = blockGap.getBoundingClientRect();
    const figureRect = figure.getBoundingClientRect();
    const figureGapParentTag = blockGap.parentElement?.tagName ?? "none";
    const figureGapNextTag = blockGap.nextElementSibling?.tagName ?? "none";
    const atomicFigureStructure = blockGap.nextElementSibling === figure &&
      figure.querySelectorAll(".fig-img").length === 1;

    let deletionReplanCount = 0;
    let authoredMutationPhase: "delete" | "undo" | null = null;
    let mappedGapCountAfterDeletion = -1;
    let postDeleteDerivedGapCount = -1;
    let postUndoDerivedGapCount = -1;
    editor.on("transaction", ({ transaction }) => {
      if (authoredMutationPhase !== "delete" || !transaction.docChanged) {
        return;
      }
      mappedGapCountAfterDeletion =
        disposablePaginationProofKey.getState(editor.state)?.gaps.length ?? -1;
    });
    const replanTrailingFigure = () => {
      if (authoredMutationPhase === null) return;
      deletionReplanCount += 1;
      const derivedPlan = deriveTrailingFigurePlan(
        editor.state.doc,
        5 + deletionReplanCount,
      );
      if (authoredMutationPhase === "delete") {
        postDeleteDerivedGapCount = derivedPlan.gaps.length;
      } else {
        postUndoDerivedGapCount = derivedPlan.gaps.length;
      }
      setDisposablePaginationProofPlan(editor, derivedPlan);
    };
    editor.on("update", replanTrailingFigure);

    const trailingFigurePos = positionsOf(editor.state.doc, "figure")[1]!;
    const trailingFigure = editor.state.doc.nodeAt(trailingFigurePos);
    if (trailingFigure?.type.name !== "figure") {
      throw new Error("The trailing authored figure was not found");
    }
    const initialTrailingPlan = deriveTrailingFigurePlan(editor.state.doc, 5);
    setDisposablePaginationProofPlan(editor, initialTrailingPlan);
    await waitForCondition(
      "the trailing-page gap before the final authored figure",
      () => !!document.querySelector("[data-pagination-proof-gap='block']"),
    );
    const beforeDeletionJson = JSON.stringify(editor.getJSON());
    const heightWithTrailingPage = await waitForStableMeasurement(
      "the body height with its trailing page",
      () => body.getBoundingClientRect().height,
    );

    authoredMutationPhase = "delete";
    editor.view.dispatch(
      editor.state.tr.delete(
        trailingFigurePos,
        trailingFigurePos + trailingFigure.nodeSize,
      ),
    );
    authoredMutationPhase = null;
    await waitForCondition(
      "derived replanning to remove the empty trailing-page gap",
      () =>
        deletionReplanCount === 1 && postDeleteDerivedGapCount === 0 &&
        !document.querySelector("[data-pagination-proof-gap]"),
    );
    const trailingGapRemovedAfterDelete = !document.querySelector(
      "[data-pagination-proof-gap]",
    );
    const afterDeletionJson = JSON.stringify(editor.getJSON());
    const figuresAfterDeletion = positionsOf(editor.state.doc, "figure")
      .length;
    const heightWithoutTrailingPage = await waitForStableMeasurement(
      "the body height after authored deletion and replanning",
      () => body.getBoundingClientRect().height,
    );
    authoredMutationPhase = "undo";
    const deletionUndoAccepted = editor.commands.undo();
    authoredMutationPhase = null;
    await waitForCondition(
      "one undo to restore the authored trailing figure and its derived gap",
      () =>
        JSON.stringify(editor.getJSON()) === beforeDeletionJson &&
        postUndoDerivedGapCount === 1 &&
        !!document.querySelector("[data-pagination-proof-gap='block']"),
      30,
    );
    const deletionUndoRestored = JSON.stringify(editor.getJSON()) ===
      beforeDeletionJson;
    const trailingGapRestoredAfterUndo = !!document.querySelector(
      "[data-pagination-proof-gap='block']",
    );
    editor.off("update", replanTrailingFigure);

    const checks = {
      productionDomMapping: initialMeasurement.fragments.some((fragment) =>
        fragment.id.startsWith("section:") && fragment.kind === "heading" &&
        fragment.height > 0
      ) &&
        paragraphLines.every((fragment) =>
          fragment.from >= paragraphPos &&
          fragment.to <= paragraphPos +
              (editor.state.doc.nodeAt(paragraphPos)?.nodeSize ?? 0)
        ) &&
        initialMeasurement.fragments.filter((fragment) =>
            fragment.kind === "listItem"
          ).length >= 3 &&
        initialMeasurement.fragments.filter((fragment) =>
            fragment.kind === "tableRow"
          ).length === positionsOf(editor.state.doc, "tableRow").length &&
        initialMeasurement.fragments.filter((fragment) =>
            fragment.id.startsWith("figure:") && fragment.kind === "atomic"
          ).length === positionsOf(editor.state.doc, "figure").length &&
        initialMeasurement.fragments.filter((fragment) =>
            fragment.id.startsWith("apaEquation:") &&
            fragment.kind === "atomic"
          ).length === positionsOf(editor.state.doc, "apaEquation").length,
      generatedSectionHeadingMeasured:
        generatedHeadingMeasurementMatchesVisualSpan,
      tableWrapperMarginsMeasured,
      adjacentAtomicMarginsMeasuredOnce,
      runInHeadingMeasuredOnce: runInMeasurementMatchesVisualSpan,
      tableContinuationHeaderMeasured:
        tableFragments[0]?.table?.repeatedHeader === undefined &&
        repeatedTableHeader !== undefined && repeatedTableHeader.height > 0 &&
        repeatedTableHeader.cells.map((cell) =>
            cell.text
          ).join("|") ===
          "Round|Cards|Envelopes" &&
        repeatedTableHeader.cells.reduce(
            (columns, cell) => columns + cell.colSpan,
            0,
          ) === 3,
      existingDecorationsNormalized,
      tableGapMeasurementsNormalized,
      authoredDeletionReflow: initialTrailingPlan.gaps.length === 1 &&
        deletionReplanCount === 2 && mappedGapCountAfterDeletion === 1 &&
        postDeleteDerivedGapCount === 0 && trailingGapRemovedAfterDelete &&
        afterDeletionJson !== beforeDeletionJson &&
        figuresAfterDeletion === 1 &&
        positionsOf(editor.state.doc, "figure").length === 2 &&
        postUndoDerivedGapCount === 1 && trailingGapRestoredAfterUndo &&
        deletionUndoAccepted && deletionUndoRestored &&
        heightWithTrailingPage.value - heightWithoutTrailingPage.value >= 170,
      caretInputTraversal: caretStartPos !== null &&
        caretStartPos < lineGapPos &&
        caretAfterTraversal !== null && caretAfterTraversal > lineGapPos &&
        caretAfterTraversalCoords.top >= firstPlannedGap.bottom &&
        caretMoveCount > 0 && caretStayedFocused &&
        caretEndpointInAuthoredText && nativeInputAccepted &&
        nativeInputEventCount >= 1 && nativeInputChangedJson &&
        nativeInputInsertedAtTraversal &&
        nativeCaretAfterInputPosition === nativeInputPosition + 1 &&
        nativeInputUndoAccepted && nativeInputUndoRestored,
      conditionalFirstPaint,
      oneEditorView: document.querySelectorAll(".ProseMirror").length === 1,
      derivedJsonIdentity: JSON.stringify(editor.getJSON()) === initialJson,
      lineLevelContinuation: lineGapInsideParagraph &&
        afterCaret.top - beforeCaret.bottom >= 170,
      caretAcrossGap: beforeCaret.top < firstPlannedGap.top &&
        afterCaret.top >= firstPlannedGap.bottom,
      selectionAcrossGap: selectionAcrossGapProven,
      formattingAcrossGap: formattingAccepted &&
        formattingAppliedAcrossGap && formattingUndoAccepted &&
        formattingUndoRestored && formattingRedoAccepted &&
        formattingRedoRestored && formattingFinalUndoAccepted &&
        formattingFinalUndoRestored,
      citationAcrossGap: citationInsertedBeyondGap && citationUndoAccepted &&
        citationUndoRestored,
      scrollToCaret: scrollToCaretProven,
      oneStepUndo: undoAccepted && afterUndoJson === beforeUndoJson,
      validTableRowGap: validTableRowStructure &&
        !!rowBefore && !!rowAfter && rowAfter.top - rowBefore.bottom >= 170,
      atomicFigureMovement: atomicFigureStructure &&
        figureRect.top >= blockGapRect.bottom &&
        figure.querySelectorAll(".fig-img").length === 1,
      trailingPageRemoval: trailingGapRemovedAfterDelete &&
        heightWithTrailingPage.value - heightWithoutTrailingPage.value >= 170,
      stableFirstPaint: conditionalFirstPaint,
      visualGapIsReal: firstPlannedGap.height >= 179 &&
        firstPlannedGap.width >= 815,
    };
    const passed = Object.values(checks).every(Boolean);
    return {
      passed,
      engine: navigator.userAgent,
      checks,
      metrics: {
        measuredParagraphLines: starts.length,
        measuredFragments: initialMeasurement.fragments.length,
        measuredListLines: initialMeasurement.fragments.filter((fragment) =>
          fragment.kind === "listItem"
        ).length,
        measuredTableRows: initialMeasurement.fragments.filter((fragment) =>
          fragment.kind === "tableRow"
        ).length,
        measuredFigures: initialMeasurement.fragments.filter((fragment) =>
          fragment.id.startsWith("figure:")
        ).length,
        measuredEquations: initialMeasurement.fragments.filter((fragment) =>
          fragment.id.startsWith("apaEquation:")
        ).length,
        generatedHeadingVisualHeight,
        generatedHeadingMeasuredHeight,
        firstTableVisualHeight,
        firstTableMeasuredHeight,
        adjacentAtomicVisualAdvance,
        adjacentAtomicMeasuredAdvance,
        measuredRunInHeight,
        runInVisualHeight,
        repeatedTableHeaderHeight: repeatedTableHeader?.height ?? 0,
        resourceWaitFrames,
        gapWaitFrames,
        hiddenStableFrames: hiddenStableLayout.frames,
        visibleStableFrames: visibleStableLayout.frames,
        resizeRevisionAtReveal,
        resizeRevisionAtFirstVisiblePaint: firstVisibleLayout.resizeRevision,
        resizeRevisionAtVisibleStability:
          visibleStableLayout.snapshot.resizeRevision,
        lineGapPosition: lineGapPos,
        caretVerticalSeparation: afterCaret.top - beforeCaret.bottom,
        caretStartPosition: caretStartPos ?? -1,
        caretAfterTraversalPosition: caretAfterTraversal ?? -1,
        caretMoveCount,
        scrollTargetPosition: scrollTargetPos,
        scrollTargetTop: scrolledCaretCoords.top,
        scrollY: globalThis.scrollY,
        caretAfterTraversalTop: caretAfterTraversalCoords.top,
        nativeInputAccepted: String(nativeInputAccepted),
        nativeInputEventCount,
        nativeInputPosition,
        nativeCaretAfterInputPosition,
        lineGapHeight: firstPlannedGap.height,
        lineGapParentTag,
        tableGapSeparation: rowBefore && rowAfter
          ? rowAfter.top - rowBefore.bottom
          : -1,
        tableGapParentTag,
        tableGapCells: gapRow.cells.length,
        tableGapColSpan: gapRow.cells[0]?.colSpan ?? -1,
        tableGapPreviousTag,
        tableGapNextTag,
        tableGapHtml: gapRow.outerHTML,
        figureHeight: figureRect.height,
        figureGapParentTag,
        figureGapNextTag,
        figureImageCount: figure.querySelectorAll(".fig-img").length,
        figureGapBottom: blockGapRect.bottom,
        figureTop: figureRect.top,
        deletionReplanCount,
        mappedGapCountAfterDeletion,
        postDeleteDerivedGapCount,
        postUndoDerivedGapCount,
        figuresAfterDeletion,
        trailingHeightWithPage: heightWithTrailingPage.value,
        trailingHeightWithoutPage: heightWithoutTrailingPage.value,
        trailingHeightRemoved: heightWithTrailingPage.value -
          heightWithoutTrailingPage.value,
        trailingPlanStableFrames: heightWithTrailingPage.frames,
        trailingReflowStableFrames: heightWithoutTrailingPage.frames,
      },
      ...(passed ? {} : { error: "One or more WKWebView proof checks failed" }),
    };
  } finally {
    paginationMeasurer?.destroy();
    editor.destroy();
  }
}

const resultElement = requireElement<HTMLElement>("#proof-result");
let proofFinished = false;
const watchdog = startProofPageWatchdog(45_000, () => {
  finishProof({
    passed: false,
    engine: navigator.userAgent,
    checks: {},
    metrics: {},
    error: "Pagination proof page watchdog expired",
  });
});

function finishProof(result: ProofResult): void {
  if (proofFinished) return;
  proofFinished = true;
  watchdog.cancel();
  resultElement.textContent = JSON.stringify(result, null, 2);
  nativeBridge.postResult(result);
}

runProof().then((result) => {
  diagnostic("proof-result", { passed: result.passed });
  finishProof(result);
}).catch((error: unknown) => {
  diagnostic("proof-catch", {
    error: error instanceof Error ? error.message : String(error),
  });
  const result: ProofResult = {
    passed: false,
    engine: navigator.userAgent,
    checks: {},
    metrics: {},
    error: error instanceof Error
      ? `${error.message}\n${error.stack ?? ""}`
      : String(error),
  };
  finishProof(result);
});

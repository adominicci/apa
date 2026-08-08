import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { createTesinaEditor } from "../../createEditor.ts";
import { createLongDocumentFixtures } from "./longDocumentFixture.ts";
import {
  createDisposablePaginationProofPlugin,
  disposablePaginationProofKey,
  type DisposablePaginationProofPlan,
  setDisposablePaginationProofPlan,
} from "./disposablePaginationProof.ts";
import "./nativeProof.css";

interface ProofResult {
  passed: boolean;
  engine: string;
  checks: Record<string, boolean>;
  metrics: Record<string, number | string>;
  error?: string;
}

const bridge = globalThis as typeof globalThis & {
  webkit?: {
    messageHandlers?: {
      tesinaProof?: { postMessage(value: ProofResult): void };
      tesinaDiagnostic?: {
        postMessage(value: Record<string, unknown>): void;
      };
    };
  };
};

function diagnostic(stage: string, detail: Record<string, unknown> = {}): void {
  bridge.webkit?.messageHandlers?.tesinaDiagnostic?.postMessage({
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

function lineStarts(editor: Editor, paragraphPos: number): number[] {
  const paragraph = editor.view.nodeDOM(paragraphPos);
  if (!(paragraph instanceof HTMLElement)) {
    throw new Error("Paragraph DOM was not measurable");
  }
  const starts = new Map<number, number>();
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const value = text.nodeValue ?? "";
    for (let offset = 0; offset < value.length; offset += 1) {
      const range = document.createRange();
      range.setStart(text, offset);
      range.setEnd(text, offset + 1);
      const rect = range.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const top = Math.round(rect.top * 10) / 10;
      const pos = editor.view.posAtDOM(text, offset);
      const existing = starts.get(top);
      if (existing === undefined || pos < existing) starts.set(top, pos);
    }
  }
  return [...starts.entries()].sort((a, b) => a[0] - b[0]).map((entry) =>
    entry[1]
  );
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
    const starts = lineStarts(editor, paragraphPos);
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
    editor.destroy();
  }
}

const resultElement = requireElement<HTMLElement>("#proof-result");
runProof().then((result) => {
  diagnostic("proof-result", { passed: result.passed });
  resultElement.textContent = JSON.stringify(result, null, 2);
  bridge.webkit?.messageHandlers?.tesinaProof?.postMessage(result);
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
  resultElement.textContent = JSON.stringify(result, null, 2);
  bridge.webkit?.messageHandlers?.tesinaProof?.postMessage(result);
});

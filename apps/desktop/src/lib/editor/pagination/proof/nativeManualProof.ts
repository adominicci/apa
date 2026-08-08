import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { createTesinaEditor } from "../../createEditor.ts";
import { createPaginationMeasurer } from "../measure.ts";
import {
  createDisposablePaginationProofPlugin,
  setDisposablePaginationProofPlan,
} from "./disposablePaginationProof.ts";
import { createLongDocumentFixtures } from "./longDocumentFixture.ts";
import {
  createNativeProofBridge,
  type NativeProofBridgeScope,
} from "./nativeBridge.ts";
import { startProofPageWatchdog } from "./proofPageWatchdog.ts";
import "./nativeManualProof.css";

const nativeBridge = createNativeProofBridge(
  globalThis as unknown as NativeProofBridgeScope,
);
const shell = requireElement<HTMLElement>("#proof-shell");
const mount = requireElement<HTMLElement>("#proof-mount");
const instructions = requireElement<HTMLElement>("#manual-instructions");
const finishButton = requireElement<HTMLButtonElement>("#manual-finish");
const resultElement = requireElement<HTMLElement>("#proof-result");

interface ManualEvidence {
  compositionStarts: number;
  compositionEnds: number;
  copies: number;
  pastes: number;
  mouseDragAcrossGap: boolean;
  selectedText: string;
}

const evidence: ManualEvidence = {
  compositionStarts: 0,
  compositionEnds: 0,
  copies: 0,
  pastes: 0,
  mouseDragAcrossGap: false,
  selectedText: "",
};
let editor: Editor | undefined;
let gapPos = -1;
let mouseDown = false;
let finished = false;

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing manual-proof element: ${selector}`);
  return element;
}

function positionOfParagraph(doc: PMNode, needle: string): number {
  let result = -1;
  doc.descendants((node, pos) => {
    if (result >= 0) return false;
    if (node.type.name === "paragraph" && node.textContent.includes(needle)) {
      result = pos;
      return false;
    }
    return true;
  });
  if (result < 0) throw new Error(`Missing manual-proof paragraph: ${needle}`);
  return result;
}

function domPosition(node: Node | null, offset: number): number | null {
  if (!editor || !node) return null;
  try {
    return editor.view.posAtDOM(node, offset);
  } catch {
    return null;
  }
}

function updateStatus(): void {
  const status = {
    ime: evidence.compositionStarts > 0 && evidence.compositionEnds > 0,
    copy: evidence.copies > 0,
    paste: evidence.pastes > 0,
    drag: evidence.mouseDragAcrossGap,
  };
  for (const [name, passed] of Object.entries(status)) {
    const element = requireElement<HTMLElement>(`#manual-${name}`);
    element.dataset["passed"] = String(passed);
    element.textContent = `${element.textContent?.split(":")[0]}: ${
      passed ? "captured" : "pending"
    }`;
  }
  finishButton.disabled = !Object.values(status).every(Boolean);
}

function inspectMouseSelection(): void {
  if (!mouseDown || gapPos < 0) return;
  mouseDown = false;
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed) return;
  const anchor = domPosition(selection.anchorNode, selection.anchorOffset);
  const focus = domPosition(selection.focusNode, selection.focusOffset);
  if (anchor === null || focus === null) return;
  evidence.mouseDragAcrossGap = Math.min(anchor, focus) < gapPos &&
    Math.max(anchor, focus) > gapPos;
  if (evidence.mouseDragAcrossGap) evidence.selectedText = selection.toString();
  updateStatus();
}

document.addEventListener("compositionstart", () => {
  evidence.compositionStarts += 1;
  updateStatus();
}, true);
document.addEventListener("compositionend", () => {
  evidence.compositionEnds += 1;
  updateStatus();
}, true);
document.addEventListener("copy", () => {
  evidence.copies += 1;
  updateStatus();
}, true);
document.addEventListener("paste", () => {
  evidence.pastes += 1;
  updateStatus();
}, true);
document.addEventListener("mousedown", () => mouseDown = true, true);
document.addEventListener("mouseup", inspectMouseSelection, true);

const watchdog = startProofPageWatchdog(240_000, () => {
  finish(false, "Manual native-input evidence timed out");
});

function finish(passed: boolean, error?: string): void {
  if (finished) return;
  finished = true;
  watchdog.cancel();
  const result = {
    passed,
    engine: navigator.userAgent,
    checks: {
      nativeImeComposition: evidence.compositionStarts > 0 &&
        evidence.compositionEnds > 0,
      nativeClipboard: evidence.copies > 0 && evidence.pastes > 0,
      nativeMouseDragAcrossGap: evidence.mouseDragAcrossGap,
    },
    metrics: {
      compositionStarts: evidence.compositionStarts,
      compositionEnds: evidence.compositionEnds,
      copies: evidence.copies,
      pastes: evidence.pastes,
      selectedTextLength: evidence.selectedText.length,
      gapPosition: gapPos,
    },
    ...(error ? { error } : {}),
  };
  resultElement.textContent = JSON.stringify(result, null, 2);
  nativeBridge.postResult(result);
}

finishButton.addEventListener("click", () => finish(true));

async function prepare(): Promise<void> {
  const fixture = createLongDocumentFixtures().en;
  editor = createTesinaEditor({
    element: mount,
    content: fixture.content,
    newlyCreated: true,
    citationEnv: {
      refsById: new Map(fixture.references.map((ref) => [ref.id, ref])),
      locale: "en",
    },
    referenceEnv: {
      references: fixture.references,
      locale: "en",
      emptyLabel: "unused",
    },
  });
  editor.registerPlugin(createDisposablePaginationProofPlugin());
  const paragraphPos = positionOfParagraph(
    editor.state.doc,
    "Invented paragraph 1",
  );
  const measurer = createPaginationMeasurer({
    view: editor.view,
    onInvalidate: () => {},
  });
  try {
    const measurement = await measurer.read({
      epoch: 1,
      signal: new AbortController().signal,
      latestEpoch: () => 1,
    });
    if (measurement.status !== "measured") {
      throw new Error("Manual native measurement became stale");
    }
    const lines = measurement.fragments.filter((fragment) =>
      fragment.lineGroup?.id === `text:${paragraphPos}`
    );
    if (lines.length < 3) throw new Error("Manual paragraph has too few lines");
    gapPos = lines[2]!.breakBefore.pos;
    setDisposablePaginationProofPlan(editor, {
      epoch: 1,
      gaps: [{ kind: "line", pos: gapPos, height: 180 }],
    });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve())
    );
    shell.dataset["firstPlan"] = "stable";
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, gapPos - 2),
      ).scrollIntoView(),
    );
    editor.view.focus();
    requireElement<HTMLElement>("[data-pagination-proof-gap='line']")
      .scrollIntoView({ block: "center" });
    instructions.textContent =
      "Drag across the gray page gap, copy and paste, then enter a composed character (for example Option-E then E).";
    document.body.dataset["manualReady"] = "true";
    updateStatus();
  } finally {
    measurer.destroy();
  }
}

prepare().catch((error: unknown) => {
  finish(false, error instanceof Error ? error.message : String(error));
});

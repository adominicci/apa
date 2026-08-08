export interface NativeManualEvidence {
  mouseDown: boolean;
  selectionFrom: number | null;
  selectionTo: number | null;
  gapPosition: number | null;
  selectedText: string;
  copies: number;
  copyDocumentSize: number | null;
  pastes: number;
  pastedText: string;
  pasteBeforeSize: number | null;
  pasteAfterSize: number | null;
  deadKeys: number;
  composingKeys: number;
  compositionStarts: number;
  compositionUpdates: number;
  compositionEnds: number;
  compositionBeforeSize: number | null;
  compositionAfterSize: number | null;
  compositionData: string;
}

export type NativeManualEvidenceEvent =
  | { kind: "mouse-down"; isTrusted: boolean }
  | {
    kind: "mouse-up";
    isTrusted: boolean;
    selectionFrom: number;
    selectionTo: number;
    gapPosition: number;
    selectedText: string;
  }
  | {
    kind: "copy";
    isTrusted: boolean;
    selectedText: string;
    documentSize: number;
  }
  | {
    kind: "paste";
    isTrusted: boolean;
    pastedText: string;
    beforeSize: number;
    afterSize: number;
  }
  | {
    kind: "key-down";
    isTrusted: boolean;
    key: string;
    isComposing: boolean;
  }
  | {
    kind: "composition-start";
    isTrusted: boolean;
    beforeSize: number;
  }
  | { kind: "composition-update"; isTrusted: boolean }
  | {
    kind: "composition-end";
    isTrusted: boolean;
    data: string;
    afterSize: number;
  };

export type NativeManualEvidenceMode = "human" | "windows-driven";

export interface NativeManualChecks {
  ime: boolean;
  copy: boolean;
  paste: boolean;
  drag: boolean;
}

export function createNativeManualEvidence(): NativeManualEvidence {
  return {
    mouseDown: false,
    selectionFrom: null,
    selectionTo: null,
    gapPosition: null,
    selectedText: "",
    copies: 0,
    copyDocumentSize: null,
    pastes: 0,
    pastedText: "",
    pasteBeforeSize: null,
    pasteAfterSize: null,
    deadKeys: 0,
    composingKeys: 0,
    compositionStarts: 0,
    compositionUpdates: 0,
    compositionEnds: 0,
    compositionBeforeSize: null,
    compositionAfterSize: null,
    compositionData: "",
  };
}

function validSize(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

export function recordNativeManualEvidence(
  evidence: NativeManualEvidence,
  event: NativeManualEvidenceEvent,
): NativeManualEvidence {
  if (!event.isTrusted) return evidence;
  switch (event.kind) {
    case "mouse-down":
      return { ...evidence, mouseDown: true };
    case "mouse-up": {
      if (!evidence.mouseDown || event.selectedText.length === 0) {
        return { ...evidence, mouseDown: false };
      }
      const selectionFrom = Math.min(event.selectionFrom, event.selectionTo);
      const selectionTo = Math.max(event.selectionFrom, event.selectionTo);
      if (
        !(selectionFrom < event.gapPosition && event.gapPosition < selectionTo)
      ) {
        return { ...evidence, mouseDown: false };
      }
      return {
        ...evidence,
        mouseDown: false,
        selectionFrom,
        selectionTo,
        gapPosition: event.gapPosition,
        selectedText: event.selectedText,
      };
    }
    case "copy":
      if (
        evidence.selectedText.length === 0 ||
        event.selectedText !== evidence.selectedText ||
        !validSize(event.documentSize)
      ) return evidence;
      return {
        ...evidence,
        copies: evidence.copies + 1,
        copyDocumentSize: event.documentSize,
      };
    case "paste":
      if (evidence.copies === 0) return evidence;
      return {
        ...evidence,
        pastes: evidence.pastes + 1,
        pastedText: event.pastedText,
        pasteBeforeSize: event.beforeSize,
        pasteAfterSize: event.afterSize,
      };
    case "key-down":
      return {
        ...evidence,
        deadKeys: evidence.deadKeys + (event.key === "Dead" ? 1 : 0),
        composingKeys: evidence.composingKeys + (event.isComposing ? 1 : 0),
      };
    case "composition-start":
      if (!validSize(event.beforeSize)) return evidence;
      return {
        ...evidence,
        compositionStarts: evidence.compositionStarts + 1,
        compositionBeforeSize: event.beforeSize,
      };
    case "composition-update":
      if (evidence.compositionStarts <= evidence.compositionEnds) {
        return evidence;
      }
      return {
        ...evidence,
        compositionUpdates: evidence.compositionUpdates + 1,
      };
    case "composition-end":
      if (
        evidence.compositionStarts <= evidence.compositionEnds ||
        evidence.compositionBeforeSize === null ||
        event.data.length === 0 ||
        event.afterSize <= evidence.compositionBeforeSize
      ) return evidence;
      return {
        ...evidence,
        compositionEnds: evidence.compositionEnds + 1,
        compositionAfterSize: event.afterSize,
        compositionData: event.data,
      };
  }
}

export function nativeManualChecks(
  evidence: NativeManualEvidence,
  mode: NativeManualEvidenceMode,
): NativeManualChecks {
  const drag = evidence.selectionFrom !== null &&
    evidence.selectionTo !== null &&
    evidence.gapPosition !== null &&
    evidence.selectionFrom < evidence.gapPosition &&
    evidence.gapPosition < evidence.selectionTo &&
    evidence.selectedText.length > 0;
  const copy = drag && evidence.copies > 0;
  const humanPaste = copy && evidence.pastes > 0;
  const drivenPaste = humanPaste &&
    evidence.pastedText === evidence.selectedText &&
    evidence.copyDocumentSize === evidence.pasteBeforeSize &&
    evidence.pasteBeforeSize !== null &&
    evidence.pasteAfterSize !== null &&
    evidence.pasteAfterSize - evidence.pasteBeforeSize ===
      evidence.pastedText.length;
  const humanIme = evidence.compositionStarts > 0 &&
    evidence.compositionEnds > 0 &&
    evidence.compositionBeforeSize !== null &&
    evidence.compositionAfterSize !== null &&
    evidence.compositionAfterSize > evidence.compositionBeforeSize;
  const ime = mode === "human"
    ? humanIme
    : humanIme && evidence.compositionUpdates > 0 &&
      evidence.deadKeys > 0 && evidence.composingKeys > 0 &&
      evidence.compositionData === "é" &&
      evidence.compositionAfterSize! - evidence.compositionBeforeSize! === 1;
  return {
    ime,
    copy,
    paste: mode === "human" ? humanPaste : drivenPaste,
    drag,
  };
}

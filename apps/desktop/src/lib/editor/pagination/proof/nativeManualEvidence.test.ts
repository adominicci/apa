import { describe, expect, it } from "vitest";
import {
  createNativeManualEvidence,
  nativeManualChecks,
  recordNativeManualEvidence,
} from "./nativeManualEvidence.ts";

describe("native manual evidence reducer", () => {
  it("ignores every untrusted browser event without changing state", () => {
    const initial = createNativeManualEvidence();
    const untrusted = [
      { kind: "mouse-down" },
      {
        kind: "mouse-up",
        selectionFrom: 10,
        selectionTo: 30,
        gapPosition: 20,
        selectedText: "invented",
      },
      { kind: "copy", selectedText: "invented", documentSize: 100 },
      {
        kind: "paste",
        pastedText: "invented",
        beforeSize: 100,
        afterSize: 108,
      },
      { kind: "key-down", key: "Dead", isComposing: false },
      { kind: "composition-start", beforeSize: 108 },
      { kind: "composition-update" },
      { kind: "key-down", key: "e", isComposing: true },
      { kind: "composition-end", data: "é", afterSize: 109 },
    ] as const;

    let state = initial;
    for (const event of untrusted) {
      state = recordNativeManualEvidence(state, { ...event, isTrusted: false });
    }

    expect(state).toBe(initial);
    expect(nativeManualChecks(state, "windows-driven")).toEqual({
      ime: false,
      copy: false,
      paste: false,
      drag: false,
    });
  });

  it("accepts the ordered trusted drag, clipboard, and dead-key path", () => {
    let state = createNativeManualEvidence();
    const events = [
      { kind: "mouse-down", isTrusted: true },
      {
        kind: "mouse-up",
        isTrusted: true,
        selectionFrom: 10,
        selectionTo: 30,
        gapPosition: 20,
        selectedText: "invented",
      },
      {
        kind: "copy",
        isTrusted: true,
        selectedText: "invented",
        documentSize: 100,
      },
      {
        kind: "paste",
        isTrusted: true,
        pastedText: "invented",
        beforeSize: 100,
        afterSize: 108,
      },
      {
        kind: "key-down",
        isTrusted: true,
        key: "Dead",
        isComposing: false,
      },
      { kind: "composition-start", isTrusted: true, beforeSize: 108 },
      { kind: "composition-update", isTrusted: true },
      {
        kind: "key-down",
        isTrusted: true,
        key: "e",
        isComposing: true,
      },
      {
        kind: "composition-end",
        isTrusted: true,
        data: "é",
        afterSize: 109,
      },
    ] as const;
    for (const event of events) {
      state = recordNativeManualEvidence(state, event);
    }

    expect(nativeManualChecks(state, "windows-driven")).toEqual({
      ime: true,
      copy: true,
      paste: true,
      drag: true,
    });
    expect(state).toMatchObject({
      selectedText: "invented",
      selectionFrom: 10,
      selectionTo: 30,
      gapPosition: 20,
      pastedText: "invented",
      compositionData: "é",
      deadKeys: 1,
      composingKeys: 1,
    });
  });

  it("does not credit out-of-order or mismatched trusted evidence", () => {
    let state = createNativeManualEvidence();
    state = recordNativeManualEvidence(state, {
      kind: "copy",
      isTrusted: true,
      selectedText: "invented",
      documentSize: 100,
    });
    state = recordNativeManualEvidence(state, {
      kind: "paste",
      isTrusted: true,
      pastedText: "different",
      beforeSize: 100,
      afterSize: 109,
    });
    state = recordNativeManualEvidence(state, {
      kind: "composition-end",
      isTrusted: true,
      data: "é",
      afterSize: 101,
    });

    expect(nativeManualChecks(state, "windows-driven")).toEqual({
      ime: false,
      copy: false,
      paste: false,
      drag: false,
    });
  });

  it("preserves the existing trusted human composition contract on macOS", () => {
    let state = createNativeManualEvidence();
    state = recordNativeManualEvidence(state, {
      kind: "composition-start",
      isTrusted: true,
      beforeSize: 100,
    });
    state = recordNativeManualEvidence(state, {
      kind: "composition-end",
      isTrusted: true,
      data: "ñ",
      afterSize: 101,
    });

    expect(nativeManualChecks(state, "human").ime).toBe(true);
    expect(nativeManualChecks(state, "windows-driven").ime).toBe(false);
  });

  it("preserves human paste evidence when paste replaces the copied selection", () => {
    let state = createNativeManualEvidence();
    state = recordNativeManualEvidence(state, {
      kind: "mouse-down",
      isTrusted: true,
    });
    state = recordNativeManualEvidence(state, {
      kind: "mouse-up",
      isTrusted: true,
      selectionFrom: 10,
      selectionTo: 30,
      gapPosition: 20,
      selectedText: "invented",
    });
    state = recordNativeManualEvidence(state, {
      kind: "copy",
      isTrusted: true,
      selectedText: "invented",
      documentSize: 100,
    });
    state = recordNativeManualEvidence(state, {
      kind: "paste",
      isTrusted: true,
      pastedText: "invented",
      beforeSize: 100,
      afterSize: 100,
    });

    expect(nativeManualChecks(state, "human")).toMatchObject({
      copy: true,
      paste: true,
    });
    expect(nativeManualChecks(state, "windows-driven").paste).toBe(false);
  });
});

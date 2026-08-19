import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isRetryableNoKeyboardProgressNativeInputResult } from "./nativeManualRetry.ts";

const proofDir = dirname(fileURLToPath(import.meta.url));
const runner = await readFile(resolve(proofDir, "runNativeProof.ts"), "utf8");

function zeroEventResult(): Record<string, unknown> {
  return {
    passed: false,
    error: "Manual native-input evidence timed out",
    checks: {
      nativeClipboard: false,
      nativeComposedCharacterInput: false,
      nativeMouseDragAcrossGap: false,
    },
    metrics: {
      inputDriver: "win32-sendinput-v1",
      windowsNativeInputDriver: "win32-sendinput-v1",
      windowsNativeInputComplete: false,
      selectedTextLength: 0,
      rightKeys: 0,
      deadKeys: 0,
      copies: 0,
      pastes: 0,
      undoKeys: 0,
      composingKeys: 0,
      compositionStarts: 0,
      compositionUpdates: 0,
      compositionEnds: 0,
      compositionData: "",
      deadKeyAckStage: "",
      deadKeyCode: "",
      deadKeyData: "",
      selectionFrom: null,
      selectionTo: null,
      caretBeforePos: null,
      caretAfterPos: null,
      caretDocumentSize: null,
      pasteSelectionPos: null,
      deadKeyBeforeSize: null,
      deadKeyAfterSize: null,
      undoDocumentSize: null,
      undoDocumentRestored: false,
      undoSelectionRestored: false,
    },
  };
}

function hostFailure(pageResult: Record<string, unknown>) {
  return {
    passed: false,
    error:
      "Windows native input result arrived before driver completion; page result: {...}",
    nativeInputCleanupComplete: true,
    pageResult,
  };
}

describe("Windows native-input no-keyboard-progress retry policy", () => {
  it("accepts the exact zero-event host failure envelope", () => {
    expect(isRetryableNoKeyboardProgressNativeInputResult(
      hostFailure(zeroEventResult()),
    )).toBe(true);
  });

  it("accepts a valid mouse selection when no keyboard input was observed", () => {
    const result = zeroEventResult();
    result.checks = {
      nativeClipboard: false,
      nativeComposedCharacterInput: false,
      nativeMouseDragAcrossGap: true,
    };
    Object.assign(result.metrics as Record<string, unknown>, {
      selectedTextLength: 8,
      selectionFrom: 892,
      selectionTo: 900,
    });
    expect(isRetryableNoKeyboardProgressNativeInputResult(hostFailure(result)))
      .toBe(true);
  });

  it("rejects any keyboard progress or inconsistent mouse progress", () => {
    for (
      const [field, value] of [
        ["selectedTextLength", 8],
        ["rightKeys", 1],
        ["deadKeys", 1],
        ["copies", 1],
        ["pastes", 1],
        ["undoKeys", 1],
        ["selectionFrom", 892],
        ["caretBeforePos", 908],
        ["deadKeyBeforeSize", 4119],
      ] as const
    ) {
      const result = zeroEventResult();
      (result.metrics as Record<string, unknown>)[field] = value;
      expect(
        isRetryableNoKeyboardProgressNativeInputResult(hostFailure(result)),
        field,
      ).toBe(false);
    }

    const inconsistentMouse = zeroEventResult();
    (inconsistentMouse.checks as Record<string, unknown>)[
      "nativeMouseDragAcrossGap"
    ] = true;
    expect(isRetryableNoKeyboardProgressNativeInputResult(
      hostFailure(inconsistentMouse),
    )).toBe(false);
  });

  it("rejects raw page results and failed native cleanup", () => {
    expect(isRetryableNoKeyboardProgressNativeInputResult(zeroEventResult()))
      .toBe(false);
    expect(isRetryableNoKeyboardProgressNativeInputResult({
      ...hostFailure(zeroEventResult()),
      nativeInputCleanupComplete: false,
      error:
        "Windows native input result arrived before driver completion; page result: {...}; RestoreClipboard failed",
    })).toBe(false);
    expect(isRetryableNoKeyboardProgressNativeInputResult({
      ...hostFailure(zeroEventResult()),
      error: "untrusted page result",
    })).toBe(false);
  });

  it("never retries a partial semantic failure or a different timeout", () => {
    for (
      const result of [
        {
          passed: false,
          error: "Win32 clipboard text does not match the copied selection",
        },
        { passed: false, error: "WebView2 proof timed out" },
        { ...zeroEventResult(), passed: true },
        { ...zeroEventResult(), checks: { nativeMouseDragAcrossGap: true } },
        {
          ...zeroEventResult(),
          metrics: { windowsNativeInputComplete: false },
        },
      ]
    ) {
      expect(isRetryableNoKeyboardProgressNativeInputResult(
        "pageResult" in result ? result : hostFailure(result),
      )).toBe(false);
    }
  });

  it("wires one fresh-profile manual retry without semantic fallback", () => {
    expect(runner).toContain("MAX_NO_KEYBOARD_PROGRESS_ATTEMPTS = 2");
    expect(runner).toContain("isRetryableNoKeyboardProgressNativeInputResult");
    expect(runner).toContain("`${profileName}-input-retry`");
    expect(runner).toContain("attempt === 0");
    expect(runner).toContain("Native proof host exited with code");
    expect(runner).not.toMatch(/synthetic|dispatchEvent|execute_script/);
  });
});

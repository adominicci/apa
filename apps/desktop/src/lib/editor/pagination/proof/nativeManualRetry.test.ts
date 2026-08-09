import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isRetryableZeroEventNativeInputResult } from "./nativeManualRetry.ts";

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

describe("Windows native-input zero-event retry policy", () => {
  it("accepts only the exact no-input-desktop timeout signature", () => {
    expect(isRetryableZeroEventNativeInputResult(zeroEventResult())).toBe(true);

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
      expect(isRetryableZeroEventNativeInputResult(result), field).toBe(false);
    }
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
      expect(isRetryableZeroEventNativeInputResult(result)).toBe(false);
    }
  });

  it("wires one fresh-profile manual retry without semantic fallback", () => {
    expect(runner).toContain("MAX_ZERO_EVENT_NATIVE_INPUT_ATTEMPTS = 2");
    expect(runner).toContain("isRetryableZeroEventNativeInputResult");
    expect(runner).toContain("`${profileName}-zero-event-retry`");
    expect(runner).toContain("attempt === 0");
    expect(runner).toContain("Native proof host exited with code");
    expect(runner).not.toMatch(/synthetic|dispatchEvent|execute_script/);
  });
});

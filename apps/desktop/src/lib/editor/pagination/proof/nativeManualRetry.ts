const NO_KEYBOARD_PROGRESS_TIMEOUT = "Manual native-input evidence timed out";
const WINDOWS_INPUT_DRIVER = "win32-sendinput-v1";
const INCOMPLETE_DRIVER_ERROR_PREFIX =
  "Windows native input result arrived before driver completion; page result: ";

const ZERO_KEYBOARD_METRICS = [
  "rightKeys",
  "deadKeys",
  "copies",
  "pastes",
  "undoKeys",
  "composingKeys",
  "compositionStarts",
  "compositionUpdates",
  "compositionEnds",
] as const;

const NULL_KEYBOARD_PROGRESS_METRICS = [
  "caretBeforePos",
  "caretAfterPos",
  "caretDocumentSize",
  "pasteSelectionPos",
  "deadKeyBeforeSize",
  "deadKeyAfterSize",
  "undoDocumentSize",
] as const;

const EMPTY_DIAGNOSTIC_METRICS = [
  "compositionData",
  "deadKeyAckStage",
  "deadKeyCode",
  "deadKeyData",
] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function hasConsistentMouseProgress(
  checks: Record<string, unknown>,
  metrics: Record<string, unknown>,
): boolean {
  if (checks["nativeMouseDragAcrossGap"] === false) {
    return metrics["selectedTextLength"] === 0 &&
      metrics["selectionFrom"] === null && metrics["selectionTo"] === null;
  }
  if (checks["nativeMouseDragAcrossGap"] !== true) return false;
  const from = metrics["selectionFrom"];
  const to = metrics["selectionTo"];
  const length = metrics["selectedTextLength"];
  return Number.isInteger(from) && Number.isInteger(to) &&
    Number.isInteger(length) && (length as number) > 0 &&
    (to as number) - (from as number) === length;
}

export function isRetryableNoKeyboardProgressNativeInputResult(
  value: unknown,
): boolean {
  const envelope = record(value);
  const result = record(envelope?.["pageResult"]);
  if (
    !result || envelope?.["passed"] !== false ||
    envelope["nativeInputCleanupComplete"] !== true ||
    typeof envelope["error"] !== "string" ||
    !envelope["error"].startsWith(INCOMPLETE_DRIVER_ERROR_PREFIX)
  ) {
    return false;
  }
  const checks = record(result?.["checks"]);
  const metrics = record(result?.["metrics"]);
  if (
    result?.["passed"] !== false ||
    result["error"] !== NO_KEYBOARD_PROGRESS_TIMEOUT ||
    checks?.["nativeClipboard"] !== false ||
    checks["nativeComposedCharacterInput"] !== false ||
    metrics?.["inputDriver"] !== WINDOWS_INPUT_DRIVER ||
    metrics["windowsNativeInputDriver"] !== WINDOWS_INPUT_DRIVER ||
    metrics["windowsNativeInputComplete"] !== false ||
    metrics["undoDocumentRestored"] !== false ||
    metrics["undoSelectionRestored"] !== false
  ) {
    return false;
  }
  return hasConsistentMouseProgress(checks, metrics) &&
    ZERO_KEYBOARD_METRICS.every((name) => metrics[name] === 0) &&
    NULL_KEYBOARD_PROGRESS_METRICS.every((name) => metrics[name] === null) &&
    EMPTY_DIAGNOSTIC_METRICS.every((name) => metrics[name] === "");
}

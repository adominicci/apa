const ZERO_EVENT_TIMEOUT = "Manual native-input evidence timed out";
const WINDOWS_INPUT_DRIVER = "win32-sendinput-v1";

const ZERO_NUMBER_METRICS = [
  "selectedTextLength",
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

const NULL_PROGRESS_METRICS = [
  "selectionFrom",
  "selectionTo",
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

export function isRetryableZeroEventNativeInputResult(
  value: unknown,
): boolean {
  const result = record(value);
  const checks = record(result?.["checks"]);
  const metrics = record(result?.["metrics"]);
  if (
    result?.["passed"] !== false || result["error"] !== ZERO_EVENT_TIMEOUT ||
    checks?.["nativeClipboard"] !== false ||
    checks["nativeComposedCharacterInput"] !== false ||
    checks["nativeMouseDragAcrossGap"] !== false ||
    metrics?.["inputDriver"] !== WINDOWS_INPUT_DRIVER ||
    metrics["windowsNativeInputDriver"] !== WINDOWS_INPUT_DRIVER ||
    metrics["windowsNativeInputComplete"] !== false ||
    metrics["undoDocumentRestored"] !== false ||
    metrics["undoSelectionRestored"] !== false
  ) {
    return false;
  }
  return ZERO_NUMBER_METRICS.every((name) => metrics[name] === 0) &&
    NULL_PROGRESS_METRICS.every((name) => metrics[name] === null) &&
    EMPTY_DIAGNOSTIC_METRICS.every((name) => metrics[name] === "");
}

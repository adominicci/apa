export interface NativeProofBridgeScope {
  webkit?: {
    messageHandlers?: {
      tesinaProof?: { postMessage(value: unknown): void };
      tesinaDiagnostic?: { postMessage(value: unknown): void };
    };
  };
  ipc?: { postMessage(value: string): void };
}

export interface NativeProofBridge {
  postResult(value: unknown): boolean;
  postDiagnostic(value: unknown): boolean;
}

export function createNativeProofBridge(
  scope: NativeProofBridgeScope,
): NativeProofBridge {
  function post(channel: "result" | "diagnostic", value: unknown): boolean {
    const handler = channel === "result"
      ? scope.webkit?.messageHandlers?.tesinaProof
      : scope.webkit?.messageHandlers?.tesinaDiagnostic;
    if (handler) {
      handler.postMessage(value);
      return true;
    }
    if (scope.ipc) {
      scope.ipc.postMessage(JSON.stringify({ channel, payload: value }));
      return true;
    }
    return false;
  }

  return {
    postResult: (value) => post("result", value),
    postDiagnostic: (value) => post("diagnostic", value),
  };
}

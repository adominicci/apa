import { describe, expect, it } from "vitest";
import { createNativeProofBridge } from "./nativeBridge.ts";

describe("native proof browser bridge", () => {
  it("routes results and diagnostics through WKWebView message handlers", () => {
    const results: unknown[] = [];
    const diagnostics: unknown[] = [];
    const bridge = createNativeProofBridge({
      webkit: {
        messageHandlers: {
          tesinaProof: { postMessage: (value) => results.push(value) },
          tesinaDiagnostic: {
            postMessage: (value) => diagnostics.push(value),
          },
        },
      },
    });

    expect(bridge.postResult({ passed: true })).toBe(true);
    expect(bridge.postDiagnostic({ stage: "ready" })).toBe(true);
    expect(results).toEqual([{ passed: true }]);
    expect(diagnostics).toEqual([{ stage: "ready" }]);
  });

  it("routes the same payloads through Wry IPC envelopes", () => {
    const messages: string[] = [];
    const bridge = createNativeProofBridge({
      ipc: { postMessage: (value) => messages.push(value) },
    });

    expect(bridge.postResult({ passed: true })).toBe(true);
    expect(bridge.postDiagnostic({ stage: "ready" })).toBe(true);
    expect(messages.map((value) => JSON.parse(value))).toEqual([
      { channel: "result", payload: { passed: true } },
      { channel: "diagnostic", payload: { stage: "ready" } },
    ]);
  });
});

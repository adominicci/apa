interface HarnessSelfTestResult {
  passed: boolean;
  engine: string;
  checks: Record<string, boolean>;
  metrics: Record<string, number | string>;
  error?: string;
}

import {
  createNativeProofBridge,
  type NativeProofBridgeScope,
} from "./nativeBridge.ts";
import { startProofPageWatchdog } from "./proofPageWatchdog.ts";

const nativeBridge = createNativeProofBridge(
  globalThis as unknown as NativeProofBridgeScope,
);

function requireElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Missing native harness self-test element: ${selector}`);
  }
  return element;
}

const resultElement = requireElement("#proof-result");
let finished = false;
const watchdog = startProofPageWatchdog(15_000, () => {
  finish({
    passed: false,
    engine: navigator.userAgent,
    checks: {},
    metrics: {},
    error: "Native harness self-test page watchdog expired",
  });
});

function finish(result: HarnessSelfTestResult): void {
  if (finished) return;
  finished = true;
  watchdog.cancel();
  resultElement.textContent = JSON.stringify(result, null, 2);
  nativeBridge.postResult(result);
}

if (document.visibilityState !== "visible") {
  finish({
    passed: false,
    engine: navigator.userAgent,
    checks: {
      externalModuleExecution: true,
      visibleDocument: false,
      animationFrame: false,
    },
    metrics: { visibilityState: document.visibilityState },
    error:
      "Native harness document is hidden; animation frames cannot prove layout",
  });
} else {
  requestAnimationFrame(() => {
    finish({
      passed: true,
      engine: navigator.userAgent,
      checks: {
        externalModuleExecution: true,
        visibleDocument: true,
        animationFrame: true,
      },
      metrics: { visibilityState: document.visibilityState },
    });
  });
}

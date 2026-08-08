interface HarnessSelfTestResult {
  passed: boolean;
  engine: string;
  checks: Record<string, boolean>;
  metrics: Record<string, number | string>;
  error?: string;
}

export {};

const bridge = globalThis as typeof globalThis & {
  webkit?: {
    messageHandlers?: {
      tesinaProof?: { postMessage(value: HarnessSelfTestResult): void };
    };
  };
};

function requireElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Missing native harness self-test element: ${selector}`);
  }
  return element;
}

const resultElement = requireElement("#proof-result");

function finish(result: HarnessSelfTestResult): void {
  resultElement.textContent = JSON.stringify(result, null, 2);
  bridge.webkit?.messageHandlers?.tesinaProof?.postMessage(result);
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

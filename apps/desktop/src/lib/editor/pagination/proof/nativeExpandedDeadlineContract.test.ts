import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGINATION_RESPONSIVENESS_BUDGET } from "../performanceBudget.ts";
import {
  AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS,
  NATIVE_EXPANDED_PROOF_BUDGET_MS,
  nativeExpandedProofDeclaredCeilingMs,
} from "./nativeProofDeadlines.ts";

const proofDir = import.meta.dirname!;
const [page, swiftHost, windowsHost, runner] = await Promise.all([
  readFile(resolve(proofDir, "nativeProof.ts"), "utf8"),
  readFile(resolve(proofDir, "WKWebViewProofRunner.swift"), "utf8"),
  readFile(
    resolve(
      proofDir,
      "../../../../../src-tauri/examples/webview2-proof-host.rs",
    ),
    "utf8",
  ),
  readFile(resolve(proofDir, "runNativeProof.ts"), "utf8"),
]);

describe("expanded native pagination deadline policy", () => {
  it("orders a 120s page inside a 135s host inside a 150s outer process", () => {
    expect(AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS).toMatchObject({
      expandedPaginationPage: 120_000,
      expandedPaginationHost: 135_000,
      expandedPaginationOuter: 150_000,
    });
    expect(page).toContain(
      "AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS.expandedPaginationPage",
    );
    expect(page).toContain('from "./nativeProofDeadlines.ts"');
    expect(page).not.toContain('from "./nativeHostCommand.ts"');
    expect(swiftHost).toMatch(
      /url\.lastPathComponent == "nativeProof\.html"\s*\?\s*135\s*:\s*45/,
    );
    expect(windowsHost).toContain(
      "EXPANDED_PAGINATION_HOST_DEADLINE: Duration = Duration::from_secs(135)",
    );
    expect(windowsHost).toContain(
      'parsed_url.path() == "/nativeProof.html"',
    );
    expect(runner).toContain(
      "AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS.expandedPaginationOuter",
    );
  });

  it("preserves the shorter self-test and driven native-input deadline", () => {
    expect(swiftHost).toMatch(
      /url\.lastPathComponent == "nativeManualProof\.html"\s*\?\s*300/,
    );
    expect(windowsHost).toContain(
      "AUTOMATED_HOST_DEADLINE: Duration = Duration::from_secs(45)",
    );
    expect(windowsHost).toMatch(
      /if drive_native_input \{\s*AUTOMATED_HOST_DEADLINE/,
    );
    expect(AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS.outerNativeHostProcess).toBe(
      60_000,
    );
  });

  it("shares bounded workload setup pools inside the expanded page envelope", () => {
    const workloadPages = [10, 25, 50] as const;
    const operationCeilingMs = workloadPages.reduce((total, pages) => {
      const budget = PAGINATION_RESPONSIVENESS_BUDGET.workloads[pages];
      return total + budget.typingDeletionMs * 2 +
        budget.referenceFontMs * 2 + budget.resizeMs;
    }, 0);
    const declaredCeilingMs = nativeExpandedProofDeclaredCeilingMs(
      operationCeilingMs,
      workloadPages.length,
    );

    expect(operationCeilingMs).toBe(25_250);
    expect(NATIVE_EXPANDED_PROOF_BUDGET_MS).toEqual({
      workloadSetupPerFixture: 10_000,
      legacyAndParityHeadroom: 55_000,
    });
    expect(declaredCeilingMs).toBe(110_250);
    expect(declaredCeilingMs).toBeLessThan(
      AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS.expandedPaginationPage,
    );
  });
});

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS } from "./nativeHostCommand.ts";

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
});

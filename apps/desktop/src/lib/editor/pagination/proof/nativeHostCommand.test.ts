import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS,
  nativeHostCommand,
  windowsHostBuildProcessOptions,
} from "./nativeHostCommand.ts";

const inputs = {
  proofDir: "/proof",
  url: new URL("http://127.0.0.1:4312/nativeProof.html"),
  profileDir: "/tmp/profile",
  windowsHostBinary: "C:\\tmp\\webview2-proof-host.exe",
};

describe("native proof direct host command", () => {
  it("gives cold Windows host compilation its own bounded process options", () => {
    expect(
      windowsHostBuildProcessOptions(
        { KEEP: "yes", CARGO_TARGET_DIR: "stale" },
        "D:\\fresh",
      ),
    ).toEqual({
      timeoutMs: 360_000,
      env: { KEEP: "yes", CARGO_TARGET_DIR: "D:\\fresh" },
    });
  });

  it("keeps the cold build distinct from the outer host-process cushion", () => {
    expect(AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS).toEqual({
      windowsHostBuild: 360_000,
      originReadiness: 10_000,
      outerNativeHostProcess: 60_000,
    });
    expect(AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS.windowsHostBuild).toBeLessThan(
      10 * 60_000,
    );
    expect(AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS.outerNativeHostProcess).toBe(
      60_000,
    );
  });

  it("selects the Swift WKWebView runner on macOS", () => {
    expect(nativeHostCommand("darwin", inputs)).toEqual({
      command: "xcrun",
      args: [
        "swift",
        resolve(inputs.proofDir, "WKWebViewProofRunner.swift"),
        inputs.url.href,
      ],
    });
  });

  it("selects the prebuilt WebView2 executable directly on Windows", () => {
    expect(nativeHostCommand("win32", inputs)).toEqual({
      command: inputs.windowsHostBinary,
      args: [inputs.url.href, inputs.profileDir],
    });
  });

  it("fails closed on a host without an audited native harness", () => {
    expect(() => nativeHostCommand("linux", inputs)).toThrow(
      "Unsupported native proof platform",
    );
  });
});

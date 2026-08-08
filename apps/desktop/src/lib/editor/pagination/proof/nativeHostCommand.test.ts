import { describe, expect, it } from "vitest";
import { nativeHostCommand } from "./nativeHostCommand.ts";

const inputs = {
  proofDir: "/proof",
  url: new URL("http://127.0.0.1:4312/nativeProof.html"),
  profileDir: "/tmp/profile",
  windowsHostBinary: "C:\\tmp\\webview2-proof-host.exe",
};

describe("native proof direct host command", () => {
  it("selects the Swift WKWebView runner on macOS", () => {
    expect(nativeHostCommand("darwin", inputs)).toEqual({
      command: "xcrun",
      args: ["swift", "/proof/WKWebViewProofRunner.swift", inputs.url.href],
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

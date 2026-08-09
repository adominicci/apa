import { resolve } from "node:path";
import type { ProcessOptions } from "./proofProcess.ts";

export const AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS = Object.freeze({
  windowsHostBuild: 360_000,
  originReadiness: 10_000,
  outerNativeHostProcess: 60_000,
  expandedPaginationPage: 120_000,
  expandedPaginationHost: 135_000,
  expandedPaginationOuter: 150_000,
});

export function windowsHostBuildProcessOptions(
  environment: Record<string, string | undefined>,
  targetDir: string,
): ProcessOptions {
  return {
    timeoutMs: AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS.windowsHostBuild,
    env: { ...environment, CARGO_TARGET_DIR: targetDir },
  };
}

export interface NativeHostInputs {
  proofDir: string;
  url: URL;
  profileDir: string;
  windowsHostBinary: string;
}

export interface NativeHostCommand {
  command: string;
  args: string[];
}

export type NativeHostMode = "standard" | "windows-native-input";

export function nativeHostCommand(
  platform: "darwin" | "win32" | string,
  inputs: NativeHostInputs,
  mode: NativeHostMode = "standard",
): NativeHostCommand {
  if (mode === "windows-native-input" && platform !== "win32") {
    throw new Error("Windows native input mode requires the WebView2 host");
  }
  if (
    mode === "windows-native-input" &&
    inputs.url.pathname !== "/nativeManualProof.html"
  ) {
    throw new Error(
      "Windows native input mode requires the manual proof route",
    );
  }
  if (platform === "darwin") {
    return {
      command: "xcrun",
      args: [
        "swift",
        resolve(inputs.proofDir, "WKWebViewProofRunner.swift"),
        inputs.url.href,
      ],
    };
  }
  if (platform === "win32") {
    return {
      command: inputs.windowsHostBinary,
      args: [
        inputs.url.href,
        inputs.profileDir,
        ...(mode === "windows-native-input" ? ["--drive-native-input"] : []),
      ],
    };
  }
  throw new Error(`Unsupported native proof platform: ${platform}`);
}

import { resolve } from "node:path";
import type { ProcessOptions } from "./proofProcess.ts";

export const AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS = Object.freeze({
  windowsHostBuild: 360_000,
  originReadiness: 10_000,
  outerNativeHostProcess: 60_000,
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

export function nativeHostCommand(
  platform: "darwin" | "win32" | string,
  inputs: NativeHostInputs,
): NativeHostCommand {
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
      args: [inputs.url.href, inputs.profileDir],
    };
  }
  throw new Error(`Unsupported native proof platform: ${platform}`);
}

import { resolve } from "node:path";

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

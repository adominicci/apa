import { spawn } from "node:child_process";
import { expect, test } from "vitest";
import { createTauriSpellingClient } from "./service";
import type { NativeCheckRequest } from "./types";

async function invokeRealTauriCommand(
  command: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      "cargo",
      [
        "run",
        "--quiet",
        "--locked",
        "--manifest-path",
        "apps/desktop/src-tauri/Cargo.toml",
        "--example",
        "spelling-ipc-test",
        "--features",
        "spelling-ipc-test",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(error);
        }
      } else {
        reject(new Error(stderr));
      }
    });
    child.stdin.end(JSON.stringify({ command, args }));
  });
}

test(
  "TypeScript serialization crosses the registered Tauri spelling command",
  async () => {
    const client = createTauriSpellingClient(invokeRealTauriCommand);
    const request: NativeCheckRequest = {
      requestId: "ipc-integration:1",
      documentRevision: 23,
      language: "en",
      documentStart: Number.MAX_SAFE_INTEGER + 1,
      text: "bounded fixture",
    };

    await expect(client.check(request)).resolves.toEqual({
      status: "failed",
      requestId: request.requestId,
      documentRevision: request.documentRevision,
      code: "invalid-request",
    });
  },
  120_000,
);

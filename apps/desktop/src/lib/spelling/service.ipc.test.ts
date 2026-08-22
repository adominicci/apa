import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { expect, test } from "vitest";
import { createSpellingService, createTauriSpellingClient } from "./service";

function startRealTauriBridge() {
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
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const pending: Array<{
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }> = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    const request = pending.shift();
    if (!request) return;
    try {
      request.resolve(JSON.parse(line));
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
  child.on("close", (code) => {
    if (code !== 0) {
      const error = new Error(stderr || `IPC harness exited with ${code}`);
      for (const request of pending.splice(0)) request.reject(error);
    }
  });

  return {
    invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
        try {
          child.stdin.write(`${JSON.stringify({ command, args })}\n`);
        } catch (error) {
          reject(error);
        }
      });
    },
    close() {
      child.stdin.end();
    },
  };
}

test(
  "facade correlation and stable unions cross the registered Tauri commands",
  async () => {
    const bridge = startRealTauriBridge();
    const service = createSpellingService(
      createTauriSpellingClient(bridge.invoke),
    );
    try {
      const completed = await service.check({
        contextId: "ipc-completed",
        language: "en",
        documentRevision: 23,
        documentStart: 7,
        text: "wrngg",
      });
      expect(completed).toMatchObject({
        status: "completed",
        documentRevision: 23,
        selectedLanguageTag: "en-US",
        issues: [{ from: 7, to: 12, word: "wrngg", suggestions: ["wrong"] }],
      });
      expect(completed.requestId).toMatch(/^[0-9a-f-]+:\d+$/);

      const failed = await service.check({
        contextId: "ipc-failed",
        language: "es",
        documentRevision: 24,
        documentStart: 0,
        text: "adapter-failure",
      });
      expect(failed).toMatchObject({
        status: "failed",
        documentRevision: 24,
        code: "adapter-failure",
      });
      expect(failed.requestId).not.toBe(completed.requestId);
    } finally {
      bridge.close();
    }
  },
  120_000,
);

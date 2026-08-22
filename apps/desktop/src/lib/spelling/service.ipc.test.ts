import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { env } from "node:process";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
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
  return createIpcBridge(child, 60_000);
}

function createIpcBridge(
  child: ChildProcessWithoutNullStreams,
  responseTimeoutMs: number,
) {
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const pending: Array<{
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  let closed = false;
  let resolveClosed!: () => void;
  const closedPromise = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const errorWithStderr = (message: string) => {
    const diagnostic = stderr.trim().slice(-4_000);
    return new Error(diagnostic ? `${message}: ${diagnostic}` : message);
  };
  const rejectPending = (error: Error) => {
    for (const request of pending.splice(0)) {
      clearTimeout(request.timer);
      request.reject(error);
    }
  };
  const rejectFromError = (source: string, error: Error) => {
    rejectPending(errorWithStderr(`IPC harness ${source}: ${error.message}`));
  };

  const outputLines = createInterface({ input: child.stdout });
  outputLines.on("error", (error) => rejectFromError("stdout error", error));
  outputLines.on("line", (line) => {
    const request = pending.shift();
    if (!request) return;
    clearTimeout(request.timer);
    try {
      request.resolve(JSON.parse(line));
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
  child.on("error", (error) => rejectFromError("process error", error));
  child.stdin.on("error", (error) => rejectFromError("stdin error", error));
  child.stdout.on("error", (error) => rejectFromError("stdout error", error));
  child.stderr.on("error", (error) => rejectFromError("stderr error", error));
  child.on("close", (code, signal) => {
    closed = true;
    rejectPending(
      errorWithStderr(
        `IPC harness exited with ${code ?? "no code"}${
          signal ? ` (${signal})` : ""
        }`,
      ),
    );
    resolveClosed();
  });

  return {
    invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
      return new Promise((resolve, reject) => {
        if (closed) {
          reject(errorWithStderr("IPC harness is closed"));
          return;
        }
        const request = {
          resolve,
          reject,
          timer: setTimeout(() => {
            const index = pending.indexOf(request);
            if (index === -1) return;
            pending.splice(index, 1);
            reject(
              errorWithStderr(
                `IPC harness response timed out after ${responseTimeoutMs} ms`,
              ),
            );
          }, responseTimeoutMs),
        };
        pending.push(request);
        try {
          child.stdin.write(`${JSON.stringify({ command, args })}\n`);
        } catch (error) {
          const index = pending.indexOf(request);
          if (index !== -1) pending.splice(index, 1);
          clearTimeout(request.timer);
          reject(
            errorWithStderr(
              `IPC harness stdin write failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
        }
      });
    },
    close() {
      if (!closed) child.stdin.end();
      return closedPromise;
    },
  };
}

const integrationTest = env.TESINA_RUN_SPELLING_IPC === "1" ? test : test.skip;

integrationTest(
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
      await bridge.close();
    }
  },
  120_000,
);

function fakeChild(): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

test("rejects a pending IPC request when the child exits without a response", async () => {
  const child = fakeChild();
  const bridge = createIpcBridge(child, 50);
  const response = bridge.invoke("spelling_check");

  child.emit("close", 0, null);

  await expect(response).rejects.toThrow("exited with 0");
  await bridge.close();
});

test.each([
  [
    "child",
    (child: ChildProcessWithoutNullStreams) =>
      child.emit("error", new Error("spawn failed")),
  ],
  [
    "stdin",
    (child: ChildProcessWithoutNullStreams) =>
      child.stdin.emit("error", new Error("stdin failed")),
  ],
  [
    "stdout",
    (child: ChildProcessWithoutNullStreams) =>
      child.stdout.emit("error", new Error("stdout failed")),
  ],
  [
    "stderr",
    (child: ChildProcessWithoutNullStreams) =>
      child.stderr.emit("error", new Error("stderr failed")),
  ],
])("rejects pending IPC requests on %s errors", async (_source, fail) => {
  const child = fakeChild();
  const bridge = createIpcBridge(child, 50);
  const response = bridge.invoke("spelling_check");

  fail(child);

  await expect(response).rejects.toThrow("failed");
  child.emit("close", 1, null);
  await bridge.close();
});

test("bounds unanswered IPC requests and includes captured stderr", async () => {
  const child = fakeChild();
  const bridge = createIpcBridge(child, 10);
  (child.stderr as PassThrough).write("cargo diagnostic");

  await expect(bridge.invoke("spelling_check")).rejects.toThrow(
    "cargo diagnostic",
  );
  child.emit("close", 1, null);
  await bridge.close();
});

test("closes cleanly after every IPC response settles", async () => {
  const child = fakeChild();
  const bridge = createIpcBridge(child, 50);
  const response = bridge.invoke("spelling_check");
  (child.stdout as PassThrough).write('{"status":"completed"}\n');

  await expect(response).resolves.toEqual({ status: "completed" });
  const closed = bridge.close();
  child.emit("close", 0, null);
  await closed;
});

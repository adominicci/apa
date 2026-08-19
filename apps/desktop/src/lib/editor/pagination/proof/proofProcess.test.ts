import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import process from "node:process";
import { executeBoundedProcess, ProcessTimeoutError } from "./proofProcess.ts";

const TREE_PROCESS_TIMEOUT_MS = 5_000;
const TREE_PID_READY_TIMEOUT_MS = 4_000;
const TREE_TEST_TIMEOUT_MS = 15_000;

function runtimeEvalArgs(source: string): string[] {
  return "deno" in process.versions ? ["eval", source] : ["-e", source];
}

async function waitForProcessExit(
  pid: number,
  timeoutMs = 1_000,
): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() <= deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

async function waitForPidFile(
  path: string,
  timeoutMs = 2_000,
): Promise<number> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() <= deadline) {
    try {
      const pid = Number((await readFile(path, "utf8")).trim());
      if (Number.isSafeInteger(pid) && pid > 0) return pid;
    } catch {
      // The fixture has not published its descendant yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`PID file ${path} was not ready within ${timeoutMs} ms`);
}

describe("bounded proof process execution", () => {
  it("returns a completed child's output and exit code", async () => {
    const output = await executeBoundedProcess(
      process.execPath,
      runtimeEvalArgs(
        'console.log("proof-output"); console.error("proof-diagnostic")',
      ),
      { timeoutMs: 5_000 },
    );

    expect(output).toEqual({
      code: 0,
      stdout: "proof-output\n",
      stderr: "proof-diagnostic\n",
    });
  });

  it("terminates a child that outlives its deadline before rejecting", async () => {
    const result = await executeBoundedProcess(
      process.execPath,
      runtimeEvalArgs('setTimeout(() => console.log("too-late"), 400)'),
      { timeoutMs: 50 },
    ).catch((error: unknown) => error);

    expect(result).toBeInstanceOf(ProcessTimeoutError);
    const timeoutError = result as ProcessTimeoutError;
    expect(timeoutError.pid).toBeTypeOf("number");
    expect(await waitForProcessExit(timeoutError.pid!)).toBe(true);
  });

  it(
    "settles at the deadline and kills descendants that retain its pipes",
    { timeout: TREE_TEST_TIMEOUT_MS },
    async () => {
      const temporaryDirectory = await mkdtemp(
        resolve(tmpdir(), "tesina-proof-process-tree-test-"),
      );
      const pidFile = resolve(temporaryDirectory, "descendant.pid");
      let descendantPid: number | undefined;
      let execution: Promise<unknown> | undefined;
      try {
        const descendantSource = "setTimeout(() => {}, 10_000)";
        const parentSource = `
          (async () => {
            const { spawn } = await import("node:child_process");
            const { writeFileSync } = await import("node:fs");
            const args = "deno" in process.versions
              ? ["eval", ${JSON.stringify(descendantSource)}]
              : ["-e", ${JSON.stringify(descendantSource)}];
            const descendant = spawn(process.execPath, args, {
              stdio: ["ignore", "inherit", "inherit"],
            });
            writeFileSync(${JSON.stringify(pidFile)}, String(descendant.pid));
            descendant.unref();
            await new Promise((resolve) => setTimeout(resolve, 10_000));
          })();
        `;
        const startedAt = performance.now();
        execution = executeBoundedProcess(
          process.execPath,
          runtimeEvalArgs(parentSource),
          { timeoutMs: TREE_PROCESS_TIMEOUT_MS },
        ).catch((error: unknown) => error);
        descendantPid = await waitForPidFile(
          pidFile,
          TREE_PID_READY_TIMEOUT_MS,
        );
        const result = await execution;
        const elapsedMs = performance.now() - startedAt;

        expect(result).toBeInstanceOf(ProcessTimeoutError);
        expect(elapsedMs).toBeLessThan(8_000);
        expect(await waitForProcessExit(descendantPid!)).toBe(true);
      } finally {
        await execution;
        if (descendantPid !== undefined) {
          try {
            process.kill(descendantPid, "SIGKILL");
          } catch {
            // The process-tree implementation already removed it.
          }
        }
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "uses Windows tree termination semantics when the selected host is win32",
    { timeout: TREE_TEST_TIMEOUT_MS },
    async () => {
      const temporaryDirectory = await mkdtemp(
        resolve(tmpdir(), "tesina-proof-windows-tree-test-"),
      );
      const pidFile = resolve(temporaryDirectory, "descendant.pid");
      const markerFile = resolve(temporaryDirectory, "taskkill.args");
      const taskkill = resolve(temporaryDirectory, "taskkill");
      let descendantPid: number | undefined;
      let execution: Promise<unknown> | undefined;
      try {
        await writeFile(
          taskkill,
          `#!/bin/sh\nprintf '%s\\n' "$*" > ${
            JSON.stringify(markerFile)
          }\nkill -9 "$(cat ${
            JSON.stringify(pidFile)
          })" "$2" 2>/dev/null || true\n`,
        );
        await chmod(taskkill, 0o755);
        const descendantSource = "setTimeout(() => {}, 10_000)";
        const parentSource = `
          (async () => {
            const { spawn } = await import("node:child_process");
            const { writeFileSync } = await import("node:fs");
            const args = "deno" in process.versions
              ? ["eval", ${JSON.stringify(descendantSource)}]
              : ["-e", ${JSON.stringify(descendantSource)}];
            const descendant = spawn(process.execPath, args, {
              stdio: ["ignore", "inherit", "inherit"],
            });
            writeFileSync(${JSON.stringify(pidFile)}, String(descendant.pid));
            descendant.unref();
            await new Promise((resolve) => setTimeout(resolve, 10_000));
          })();
        `;

        execution = executeBoundedProcess(
          process.execPath,
          runtimeEvalArgs(parentSource),
          {
            timeoutMs: TREE_PROCESS_TIMEOUT_MS,
            platform: "win32",
            env: {
              ...process.env,
              PATH: `${temporaryDirectory}${delimiter}${process.env.PATH}`,
            },
          },
        ).catch((error: unknown) => error);
        descendantPid = await waitForPidFile(
          pidFile,
          TREE_PID_READY_TIMEOUT_MS,
        );
        const result = await execution;

        expect(result).toBeInstanceOf(ProcessTimeoutError);
        expect(await readFile(markerFile, "utf8")).toMatch(
          /^\/pid \d+ \/t \/f\n$/,
        );
        expect(await waitForProcessExit(descendantPid)).toBe(true);
      } finally {
        await execution;
        if (descendantPid !== undefined) {
          try {
            process.kill(descendantPid, "SIGKILL");
          } catch {
            // The process-tree implementation already removed it.
          }
        }
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    },
  );
});

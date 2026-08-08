import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { executeBoundedProcess, ProcessTimeoutError } from "./proofProcess.ts";

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

  it.runIf(process.platform !== "win32")(
    "settles at the deadline and kills descendants that retain its pipes",
    async () => {
      const temporaryDirectory = await mkdtemp(
        resolve(tmpdir(), "tesina-proof-process-tree-test-"),
      );
      const pidFile = resolve(temporaryDirectory, "descendant.pid");
      let descendantPid: number | undefined;
      try {
        const descendantSource = "setTimeout(() => {}, 3_000)";
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
            await new Promise((resolve) => setTimeout(resolve, 3_000));
          })();
        `;
        const startedAt = performance.now();
        const result = await executeBoundedProcess(
          process.execPath,
          runtimeEvalArgs(parentSource),
          { timeoutMs: 750 },
        ).catch((error: unknown) => error);
        const elapsedMs = performance.now() - startedAt;
        descendantPid = Number(await readFile(pidFile, "utf8"));

        expect(result).toBeInstanceOf(ProcessTimeoutError);
        expect(elapsedMs).toBeLessThan(1_500);
        expect(await waitForProcessExit(descendantPid!)).toBe(true);
      } finally {
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

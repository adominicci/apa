import { spawn } from "node:child_process";
import process from "node:process";

export interface ProcessOutput {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface ProcessOptions {
  timeoutMs: number;
}

export class ProcessTimeoutError extends Error {
  readonly pid: number | undefined;

  constructor(command: string, timeoutMs: number, pid: number | undefined) {
    super(`Process ${command} exceeded its ${timeoutMs} ms deadline`);
    this.name = "ProcessTimeoutError";
    this.pid = pid;
  }
}

export async function executeBoundedProcess(
  command: string,
  args: string[],
  options: ProcessOptions,
): Promise<ProcessOutput> {
  return await new Promise((resolveOutput, reject) => {
    const usesProcessGroup = process.platform !== "win32";
    const child = spawn(command, args, {
      detached: usesProcessGroup,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      callback();
    };

    const deadline = setTimeout(() => {
      const timeoutError = new ProcessTimeoutError(
        command,
        options.timeoutMs,
        child.pid,
      );
      if (child.pid !== undefined) {
        try {
          if (usesProcessGroup) {
            process.kill(-child.pid, "SIGKILL");
          } else {
            child.kill("SIGKILL");
          }
        } catch {
          child.kill("SIGKILL");
        }
      }
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      settle(() => reject(timeoutError));
    }, options.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => stdout += chunk);
    child.stderr.on("data", (chunk: string) => stderr += chunk);
    child.once("error", (error) => settle(() => reject(error)));
    child.once(
      "close",
      (code) => settle(() => resolveOutput({ code, stdout, stderr })),
    );
  });
}

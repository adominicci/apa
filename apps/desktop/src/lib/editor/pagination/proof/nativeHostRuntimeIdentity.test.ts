import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { nativeHostRuntimeIdentity } from "./nativeHostRuntimeIdentity.ts";

const proofDir = import.meta.dirname!;

describe("native pagination host runtime identity", () => {
  it("records the exact commit, host, hardware, and Deno runtime", () => {
    const identity = nativeHostRuntimeIdentity("abc123");

    expect(identity.commitSha).toBe("abc123");
    expect(identity.os).not.toBe("");
    expect(identity.arch).not.toBe("");
    expect(identity.cpuModel).not.toBe("");
    expect(identity.logicalCores).toBeGreaterThan(0);
    expect(identity.memoryBytes).toBeGreaterThan(0);
    expect(identity.deno).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("passes the pull-request head SHA to the native proof logger", async () => {
    const [workflow, runner] = await Promise.all([
      readFile(
        resolve(
          proofDir,
          "../../../../../../../.github/workflows/ci.yml",
        ),
        "utf8",
      ),
      readFile(resolve(proofDir, "runNativeProof.ts"), "utf8"),
    ]);

    expect(workflow).toContain(
      "TESINA_PROOF_COMMIT_SHA: ${{ github.event.pull_request.head.sha || github.sha }}",
    );
    expect(
      workflow.match(
        /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/g,
      ),
    ).toHaveLength(2);
    expect(runner).toContain(
      'process.env["TESINA_PROOF_COMMIT_SHA"] ??',
    );
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { cleanupProofRun } from "./proofRunCleanup.ts";
import { runProofLifecycle } from "./proofLifecycle.ts";
import { ProcessTimeoutError } from "./proofProcess.ts";

const leftovers = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...leftovers].map((path) => rm(path, { recursive: true, force: true })),
  );
  leftovers.clear();
});

async function generatedDirectories(): Promise<string[]> {
  return await Promise.all(["dist", "profile", "host"].map(async (kind) => {
    const path = await mkdtemp(resolve(tmpdir(), `tesina-${kind}-lifecycle-`));
    leftovers.add(path);
    await writeFile(resolve(path, "generated"), "test-only");
    return path;
  }));
}

async function expectRemoved(paths: readonly string[]): Promise<void> {
  await Promise.all(paths.map(async (path) => {
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  }));
}

describe("native proof outer lifecycle", () => {
  it.each([
    ["success", undefined],
    ["failure", new Error("native host failed")],
    ["timeout", new ProcessTimeoutError("native-host", 60_000, 42)],
  ])("closes preview and removes every generated directory after %s", async (
    _label,
    runError,
  ) => {
    const paths = await generatedDirectories();
    let previewCloses = 0;
    const operation = runProofLifecycle(
      () => runError ? Promise.reject(runError) : Promise.resolve("passed"),
      () =>
        cleanupProofRun(paths, {
          close: () => {
            previewCloses += 1;
            return Promise.resolve();
          },
        }),
    );

    if (runError) await expect(operation).rejects.toBe(runError);
    else await expect(operation).resolves.toBe("passed");
    expect(previewCloses).toBe(1);
    await expectRemoved(paths);
  });

  it("reports both the run failure and cleanup failure", async () => {
    const runError = new Error("host failed");
    const cleanupError = new Error("preview close failed");
    const result = await runProofLifecycle(
      async () => await Promise.reject(runError),
      async () => await Promise.reject(cleanupError),
    ).catch((error: unknown) => error);

    expect(result).toBeInstanceOf(AggregateError);
    expect((result as AggregateError).errors).toEqual([
      runError,
      cleanupError,
    ]);
  });
});

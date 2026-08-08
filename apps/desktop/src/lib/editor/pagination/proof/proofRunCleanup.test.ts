import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { cleanupProofRun } from "./proofRunCleanup.ts";

const temporaryDirectories = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
  temporaryDirectories.clear();
});

describe("native proof cleanup", () => {
  it("removes generated output even when preview shutdown rejects", async () => {
    const outputDir = await mkdtemp(
      resolve(tmpdir(), "tesina-proof-cleanup-test-"),
    );
    temporaryDirectories.add(outputDir);
    await writeFile(resolve(outputDir, "artifact.js"), "generated");
    const closeError = new Error("preview close failed");

    const result = await cleanupProofRun(outputDir, {
      close: async () => await Promise.reject(closeError),
    }).catch((error: unknown) => error);

    expect(result).toBe(closeError);
    await expect(stat(outputDir)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

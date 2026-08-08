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
  it("removes every generated directory even when preview shutdown rejects", async () => {
    const directories = await Promise.all(
      ["dist", "profile", "diagnostics"].map(async (kind) => {
        const directory = await mkdtemp(
          resolve(tmpdir(), `tesina-proof-${kind}-cleanup-test-`),
        );
        temporaryDirectories.add(directory);
        await writeFile(resolve(directory, "artifact"), "generated");
        return directory;
      }),
    );
    const closeError = new Error("preview close failed");

    const result = await cleanupProofRun(directories, {
      close: async () => await Promise.reject(closeError),
    }).catch((error: unknown) => error);

    expect(result).toBe(closeError);
    await Promise.all(
      directories.map(async (directory) => {
        await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
      }),
    );
  });

  it("reports preview shutdown and every directory removal failure together", async () => {
    const removableDirectory = await mkdtemp(
      resolve(tmpdir(), "tesina-proof-aggregate-cleanup-test-"),
    );
    temporaryDirectories.add(removableDirectory);
    await writeFile(resolve(removableDirectory, "artifact"), "generated");
    const closeError = new Error("preview close failed");

    const result = await cleanupProofRun(
      [removableDirectory, "\0dist", "\0profile"],
      { close: async () => await Promise.reject(closeError) },
    ).catch((error: unknown) => error);

    expect(result).toBeInstanceOf(AggregateError);
    const errors = (result as AggregateError).errors;
    expect(errors).toHaveLength(3);
    expect(errors[0]).toBe(closeError);
    expect(errors[1]).toBeInstanceOf(Error);
    expect(errors[2]).toBeInstanceOf(Error);
    await expect(stat(removableDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

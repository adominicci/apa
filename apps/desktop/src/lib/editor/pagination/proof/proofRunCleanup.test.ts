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
  it("retries only transient Windows EBUSY removals with a bounded schedule", async () => {
    const attempts = new Map<string, number>();
    const waits: number[] = [];
    const busy = Object.assign(new Error("profile still in use"), {
      code: "EBUSY",
    });

    await cleanupProofRun(["\0profile", "\0output"], undefined, {
      platform: "win32",
      removeDirectory: (directory) => {
        const attempt = (attempts.get(directory) ?? 0) + 1;
        attempts.set(directory, attempt);
        if (directory === "\0profile" && attempt < 3) throw busy;
        return Promise.resolve();
      },
      wait: (delayMs) => {
        waits.push(delayMs);
        return Promise.resolve();
      },
    });

    expect(attempts).toEqual(
      new Map([
        ["\0profile", 3],
        ["\0output", 1],
      ]),
    );
    expect(waits).toEqual([50, 100]);
  });

  it("retries transient Windows ENOTEMPTY removals with the same bounded schedule", async () => {
    const notEmpty = Object.assign(new Error("profile teardown in progress"), {
      code: "ENOTEMPTY",
    });
    let attempts = 0;
    const waits: number[] = [];

    await cleanupProofRun(["\0profile"], undefined, {
      platform: "win32",
      removeDirectory: () => {
        attempts += 1;
        if (attempts < 3) throw notEmpty;
        return Promise.resolve();
      },
      wait: (delayMs) => {
        waits.push(delayMs);
        return Promise.resolve();
      },
    });

    expect(attempts).toBe(3);
    expect(waits).toEqual([50, 100]);
  });

  it.each(["EBUSY", "ENOTEMPTY"])(
    "stops after the bounded Windows %s retry schedule",
    async (code) => {
      const failures = Array.from(
        { length: 7 },
        (_, index) =>
          Object.assign(new Error(`profile ${code} attempt ${index + 1}`), {
            code,
          }),
      );
      let attempts = 0;
      const waits: number[] = [];

      const result = await cleanupProofRun(["\0profile"], undefined, {
        platform: "win32",
        removeDirectory: () => {
          attempts += 1;
          throw failures[attempts - 1];
        },
        wait: (delayMs) => {
          waits.push(delayMs);
          return Promise.resolve();
        },
      }).catch((error: unknown) => error);

      expect(result).toBe(failures[6]);
      expect(attempts).toBe(7);
      expect(waits).toEqual([50, 100, 200, 400, 800, 1600]);
    },
  );

  it.each([
    ["win32", "EACCES"],
    ["darwin", "EBUSY"],
    ["darwin", "ENOTEMPTY"],
  ])(
    "does not retry %s removal failures with code %s",
    async (platform, code) => {
      const failure = Object.assign(new Error(`${code} removal failure`), {
        code,
      });
      let attempts = 0;
      const waits: number[] = [];

      const result = await cleanupProofRun(["\0profile"], undefined, {
        platform,
        removeDirectory: () => {
          attempts += 1;
          throw failure;
        },
        wait: (delayMs) => {
          waits.push(delayMs);
          return Promise.resolve();
        },
      }).catch((error: unknown) => error);

      expect(result).toBe(failure);
      expect(attempts).toBe(1);
      expect(waits).toEqual([]);
    },
  );

  it("stops retrying when a Windows EBUSY becomes a non-transient failure", async () => {
    const busy = Object.assign(new Error("profile still in use"), {
      code: "EBUSY",
    });
    const denied = Object.assign(new Error("profile removal denied"), {
      code: "EACCES",
    });
    let attempts = 0;
    const waits: number[] = [];

    const result = await cleanupProofRun(["\0profile"], undefined, {
      platform: "win32",
      removeDirectory: () => {
        attempts += 1;
        if (attempts === 1) throw busy;
        throw denied;
      },
      wait: (delayMs) => {
        waits.push(delayMs);
        return Promise.resolve();
      },
    }).catch((error: unknown) => error);

    expect(result).toBe(denied);
    expect(attempts).toBe(2);
    expect(waits).toEqual([50]);
  });

  it("keeps all-directory cleanup and aggregation after an exhausted retry", async () => {
    const notEmpty = Object.assign(new Error("profile never emptied"), {
      code: "ENOTEMPTY",
    });
    const denied = Object.assign(new Error("target removal denied"), {
      code: "EACCES",
    });
    const attempts = new Map<string, number>();

    const result = await cleanupProofRun(
      ["\0profile", "\0target", "\0output"],
      undefined,
      {
        platform: "win32",
        removeDirectory: (directory) => {
          attempts.set(directory, (attempts.get(directory) ?? 0) + 1);
          if (directory === "\0profile") throw notEmpty;
          if (directory === "\0target") throw denied;
          return Promise.resolve();
        },
        wait: () => Promise.resolve(),
      },
    ).catch((error: unknown) => error);

    expect(result).toBeInstanceOf(AggregateError);
    expect((result as AggregateError).errors).toEqual([notEmpty, denied]);
    expect(attempts).toEqual(
      new Map([
        ["\0profile", 7],
        ["\0target", 1],
        ["\0output", 1],
      ]),
    );
  });

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

  it("preserves an undefined preview rejection beside removal failures", async () => {
    const result = await cleanupProofRun(
      ["\0profile"],
      { close: async () => await Promise.reject(undefined) },
    ).catch((error: unknown) => error);

    expect(result).toBeInstanceOf(AggregateError);
    const errors = (result as AggregateError).errors;
    expect(errors).toHaveLength(2);
    expect(errors[0]).toBeInstanceOf(Error);
    expect(errors[1]).toBeInstanceOf(Error);
  });
});

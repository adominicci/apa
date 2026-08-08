import { rm } from "node:fs/promises";
import process from "node:process";

export interface PreviewServerCloser {
  close(): Promise<void>;
}

export interface ProofRunCleanupDependencies {
  platform?: string;
  removeDirectory?(directory: string): Promise<void>;
  wait?(delayMs: number): Promise<void>;
}

const WINDOWS_EBUSY_RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 1600] as const;

function defaultRemoveDirectory(directory: string): Promise<void> {
  return rm(directory, { recursive: true, force: true });
}

function defaultWait(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error &&
      typeof error.code === "string"
    ? error.code
    : undefined;
}

async function removeDirectoryWithRetry(
  directory: string,
  dependencies: Required<ProofRunCleanupDependencies>,
): Promise<void> {
  let retryIndex = 0;
  while (true) {
    try {
      await dependencies.removeDirectory(directory);
      return;
    } catch (error) {
      const delayMs = WINDOWS_EBUSY_RETRY_DELAYS_MS[retryIndex];
      if (
        dependencies.platform !== "win32" || errorCode(error) !== "EBUSY" ||
        delayMs === undefined
      ) {
        throw error;
      }
      retryIndex += 1;
      await dependencies.wait(delayMs);
    }
  }
}

function normalizedFailure(reason: unknown, message: string): Error {
  return reason instanceof Error
    ? reason
    : new Error(message, { cause: reason });
}

export async function cleanupProofRun(
  directories: readonly string[],
  previewServer?: PreviewServerCloser,
  overrides: ProofRunCleanupDependencies = {},
): Promise<void> {
  const dependencies: Required<ProofRunCleanupDependencies> = {
    platform: overrides.platform ?? process.platform,
    removeDirectory: overrides.removeDirectory ?? defaultRemoveDirectory,
    wait: overrides.wait ?? defaultWait,
  };
  let previewFailed = false;
  let previewError: unknown;
  try {
    await previewServer?.close();
  } catch (error) {
    previewFailed = true;
    previewError = error;
  }

  const cleanupResults = await Promise.allSettled(
    directories.map((directory) =>
      removeDirectoryWithRetry(directory, dependencies)
    ),
  );
  const cleanupErrors = cleanupResults.flatMap((result) =>
    result.status === "rejected"
      ? [
        normalizedFailure(
          result.reason,
          "Native proof directory removal failed",
        ),
      ]
      : []
  );

  const errors = [
    ...(previewFailed
      ? [
        normalizedFailure(previewError, "Native proof preview shutdown failed"),
      ]
      : []),
    ...cleanupErrors,
  ];
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "Native proof cleanup failed");
  }
}

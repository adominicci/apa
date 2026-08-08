import { rm } from "node:fs/promises";

export interface PreviewServerCloser {
  close(): Promise<void>;
}

function normalizedFailure(reason: unknown, message: string): Error {
  return reason instanceof Error
    ? reason
    : new Error(message, { cause: reason });
}

export async function cleanupProofRun(
  directories: readonly string[],
  previewServer?: PreviewServerCloser,
): Promise<void> {
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
      rm(directory, { recursive: true, force: true })
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

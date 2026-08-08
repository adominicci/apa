import { rm } from "node:fs/promises";

export interface PreviewServerCloser {
  close(): Promise<void>;
}

export async function cleanupProofRun(
  directories: readonly string[],
  previewServer?: PreviewServerCloser,
): Promise<void> {
  let previewError: unknown;
  try {
    await previewServer?.close();
  } catch (error) {
    previewError = error;
  }

  const cleanupResults = await Promise.allSettled(
    directories.map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
  const cleanupErrors = cleanupResults.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );

  if (previewError !== undefined) throw previewError;
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) {
    throw new AggregateError(cleanupErrors, "Native proof cleanup failed");
  }
}

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

  const errors = [
    ...(previewError === undefined ? [] : [previewError]),
    ...cleanupErrors,
  ];
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "Native proof cleanup failed");
  }
}

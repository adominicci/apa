import { rm } from "node:fs/promises";

export interface PreviewServerCloser {
  close(): Promise<void>;
}

export async function cleanupProofRun(
  outputDir: string,
  previewServer?: PreviewServerCloser,
): Promise<void> {
  try {
    await previewServer?.close();
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

import type { exportLibraryToChosenFile } from "./portableRuntime.ts";

export interface PackagedPortableSmokeDeps {
  exportLibrary: typeof exportLibraryToChosenFile;
  exit(code: number): Promise<void>;
  reportError(error: unknown): void;
}

async function productionDeps(): Promise<PackagedPortableSmokeDeps> {
  const [{ exportLibraryToChosenFile }, { exit }] = await Promise.all([
    import("./portableRuntime.ts"),
    import("@tauri-apps/plugin-process"),
  ]);
  return {
    exportLibrary: exportLibraryToChosenFile,
    exit,
    reportError: (error) =>
      console.error("Packaged portable export smoke failed", error),
  };
}

/**
 * Build-only bootstrap for task 4.6. The smoke bundle replaces the native save
 * dialog with one compile-time-gated, exact destination; all capture, native
 * authorization, safe publication, reopen validation, and token cleanup stay
 * on the production export path.
 */
export async function runPackagedPortableSmoke(
  injected?: PackagedPortableSmokeDeps,
): Promise<void> {
  const deps = injected ?? await productionDeps();
  try {
    const result = await deps.exportLibrary("Tesina Library.tesina");
    if (result === null) {
      throw new Error(
        "the packaged portable smoke destination was unavailable",
      );
    }
    await deps.exit(0);
  } catch (error) {
    deps.reportError(error);
    await deps.exit(1);
  }
}

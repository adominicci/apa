import { verifyInstallerArtifacts } from "./verify-installer-artifacts.ts";

const EXPECTED_SUFFIXES = [
  ".app",
  ".dmg",
  ".app.tar.gz",
  ".app.tar.gz.sig",
] as const;

export interface MacosReleaseArtifacts {
  app: string;
  dmg: string;
  archive: string;
  signature: string;
}

export async function prepareMacosReleaseArtifacts(
  rawArtifactPaths: string | undefined,
  githubOutputPath: string | undefined,
): Promise<MacosReleaseArtifacts> {
  if (!githubOutputPath?.trim()) {
    throw new Error("GITHUB_OUTPUT is blank.");
  }

  if (rawArtifactPaths?.trim()) {
    try {
      const reported: unknown = JSON.parse(rawArtifactPaths);
      if (
        Array.isArray(reported) &&
        reported.some((path) => typeof path === "string" && /\r|\n/.test(path))
      ) {
        throw new Error("artifact path contains a line break.");
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "artifact path contains a line break."
      ) {
        throw error;
      }
    }
  }

  const verified = await verifyInstallerArtifacts(
    rawArtifactPaths,
    JSON.stringify(EXPECTED_SUFFIXES),
  );
  for (const path of verified) {
    if (/\r|\n/.test(path)) {
      throw new Error(`artifact path contains a line break: ${path}`);
    }
  }

  for (const path of verified.slice(1)) {
    const stat = await Deno.stat(path);
    if (stat.size === 0) {
      throw new Error(`artifact must be nonempty: ${path}`);
    }
  }

  const artifacts: MacosReleaseArtifacts = {
    app: verified[0],
    dmg: verified[1],
    archive: verified[2],
    signature: verified[3],
  };
  const outputs = Object.entries(artifacts)
    .map(([name, path]) => `${name}=${path}\n`)
    .join("");
  await Deno.writeTextFile(githubOutputPath, outputs, { append: true });
  return artifacts;
}

if (import.meta.main) {
  try {
    const artifacts = await prepareMacosReleaseArtifacts(
      Deno.env.get("TAURI_ARTIFACT_PATHS"),
      Deno.env.get("GITHUB_OUTPUT"),
    );
    console.log(
      `Prepared ${
        Object.keys(artifacts).length
      } nonempty macOS release artifacts.`,
    );
  } catch (error) {
    console.error(
      `macOS release artifact preparation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    Deno.exitCode = 1;
  }
}

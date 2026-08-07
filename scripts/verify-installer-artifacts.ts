const ARTIFACT_PATHS_ENV = "TAURI_ARTIFACT_PATHS";
const EXPECTED_SUFFIXES_ENV = "EXPECTED_INSTALLER_SUFFIXES";

function parseStringArray(
  name: string,
  rawValue: string | undefined,
): string[] {
  if (!rawValue?.trim()) {
    throw new Error(`${name} is blank.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new Error(`${name} must be a JSON array of paths.`);
  }

  if (
    !Array.isArray(parsed) || parsed.length === 0 ||
    parsed.some((value) => typeof value !== "string" || value.trim() === "")
  ) {
    throw new Error(`${name} must be a non-empty JSON array of strings.`);
  }

  return parsed;
}

export async function verifyInstallerArtifacts(
  rawArtifactPaths: string | undefined,
  rawExpectedSuffixes: string | undefined,
): Promise<string[]> {
  const artifactPaths = parseStringArray(
    ARTIFACT_PATHS_ENV,
    rawArtifactPaths,
  );
  const expectedSuffixes = parseStringArray(
    EXPECTED_SUFFIXES_ENV,
    rawExpectedSuffixes,
  );

  const duplicatePath = artifactPaths.find((path, index) =>
    artifactPaths.indexOf(path) !== index
  );
  if (duplicatePath) {
    throw new Error(`duplicate reported artifact path: ${duplicatePath}`);
  }

  const duplicateSuffix = expectedSuffixes.find((suffix, index) =>
    expectedSuffixes.indexOf(suffix) !== index
  );
  if (duplicateSuffix) {
    throw new Error(`duplicate expected artifact suffix: ${duplicateSuffix}`);
  }

  const verifiedPaths: string[] = [];

  for (const suffix of expectedSuffixes) {
    const matches = artifactPaths.filter((path) => path.endsWith(suffix));
    if (matches.length === 0) {
      throw new Error(`missing artifact ending in "${suffix}".`);
    }
    if (matches.length > 1) {
      throw new Error(
        `found ${matches.length} artifacts ending in "${suffix}"; expected exactly one.`,
      );
    }

    const path = matches[0];
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.stat(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new Error(`reported artifact does not exist: ${path}`);
      }
      throw error;
    }

    if (suffix === ".app") {
      if (!stat.isDirectory) {
        throw new Error(`.app artifact must be a directory: ${path}`);
      }
    } else if (!stat.isFile) {
      throw new Error(`installer artifact must be a file: ${path}`);
    }

    verifiedPaths.push(path);
  }

  return verifiedPaths;
}

if (import.meta.main) {
  try {
    const verifiedPaths = await verifyInstallerArtifacts(
      Deno.env.get(ARTIFACT_PATHS_ENV),
      Deno.env.get(EXPECTED_SUFFIXES_ENV),
    );
    console.log(
      `Verified ${verifiedPaths.length} installer artifacts:\n${
        verifiedPaths.join("\n")
      }`,
    );
  } catch (error) {
    console.error(
      `Installer verification failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    Deno.exitCode = 1;
  }
}

const EXPECTED_ASSET_NAMES = [
  "Tesina-macos-universal.app.tar.gz",
  "Tesina-macos-universal.app.tar.gz.sig",
  "Tesina-macos-universal.dmg",
  "latest.json",
] as const;

const EXPECTED_PLATFORM_KEYS = [
  "darwin-universal",
  "darwin-aarch64",
  "darwin-x86_64",
  "darwin-universal-app",
  "darwin-aarch64-app",
  "darwin-x86_64-app",
] as const;

interface ReleaseDraftContract {
  release: unknown;
  manifest: unknown;
  version: string;
  notes: string;
}

function record(label: string, value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function stringField(
  label: string,
  value: unknown,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    throw new Error(`${label} must be a nonempty string.`);
  }
  return value;
}

export function verifyReleaseDraft(contract: ReleaseDraftContract): void {
  const release = record("release", contract.release);
  const manifest = record("latest.json", contract.manifest);
  const expectedTag = `v${contract.version}`;

  if (release.draft !== true) {
    throw new Error("release must remain a draft until manual publication.");
  }
  if (release.prerelease !== false) {
    throw new Error("release must not be a prerelease.");
  }
  if (release.tag_name !== expectedTag) {
    throw new Error(`release tag must be "${expectedTag}".`);
  }
  if (release.body !== contract.notes) {
    throw new Error(
      "release body does not match the extracted changelog notes.",
    );
  }

  if (!Array.isArray(release.assets)) {
    throw new Error("release assets must be an array.");
  }
  const assets = release.assets.map((value, index) => {
    const asset = record(`release asset ${index + 1}`, value);
    return {
      name: stringField(`release asset ${index + 1} name`, asset.name),
      url: stringField(`release asset ${index + 1} URL`, asset.url),
    };
  });
  const actualAssetNames = assets.map(({ name }) => name).sort();
  const expectedAssetNames = [...EXPECTED_ASSET_NAMES].sort();
  if (JSON.stringify(actualAssetNames) !== JSON.stringify(expectedAssetNames)) {
    throw new Error(
      `release asset names do not match the macOS contract: ${
        actualAssetNames.join(", ")
      }`,
    );
  }

  const archiveUrl = assets.find(({ name }) =>
    name === "Tesina-macos-universal.app.tar.gz"
  )?.url;
  if (!archiveUrl) {
    throw new Error("release has no universal macOS updater archive.");
  }

  if (manifest.version !== contract.version) {
    throw new Error(`latest.json version must be "${contract.version}".`);
  }
  if (manifest.notes !== contract.notes) {
    throw new Error("latest.json notes do not match the release body.");
  }

  const platforms = record("latest.json platforms", manifest.platforms);
  for (const key of EXPECTED_PLATFORM_KEYS) {
    if (!(key in platforms)) {
      throw new Error(`latest.json is missing platform "${key}".`);
    }

    const platform = record(`latest.json platform ${key}`, platforms[key]);
    stringField(`latest.json platform ${key} signature`, platform.signature);
    const url = stringField(`latest.json platform ${key} URL`, platform.url);
    if (url !== archiveUrl) {
      throw new Error(
        `latest.json platform "${key}" does not point to Tesina-macos-universal.app.tar.gz.`,
      );
    }
  }

  for (const key of Object.keys(platforms)) {
    if (!EXPECTED_PLATFORM_KEYS.includes(key as never)) {
      throw new Error(`unexpected updater platform "${key}" in latest.json.`);
    }
  }
}

if (import.meta.main) {
  try {
    const [releasePath, manifestPath, notesPath, version] = Deno.args;
    if (
      !releasePath || !manifestPath || !notesPath || !version ||
      Deno.args.length !== 4
    ) {
      throw new Error(
        "Usage: deno run --allow-read scripts/verify-release-draft.ts <release-json> <latest-json> <notes> <version>",
      );
    }

    const [releaseJson, manifestJson, notesFile] = await Promise.all([
      Deno.readTextFile(releasePath),
      Deno.readTextFile(manifestPath),
      Deno.readTextFile(notesPath),
    ]);
    verifyReleaseDraft({
      release: JSON.parse(releaseJson),
      manifest: JSON.parse(manifestJson),
      version,
      notes: notesFile.trim(),
    });
    console.log("Verified macOS draft release assets and updater manifest.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exitCode = 1;
  }
}

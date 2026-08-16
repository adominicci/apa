const MACOS_ASSET_NAMES = [
  "Tesina-macos-universal.app.tar.gz",
  "Tesina-macos-universal.app.tar.gz.sig",
  "Tesina-macos-universal.dmg",
  "latest.json",
] as const;

const WINDOWS_ASSET_NAMES = [
  "Tesina-windows-x64.exe",
  "Tesina-windows-x64.exe.sig",
  "Tesina-windows-x64.msi",
  "Tesina-windows-x64.msi.sig",
] as const;

const DARWIN_PLATFORM_KEYS = [
  "darwin-universal",
  "darwin-aarch64",
  "darwin-x86_64",
  "darwin-universal-app",
  "darwin-aarch64-app",
  "darwin-x86_64-app",
] as const;

/** The updater installs the NSIS setup; the MSI key exists for manual picks. */
const WINDOWS_EXE_PLATFORM_KEYS = [
  "windows-x86_64",
  "windows-x86_64-nsis",
] as const;

export type ReleaseDraftStage = "macos" | "full";

interface ReleaseDraftContract {
  release: unknown;
  manifest: unknown;
  version: string;
  notes: string;
  signatureAsset: string;
  stage?: ReleaseDraftStage;
  windowsExeSignature?: string;
  windowsMsiSignature?: string;
}

interface PlatformExpectation {
  assetName: string;
  url: string;
  signature: string;
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
  const stage = contract.stage ?? "macos";
  if (
    stage === "full" &&
    (!contract.windowsExeSignature || !contract.windowsMsiSignature)
  ) {
    throw new Error("full stage requires both Windows signature assets.");
  }

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
    stringField(
      `release asset ${index + 1} browser download URL`,
      asset.browser_download_url,
    );
    return {
      name: stringField(`release asset ${index + 1} name`, asset.name),
      url: stringField(
        `release asset ${index + 1} REST API URL`,
        asset.url,
      ),
    };
  });
  const expectedAssetNames = stage === "full"
    ? [...MACOS_ASSET_NAMES, ...WINDOWS_ASSET_NAMES]
    : [...MACOS_ASSET_NAMES];
  const actualAssetNames = assets.map(({ name }) => name).sort();
  if (
    JSON.stringify(actualAssetNames) !==
      JSON.stringify([...expectedAssetNames].sort())
  ) {
    throw new Error(
      `release asset names do not match the ${
        stage === "full" ? "release" : "macOS"
      } contract: ${actualAssetNames.join(", ")}`,
    );
  }

  function assetUrl(name: string): string {
    const url = assets.find((asset) => asset.name === name)?.url;
    if (!url) throw new Error(`release has no "${name}" asset.`);
    return url;
  }

  if (manifest.version !== contract.version) {
    throw new Error(`latest.json version must be "${contract.version}".`);
  }
  if (manifest.notes !== contract.notes) {
    throw new Error("latest.json notes do not match the release body.");
  }

  const archiveUrl = assetUrl("Tesina-macos-universal.app.tar.gz");
  const expectations = new Map<string, PlatformExpectation>();
  for (const key of DARWIN_PLATFORM_KEYS) {
    expectations.set(key, {
      assetName: "Tesina-macos-universal.app.tar.gz",
      url: archiveUrl,
      signature: contract.signatureAsset,
    });
  }
  if (stage === "full") {
    const exeUrl = assetUrl("Tesina-windows-x64.exe");
    for (const key of WINDOWS_EXE_PLATFORM_KEYS) {
      expectations.set(key, {
        assetName: "Tesina-windows-x64.exe",
        url: exeUrl,
        signature: contract.windowsExeSignature as string,
      });
    }
    expectations.set("windows-x86_64-msi", {
      assetName: "Tesina-windows-x64.msi",
      url: assetUrl("Tesina-windows-x64.msi"),
      signature: contract.windowsMsiSignature as string,
    });
  }

  const platforms = record("latest.json platforms", manifest.platforms);
  for (const [key, expectation] of expectations) {
    if (!(key in platforms)) {
      throw new Error(`latest.json is missing platform "${key}".`);
    }

    const platform = record(`latest.json platform ${key}`, platforms[key]);
    const signature = stringField(
      `latest.json platform ${key} signature`,
      platform.signature,
    );
    if (signature !== expectation.signature) {
      throw new Error(
        `signature asset does not match latest.json platform "${key}".`,
      );
    }
    const url = stringField(`latest.json platform ${key} URL`, platform.url);
    // The pinned tauri-action emits asset.url; the updater requests it as octet-stream.
    if (url !== expectation.url) {
      throw new Error(
        `latest.json platform "${key}" does not point to ${expectation.assetName}.`,
      );
    }
  }

  for (const key of Object.keys(platforms)) {
    if (!expectations.has(key)) {
      throw new Error(`unexpected updater platform "${key}" in latest.json.`);
    }
  }
}

if (import.meta.main) {
  try {
    const [
      releasePath,
      manifestPath,
      notesPath,
      version,
      signaturePath,
      stageArg,
      exeSignaturePath,
      msiSignaturePath,
    ] = Deno.args;
    const stage: ReleaseDraftStage = stageArg === undefined
      ? "macos"
      : stageArg === "full"
      ? "full"
      : (() => {
        throw new Error(`unknown verification stage "${stageArg}".`);
      })();
    const argCountValid = stage === "macos"
      ? Deno.args.length === 5
      : Deno.args.length === 8 && !!exeSignaturePath && !!msiSignaturePath;
    if (
      !releasePath || !manifestPath || !notesPath || !version ||
      !signaturePath || !argCountValid
    ) {
      throw new Error(
        "Usage: deno run --allow-read scripts/verify-release-draft.ts " +
          "<release-json> <latest-json> <notes> <version> <macos-signature> " +
          "[full <exe-signature> <msi-signature>]",
      );
    }

    const [releaseJson, manifestJson, notesFile, signatureAsset] = await Promise
      .all([
        Deno.readTextFile(releasePath),
        Deno.readTextFile(manifestPath),
        Deno.readTextFile(notesPath),
        Deno.readTextFile(signaturePath),
      ]);
    const [windowsExeSignature, windowsMsiSignature] = stage === "full"
      ? await Promise.all([
        Deno.readTextFile(exeSignaturePath),
        Deno.readTextFile(msiSignaturePath),
      ])
      : [undefined, undefined];
    verifyReleaseDraft({
      release: JSON.parse(releaseJson),
      manifest: JSON.parse(manifestJson),
      version,
      notes: notesFile.trim(),
      signatureAsset,
      stage,
      windowsExeSignature,
      windowsMsiSignature,
    });
    console.log(
      stage === "full"
        ? "Verified the final draft release assets and two-platform updater manifest."
        : "Verified macOS draft release assets and updater manifest.",
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exitCode = 1;
  }
}

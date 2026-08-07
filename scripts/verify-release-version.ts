import { extractReleaseNotes } from "./extract-release-notes.ts";

export interface ReleaseVersionContract {
  tag: string;
  tauriConfig: string;
  packageJson: string;
  cargoToml: string;
  changelog: string;
}

function parseJsonVersion(label: string, contents: string): string {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error(`${label} metadata is not valid JSON.`);
  }

  if (
    typeof value !== "object" || value === null ||
    typeof (value as { version?: unknown }).version !== "string" ||
    (value as { version: string }).version.trim() === ""
  ) {
    throw new Error(`${label} metadata has no version string.`);
  }

  return (value as { version: string }).version;
}

function parseCargoPackageVersion(contents: string): string {
  let inPackageTable = false;

  for (const line of contents.split(/\r?\n/)) {
    const table = /^\s*\[([^\]]+)]\s*$/.exec(line);
    if (table) {
      inPackageTable = table[1] === "package";
      continue;
    }

    if (!inPackageTable) continue;
    const version = /^\s*version\s*=\s*"([^"]+)"\s*(?:#.*)?$/.exec(line);
    if (version) return version[1];
  }

  throw new Error("Cargo metadata has no [package] version string.");
}

export function verifyReleaseVersion(
  contract: ReleaseVersionContract,
): string {
  const tag = /^v(.+)$/.exec(contract.tag);
  if (!tag) {
    throw new Error(
      `Release tag must start with "v"; received "${contract.tag}".`,
    );
  }
  const version = tag[1];

  const versions = [
    ["Tauri", parseJsonVersion("Tauri", contract.tauriConfig)],
    ["package", parseJsonVersion("package", contract.packageJson)],
    ["Cargo", parseCargoPackageVersion(contract.cargoToml)],
  ] as const;

  for (const [label, actual] of versions) {
    if (actual !== version) {
      throw new Error(
        `${label} version must be "${version}"; received "${actual}".`,
      );
    }
  }

  extractReleaseNotes(contract.changelog, version);
  return version;
}

if (import.meta.main) {
  try {
    const [
      tag,
      tauriConfigPath,
      packageJsonPath,
      cargoTomlPath,
      changelogPath,
    ] = Deno.args;
    if (
      !tag || !tauriConfigPath || !packageJsonPath || !cargoTomlPath ||
      !changelogPath || Deno.args.length !== 5
    ) {
      throw new Error(
        "Usage: deno run --allow-read scripts/verify-release-version.ts <tag> <tauri-config> <package-json> <cargo-toml> <changelog>",
      );
    }

    const [tauriConfig, packageJson, cargoToml, changelog] = await Promise.all([
      Deno.readTextFile(tauriConfigPath),
      Deno.readTextFile(packageJsonPath),
      Deno.readTextFile(cargoTomlPath),
      Deno.readTextFile(changelogPath),
    ]);
    const version = verifyReleaseVersion({
      tag,
      tauriConfig,
      packageJson,
      cargoToml,
      changelog,
    });
    console.log(`Verified release version ${version}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exitCode = 1;
  }
}

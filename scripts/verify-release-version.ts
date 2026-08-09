import { extractReleaseNotes } from "../apps/desktop/src/lib/update/extractReleaseNotes.ts";

export interface ReleaseVersionContract {
  tag: string;
  tauriConfig: string;
  packageJson: string;
  cargoToml: string;
  cargoLock: string;
  changelog: string;
}

export interface VerifiedReleaseVersion {
  readonly version: string;
  readonly notes: string;
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

function parseCargoLockPackageVersion(
  contents: string,
  packageName: string,
): string {
  const versions: string[] = [];
  const packages = contents.split(/(?=^\[\[package\]\][ \t]*\r?$)/m);

  for (const packageBlock of packages) {
    if (!/^\[\[package\]\][ \t]*\r?$/m.test(packageBlock)) continue;
    const name = /^name\s*=\s*"([^"]+)"\s*(?:#.*)?$/m.exec(packageBlock)?.[1];
    if (name !== packageName) continue;

    const version = /^version\s*=\s*"([^"]+)"\s*(?:#.*)?$/m.exec(
      packageBlock,
    )?.[1];
    if (!version) {
      throw new Error(
        `Cargo.lock package "${packageName}" has no version string.`,
      );
    }
    versions.push(version);
  }

  if (versions.length !== 1) {
    throw new Error(
      `Cargo.lock must contain exactly one "${packageName}" package; found ${versions.length}.`,
    );
  }
  return versions[0];
}

export function verifyReleaseVersion(
  contract: ReleaseVersionContract,
): VerifiedReleaseVersion {
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
    [
      "Cargo.lock Tesina package",
      parseCargoLockPackageVersion(contract.cargoLock, "tesina"),
    ],
  ] as const;

  for (const [label, actual] of versions) {
    if (actual !== version) {
      throw new Error(
        `${label} version must be "${version}"; received "${actual}".`,
      );
    }
  }

  return Object.freeze({
    version,
    notes: extractReleaseNotes(contract.changelog, version),
  });
}

if (import.meta.main) {
  try {
    const [
      tag,
      tauriConfigPath,
      packageJsonPath,
      cargoTomlPath,
      cargoLockPath,
      changelogPath,
      notesOutputPath,
    ] = Deno.args;
    if (
      !tag || !tauriConfigPath || !packageJsonPath || !cargoTomlPath ||
      !cargoLockPath || !changelogPath || !notesOutputPath ||
      Deno.args.length !== 7
    ) {
      throw new Error(
        "Usage: deno run --allow-read --allow-write=<notes-output> scripts/verify-release-version.ts <tag> <tauri-config> <package-json> <cargo-toml> <cargo-lock> <changelog> <notes-output>",
      );
    }

    try {
      const existingOutput = await Deno.lstat(notesOutputPath);
      if (!existingOutput.isFile) {
        throw new Error("Release notes output path must be a regular file.");
      }
      await Deno.remove(notesOutputPath);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }

    const [tauriConfig, packageJson, cargoToml, cargoLock, changelog] =
      await Promise.all([
        Deno.readTextFile(tauriConfigPath),
        Deno.readTextFile(packageJsonPath),
        Deno.readTextFile(cargoTomlPath),
        Deno.readTextFile(cargoLockPath),
        Deno.readTextFile(changelogPath),
      ]);
    const verified = verifyReleaseVersion({
      tag,
      tauriConfig,
      packageJson,
      cargoToml,
      cargoLock,
      changelog,
    });
    await Deno.writeTextFile(notesOutputPath, verified.notes);
    console.log(`Verified release version ${verified.version}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exitCode = 1;
  }
}

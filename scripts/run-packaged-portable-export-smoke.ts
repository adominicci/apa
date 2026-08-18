import { dirname, join } from "node:path";
import process from "node:process";
import { canonicalJsonBytes } from "../apps/desktop/src/lib/portable/canonicalJson.ts";
import { fullLibraryFixture } from "../apps/desktop/src/lib/portable/fixtures/libraries.ts";
import { executeBoundedProcess } from "../apps/desktop/src/lib/editor/pagination/proof/proofProcess.ts";
import { ARCHIVE_LIMITS } from "../apps/desktop/src/lib/portable/limits.ts";
import {
  ownedProcessStatusWithin,
  packagedSmokeBundleIdentifier,
  runWithRequiredCleanup,
  terminateOwnedProcess,
} from "./packaged-macos-smoke.ts";
import { readEvidenceFileBounded } from "./inspect-portable-library-evidence.ts";
import { verifyPackagedPortableExport } from "./verify-packaged-portable-export.ts";

export const PACKAGED_SMOKE_TIMEOUT_MS = 30_000;
const BUILD_TIMEOUT_MS = 10 * 60_000;
const BASE_IDENTIFIER = "app.tesina.desktop.portable-smoke";

async function writeFile(path: string, bytes: Uint8Array): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeFile(path, bytes);
}

async function seedPersistedFixture(appDataDir: string): Promise<void> {
  const fixture = fullLibraryFixture();
  for (const essay of fixture.essays) {
    await writeFile(
      join(appDataDir, "essays", `${essay.id}.json`),
      canonicalJsonBytes(essay),
    );
  }
  await writeFile(
    join(appDataDir, "library.json"),
    canonicalJsonBytes(fixture.library),
  );
  for (
    const [path, bytes] of Object.entries({
      ...fixture.assets,
      ...fixture.orphanAssets,
    })
  ) {
    await writeFile(join(appDataDir, path), bytes);
  }
}

async function plistValue(path: string, key: string): Promise<string> {
  const result = await executeBoundedProcess(
    "plutil",
    ["-extract", key, "raw", "-o", "-", path],
    { timeoutMs: 10_000 },
  );
  if (result.code !== 0) {
    throw new Error(`cannot read packaged ${key}: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

if (process.platform !== "darwin") {
  throw new Error("Packaged portable export smoke can run only on macOS");
}

const ownedRoot = await Deno.makeTempDir({
  prefix: "tesina-packaged-portable-smoke-",
});
let child: Deno.ChildProcess | undefined;
await runWithRequiredCleanup(
  async () => {
    const cargoTarget = join(ownedRoot, "cargo-target");
    const packagedIdentifier = packagedSmokeBundleIdentifier(BASE_IDENTIFIER);
    const config = JSON.parse(
      await Deno.readTextFile(
        "apps/desktop/src-tauri/tauri.portable-smoke.conf.json",
      ),
    );
    config.identifier = packagedIdentifier;
    const configPath = join(ownedRoot, "tauri.portable-smoke.conf.json");
    await Deno.writeTextFile(configPath, JSON.stringify(config));
    const build = await executeBoundedProcess(
      "deno",
      [
        "task",
        "--cwd",
        "apps/desktop",
        "tauri",
        "build",
        "--features",
        "packaged-portable-smoke",
        "--bundles",
        "app",
        "--config",
        configPath,
        "--ci",
      ],
      {
        timeoutMs: BUILD_TIMEOUT_MS,
        env: {
          ...process.env,
          CARGO_TARGET_DIR: cargoTarget,
          VITE_TESINA_PACKAGED_PORTABLE_SMOKE: "1",
        },
      },
    );
    if (build.code !== 0) {
      throw new Error(`smoke app build failed: ${build.stderr.trim()}`);
    }

    const appPath = join(
      cargoTarget,
      "release",
      "bundle",
      "macos",
      "Tesina Portable Smoke.app",
    );
    const infoPlist = join(appPath, "Contents", "Info.plist");
    const executableName = await plistValue(infoPlist, "CFBundleExecutable");
    const appVersion = await plistValue(
      infoPlist,
      "CFBundleShortVersionString",
    );
    const actualIdentifier = await plistValue(
      infoPlist,
      "CFBundleIdentifier",
    );
    if (actualIdentifier !== packagedIdentifier) {
      throw new Error("smoke app used an unexpected bundle identifier");
    }

    const isolatedHome = join(ownedRoot, "home");
    const appDataDir = join(
      isolatedHome,
      "Library",
      "Application Support",
      packagedIdentifier,
    );
    const destination = join(ownedRoot, "export", "Tesina Library.tesina");
    await Deno.mkdir(dirname(destination), { recursive: true });
    await seedPersistedFixture(appDataDir);

    const executablePath = join(
      appPath,
      "Contents",
      "MacOS",
      executableName,
    );
    child = new Deno.Command(executablePath, {
      env: {
        HOME: isolatedHome,
        TESINA_PACKAGED_PORTABLE_SMOKE_DESTINATION: destination,
      },
      stdout: "null",
      stderr: "inherit",
    }).spawn();
    const statusPromise = child.status;
    const status = await ownedProcessStatusWithin(
      statusPromise,
      PACKAGED_SMOKE_TIMEOUT_MS,
    );
    if (status === undefined) {
      await terminateOwnedProcess(child);
      child = undefined;
      throw new Error(
        `packaged portable export exceeded ${PACKAGED_SMOKE_TIMEOUT_MS}ms`,
      );
    }
    child = undefined;
    if (!status.success) {
      throw new Error(
        `packaged portable export exited ${status.code}`,
      );
    }

    const evidence = await verifyPackagedPortableExport(
      await readEvidenceFileBounded(
        destination,
        ARCHIVE_LIMITS.maxArchiveBytes,
      ),
      fullLibraryFixture(),
      appVersion,
    );
    return {
      ...evidence,
      appVersion,
      bundleIdentifier: actualIdentifier,
    };
  },
  async () => {
    try {
      if (child !== undefined) {
        await terminateOwnedProcess(child);
      }
    } finally {
      await Deno.remove(ownedRoot, { recursive: true });
    }
  },
  (evidence) => console.log(JSON.stringify(evidence)),
);

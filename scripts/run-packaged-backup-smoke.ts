import { createHash } from "node:crypto";
import { dirname, join, relative, sep } from "node:path";
import process from "node:process";
import { buildArchive } from "../apps/desktop/src/lib/portable/archive.ts";
import { fullLibraryFixture } from "../apps/desktop/src/lib/portable/fixtures/libraries.ts";
import { ARCHIVE_LIMITS } from "../apps/desktop/src/lib/portable/limits.ts";
import { assembleArchiveContent } from "../apps/desktop/src/lib/portable/snapshot.ts";
import {
  executeBoundedProcess,
  type ProcessOutput,
} from "../apps/desktop/src/lib/editor/pagination/proof/proofProcess.ts";
import { readEvidenceFileBounded } from "./inspect-portable-library-evidence.ts";
import {
  environmentWithActiveDeno,
  ownedProcessStatusWithin,
  packagedSmokeBundleIdentifier,
  runWithRequiredCleanup,
  terminateOwnedProcess,
} from "./packaged-macos-smoke.ts";
import {
  PACKAGED_BACKUP_PHASES,
  type PackagedBackupPhase,
  type PackagedBackupPhaseEvidence,
  verifyPackagedBackupSmoke,
} from "./verify-packaged-backup-smoke.ts";
import {
  type PackagedPortableExportEvidence,
  verifyPackagedPortableExport,
} from "./verify-packaged-portable-export.ts";

const BASE_IDENTIFIER = "app.tesina.desktop.backup-smoke";
const SMOKE_CONFIG_PATH = "apps/desktop/src-tauri/tauri.backup-smoke.conf.json";
const APP_CONFIG_PATH = "apps/desktop/src-tauri/tauri.conf.json";
const BUILD_TIMEOUT_MS = 15 * 60_000;
const INSTALL_TIMEOUT_MS = 2 * 60_000;
const REGISTRY_TIMEOUT_MS = 10_000;
const REGISTRY_QUERY_OUTPUT_LIMIT_BYTES = 4 * 1024;
const PHASE_TIMEOUT_MS = 2 * 60_000;
const EVIDENCE_LIMIT_BYTES = 64 * 1024;
const MAX_HASHED_FILE_BYTES = 512 * 1024 * 1024;
const EVIDENCE_DIR = "packaged-backup-smoke";
const FOREIGN_EVIDENCE_FILE = "Foreign Evidence.tesina";
const FOREIGN_EVIDENCE_BYTES = new TextEncoder().encode(
  "runner-owned-foreign-evidence",
);
// This is also the fallback manufacturer derived by the locked Tauri bundler
// from the second segment of every generated smoke bundle identifier.
const WINDOWS_NSIS_PUBLISHER = "tesina";
const REGISTRY_MISSING_DIAGNOSTIC =
  "ERROR: The system was unable to find the specified registry key or value.";
export const MARKER_FILE_NAME = ".tesina-packaged-backup-smoke-owner";

interface PhasePaths {
  proofCommitSha: string;
  folderA: string;
  folderB: string;
  transient: string;
  exportPath: string;
}

interface AppDirectoryInputs {
  home?: string;
  windowsRoaming?: string;
  windowsLocal?: string;
}

interface AppDirectories {
  appDataDir: string;
  appCacheDir: string;
}

interface PackageArtifacts {
  executablePath: string;
  packagePath: string;
}

interface PhaseChildProcess {
  readonly status: Promise<Deno.CommandStatus>;
  kill(signal: Deno.Signal): void;
}

interface PhaseCommandOptions {
  env: Record<string, string>;
  stdout: "null";
  stderr: "inherit";
}

type PhaseProcessSpawner = (
  executablePath: string,
  options: PhaseCommandOptions,
) => PhaseChildProcess;

const SMOKE_ENV_KEYS = new Set([
  "TESINA_PROOF_COMMIT_SHA",
  "TESINA_PACKAGED_BACKUP_SMOKE_PHASE",
  "TESINA_PACKAGED_BACKUP_SMOKE_SELECTION",
  "TESINA_PACKAGED_BACKUP_SMOKE_TRANSIENT",
  "TESINA_PACKAGED_PORTABLE_SMOKE_DESTINATION",
]);

function normalizedRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", owned.buffer);
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function sha256File(path: string): Promise<string> {
  const info = await Deno.stat(path);
  if (!info.isFile || info.size > MAX_HASHED_FILE_BYTES) {
    throw new Error(`packaged backup smoke cannot hash file: ${path}`);
  }
  const file = await Deno.open(path, { read: true });
  const digest = createHash("sha256");
  try {
    const buffer = new Uint8Array(64 * 1024);
    while (true) {
      const count = await file.read(buffer);
      if (count === null) break;
      digest.update(buffer.subarray(0, count));
    }
  } finally {
    file.close();
  }
  return digest.digest("hex");
}

/** Sorted file/symlink digest map used for old-folder and package evidence. */
export async function snapshotDirectory(
  root: string,
): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  async function walk(directory: string): Promise<void> {
    const entries = [];
    for await (const entry of Deno.readDir(directory)) entries.push(entry);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relPath = normalizedRelative(root, path);
      if (entry.isDirectory) {
        await walk(path);
      } else if (entry.isFile) {
        snapshot[relPath] = await sha256File(path);
      } else if (entry.isSymlink) {
        snapshot[relPath] = await sha256Bytes(
          new TextEncoder().encode(`symlink:${await Deno.readLink(path)}`),
        );
      } else {
        throw new Error(
          `packaged backup smoke found unsupported file: ${path}`,
        );
      }
    }
  }
  await walk(root);
  return snapshot;
}

export function appDirectoriesForPlatform(
  platform: typeof process.platform,
  identifier: string,
  inputs: AppDirectoryInputs,
): AppDirectories {
  if (platform === "darwin") {
    if (!inputs.home) throw new Error("packaged backup smoke requires HOME");
    return {
      appDataDir: join(
        inputs.home,
        "Library",
        "Application Support",
        identifier,
      ),
      appCacheDir: join(inputs.home, "Library", "Caches", identifier),
    };
  }
  if (platform === "win32") {
    if (!inputs.windowsRoaming || !inputs.windowsLocal) {
      throw new Error("packaged backup smoke requires Windows Known Folders");
    }
    return {
      appDataDir: join(inputs.windowsRoaming, identifier),
      appCacheDir: join(inputs.windowsLocal, identifier),
    };
  }
  throw new Error("packaged backup smoke supports only macOS and Windows");
}

export function phaseEnvironment(
  phase: PackagedBackupPhase,
  paths: PhasePaths,
): Record<string, string> {
  const env: Record<string, string> = {
    TESINA_PACKAGED_BACKUP_SMOKE_PHASE: phase,
    TESINA_PROOF_COMMIT_SHA: paths.proofCommitSha,
  };
  if (phase === "configure") {
    env.TESINA_PACKAGED_BACKUP_SMOKE_SELECTION = paths.folderA;
    env.TESINA_PACKAGED_BACKUP_SMOKE_TRANSIENT = paths.transient;
    env.TESINA_PACKAGED_PORTABLE_SMOKE_DESTINATION = paths.exportPath;
  } else if (phase === "restart") {
    env.TESINA_PACKAGED_PORTABLE_SMOKE_DESTINATION = paths.exportPath;
  } else if (phase === "reconfigure") {
    env.TESINA_PACKAGED_BACKUP_SMOKE_SELECTION = paths.folderB;
  }
  return env;
}

export function sanitizeSmokeEnvironment(
  env: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !SMOKE_ENV_KEYS.has(entry[0]),
    ),
  );
}

async function prepareMarkedDirectory(
  path: string,
  marker: string,
): Promise<void> {
  if (await exists(path)) {
    throw new Error(`packaged backup smoke app root already exists: ${path}`);
  }
  await Deno.mkdir(path, { recursive: true });
  await Deno.writeTextFile(join(path, MARKER_FILE_NAME), marker);
}

/** Refuses recursive deletion unless the run-specific ownership marker matches. */
export async function removeMarkedDirectory(
  path: string,
  marker: string,
): Promise<void> {
  if (!(await exists(path))) return;
  const markerPath = join(path, MARKER_FILE_NAME);
  if (!(await exists(markerPath))) {
    throw new Error(
      `missing ownership marker for packaged backup smoke: ${path}`,
    );
  }
  if (await Deno.readTextFile(markerPath) !== marker) {
    throw new Error(
      `ownership marker mismatch for packaged backup smoke: ${path}`,
    );
  }
  await Deno.remove(path, { recursive: true });
}

export async function cleanupMarkedDirectories(
  paths: readonly string[],
  marker: string,
): Promise<void> {
  const errors: unknown[] = [];
  for (const path of paths) {
    try {
      await removeMarkedDirectory(path, marker);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      "packaged backup smoke required cleanup failed",
    );
  }
}

async function windowsKnownFolders(): Promise<{
  roaming: string;
  local: string;
}> {
  const output = await executeBoundedProcess(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[Environment]::GetFolderPath('ApplicationData'); [Environment]::GetFolderPath('LocalApplicationData')",
    ],
    { timeoutMs: 10_000 },
  );
  if (output.code !== 0) {
    throw new Error("cannot resolve Windows Known Folders for packaged smoke");
  }
  const [roaming, local, ...extra] = output.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!roaming || !local || extra.length !== 0) {
    throw new Error("Windows Known Folder output was incomplete");
  }
  return { roaming, local };
}

async function readJsonBounded<T>(path: string): Promise<T> {
  const info = await Deno.stat(path);
  if (!info.isFile || info.size > EVIDENCE_LIMIT_BYTES) {
    throw new Error(`packaged backup smoke evidence is not bounded: ${path}`);
  }
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

async function oneChildPath(
  directory: string,
  predicate: (name: string) => boolean,
): Promise<string> {
  const matches: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (predicate(entry.name)) matches.push(join(directory, entry.name));
  }
  if (matches.length !== 1) {
    throw new Error(
      `packaged backup smoke expected one artifact in ${directory}, got ${matches.length}`,
    );
  }
  return matches[0]!;
}

export async function resolvePackageArtifacts(
  platform: typeof process.platform,
  cargoTarget: string,
  windowsInstallDir?: string,
  execute: typeof executeBoundedProcess = executeBoundedProcess,
): Promise<PackageArtifacts> {
  if (platform === "darwin") {
    const packagePath = await oneChildPath(
      join(cargoTarget, "release", "bundle", "macos"),
      (name) => name.endsWith(".app"),
    );
    const plist = join(packagePath, "Contents", "Info.plist");
    const executable = await execute(
      "plutil",
      ["-extract", "CFBundleExecutable", "raw", "-o", "-", plist],
      { timeoutMs: 10_000 },
    );
    if (executable.code !== 0 || executable.stdout.trim() === "") {
      throw new Error("cannot resolve packaged macOS executable");
    }
    return {
      executablePath: join(
        packagePath,
        "Contents",
        "MacOS",
        executable.stdout.trim(),
      ),
      packagePath,
    };
  }
  if (platform === "win32") {
    if (windowsInstallDir === undefined) {
      throw new Error(
        "packaged backup smoke requires an owned Windows install directory",
      );
    }
    if (await exists(windowsInstallDir)) {
      throw new Error(
        `packaged backup smoke Windows install directory already exists: ${windowsInstallDir}`,
      );
    }
    const packagePath = await oneChildPath(
      join(cargoTarget, "release", "bundle", "nsis"),
      (name) => name.endsWith("-setup.exe"),
    );
    const install = await execute(
      packagePath,
      ["/S", "/NS", `/D=${windowsInstallDir}`],
      { timeoutMs: INSTALL_TIMEOUT_MS },
    );
    if (install.code !== 0) {
      throw new Error(
        `packaged backup smoke NSIS install failed: ${install.stderr}`,
      );
    }
    const executablePath = join(windowsInstallDir, "tesina.exe");
    const windowsUninstallerPath = join(windowsInstallDir, "uninstall.exe");
    for (const path of [executablePath, windowsUninstallerPath]) {
      const info = await Deno.lstat(path);
      if (!info.isFile) {
        throw new Error(`packaged backup smoke NSIS file is invalid: ${path}`);
      }
    }
    return {
      executablePath,
      packagePath,
    };
  }
  throw new Error("packaged backup smoke supports only macOS and Windows");
}

function classifyRegistryQuery(output: ProcessOutput): "present" | "absent" {
  const diagnostic = `${output.stdout}\n${output.stderr}`;
  if (
    new TextEncoder().encode(diagnostic).byteLength >
      REGISTRY_QUERY_OUTPUT_LIMIT_BYTES
  ) {
    throw new Error(
      "packaged backup smoke reg.exe query output exceeded its bound",
    );
  }
  if (output.code === 0) return "present";
  const diagnosticLines = diagnostic
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (
    output.code === 1 &&
    diagnosticLines.length === 1 &&
    diagnosticLines[0]?.toLowerCase() ===
      REGISTRY_MISSING_DIAGNOSTIC.toLowerCase()
  ) {
    return "absent";
  }
  if (output.code === 1) {
    throw new Error(
      "packaged backup smoke unexpected reg.exe query failure: 1",
    );
  }
  throw new Error(
    `packaged backup smoke unexpected reg.exe query status: ${output.code}`,
  );
}

export async function uninstallWindowsPackage(
  uninstallerPath: string,
  installDir: string,
  productName: string,
  execute: typeof executeBoundedProcess = executeBoundedProcess,
): Promise<void> {
  if (
    productName.trim() === "" || productName.includes("\\") ||
    productName.includes("/") ||
    [...productName].some((character) => character.charCodeAt(0) < 0x20)
  ) {
    throw new Error("packaged backup smoke NSIS product name is unsafe");
  }
  const info = await Deno.lstat(uninstallerPath);
  if (!info.isFile) {
    throw new Error(
      `packaged backup smoke NSIS uninstaller is invalid: ${uninstallerPath}`,
    );
  }
  const uninstall = await execute(
    uninstallerPath,
    ["/S", `_?=${installDir}`],
    { timeoutMs: INSTALL_TIMEOUT_MS },
  );
  if (uninstall.code !== 0) {
    throw new Error(
      `packaged backup smoke NSIS uninstall failed: ${uninstall.stderr}`,
    );
  }
  if (await exists(join(installDir, "tesina.exe"))) {
    throw new Error(
      "packaged backup smoke NSIS uninstall left the executable installed",
    );
  }

  const productKey =
    `HKCU\\Software\\${WINDOWS_NSIS_PUBLISHER}\\${productName}`;
  const uninstallKey =
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${productName}`;
  const retainedProduct = await execute(
    "reg.exe",
    ["query", productKey, "/ve"],
    { timeoutMs: REGISTRY_TIMEOUT_MS },
  );
  if (classifyRegistryQuery(retainedProduct) === "present") {
    const values = retainedProduct.stdout
      .split(/\r?\n/)
      .flatMap((line) => {
        const match = /^\s*.*?\s+REG_SZ\s+(.*?)\s*$/i.exec(line);
        return match?.[1] === undefined ? [] : [match[1]];
      });
    if (values.length !== 1) {
      throw new Error(
        "packaged backup smoke retained NSIS product key has no unique default path",
      );
    }
    if (values[0] !== installDir) {
      throw new Error(
        "packaged backup smoke retained NSIS product key does not match the owned install directory",
      );
    }
    const deleted = await execute(
      "reg.exe",
      ["delete", productKey, "/f"],
      { timeoutMs: REGISTRY_TIMEOUT_MS },
    );
    if (deleted.code !== 0) {
      throw new Error(
        `packaged backup smoke reg.exe delete failed: ${deleted.code}`,
      );
    }
  }

  for (const key of [productKey, uninstallKey]) {
    const absent = await execute(
      "reg.exe",
      ["query", key],
      { timeoutMs: REGISTRY_TIMEOUT_MS },
    );
    if (classifyRegistryQuery(absent) === "present") {
      throw new Error(
        `packaged backup smoke NSIS registry key still exists: ${key}`,
      );
    }
  }
}

async function packageSha256(path: string): Promise<string> {
  const info = await Deno.stat(path);
  if (info.isFile) return await sha256File(path);
  if (!info.isDirectory) throw new Error("unsupported packaged artifact");
  return await sha256Bytes(
    new TextEncoder().encode(JSON.stringify(await snapshotDirectory(path))),
  );
}

async function verifyRestoredLibrary(
  appDataDir: string,
  appVersion: string,
): Promise<PackagedPortableExportEvidence> {
  const fixture = fullLibraryFixture();
  const essaysDir = join(appDataDir, "essays");
  const actualEssayNames: string[] = [];
  for await (const entry of Deno.readDir(essaysDir)) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      actualEssayNames.push(entry.name);
    }
  }
  actualEssayNames.sort();
  const expectedEssayNames = fixture.essays.map((essay) => `${essay.id}.json`)
    .sort();
  if (JSON.stringify(actualEssayNames) !== JSON.stringify(expectedEssayNames)) {
    throw new Error("restored packaged library has the wrong essay set");
  }
  const essays = await Promise.all(
    actualEssayNames.map(async (name) =>
      JSON.parse(await Deno.readTextFile(join(essaysDir, name)))
    ),
  );
  const library = JSON.parse(
    await Deno.readTextFile(join(appDataDir, "library.json")),
  );
  const assets = new Map<string, Uint8Array>();
  for (const path of Object.keys(fixture.assets).sort()) {
    assets.set(path, await Deno.readFile(join(appDataDir, path)));
  }
  const archive = await buildArchive(
    assembleArchiveContent({ essays, library, assets }),
    {
      now: () => "2026-08-18T12:00:00.000Z",
      appVersion,
    },
  );
  return await verifyPackagedPortableExport(archive, fixture, appVersion);
}

export async function launchPhase(
  executablePath: string,
  env: Record<string, string>,
  spawnPhase: PhaseProcessSpawner = (path, options) =>
    new Deno.Command(path, options).spawn() as PhaseChildProcess,
): Promise<number> {
  const child = spawnPhase(executablePath, {
    env,
    stdout: "null",
    stderr: "inherit",
  });
  const status = await ownedProcessStatusWithin(child.status, PHASE_TIMEOUT_MS);
  if (status === undefined) {
    await terminateOwnedProcess(child);
    throw new Error(
      `packaged backup smoke phase ${env.TESINA_PACKAGED_BACKUP_SMOKE_PHASE} timed out`,
    );
  }
  if (!status.success) {
    throw new Error(
      `packaged backup smoke phase ${env.TESINA_PACKAGED_BACKUP_SMOKE_PHASE} exited ${status.code}`,
    );
  }
  return status.code;
}

export function requireCleanGitStatus(status: string): void {
  if (status.trim() !== "") {
    throw new Error(
      "packaged backup smoke exact-SHA evidence requires a clean worktree",
    );
  }
}

async function gitHead(): Promise<string> {
  const result = await executeBoundedProcess("git", ["rev-parse", "HEAD"], {
    timeoutMs: 10_000,
  });
  const head = result.stdout.trim();
  if (result.code !== 0 || !/^[0-9a-f]{40}$/.test(head)) {
    throw new Error("cannot resolve exact packaged backup smoke feature SHA");
  }
  const status = await executeBoundedProcess(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { timeoutMs: 10_000 },
  );
  if (status.code !== 0) {
    throw new Error("cannot verify packaged backup smoke worktree state");
  }
  requireCleanGitStatus(status.stdout);
  return head;
}

export async function executePackagedBackupBuild(
  platform: typeof process.platform,
  cargoTarget: string,
  generatedConfig: string,
  environment: Record<string, string | undefined>,
  execute: typeof executeBoundedProcess = executeBoundedProcess,
): Promise<void> {
  const build = await execute(
    Deno.execPath(),
    [
      "task",
      "--cwd",
      "apps/desktop",
      "tauri",
      "build",
      "--features",
      "packaged-backup-smoke",
      "--bundles",
      platform === "darwin" ? "app" : "nsis",
      "--config",
      generatedConfig,
      "--ci",
    ],
    {
      timeoutMs: BUILD_TIMEOUT_MS,
      env: {
        ...environmentWithActiveDeno(platform, environment),
        CARGO_TARGET_DIR: cargoTarget,
        VITE_TESINA_PACKAGED_BACKUP_SMOKE: "1",
      },
    },
  );
  if (build.code !== 0) {
    throw new Error(`packaged backup smoke build failed: ${build.stderr}`);
  }
}

async function run(): Promise<void> {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    throw new Error("Packaged backup smoke can run only on macOS or Windows");
  }
  const head = await gitHead();
  const requestedSha = Deno.env.get("TESINA_PROOF_COMMIT_SHA") ?? head;
  if (requestedSha !== head) {
    throw new Error("packaged backup smoke proof SHA does not match HEAD");
  }

  const ownedRoot = await Deno.makeTempDir({
    prefix: "tesina-packaged-backup-smoke-",
  });
  const runUuid = crypto.randomUUID();
  const marker = runUuid.replaceAll("-", "");
  await Deno.writeTextFile(join(ownedRoot, MARKER_FILE_NAME), marker);
  const bundleIdentifier = packagedSmokeBundleIdentifier(
    BASE_IDENTIFIER,
    runUuid,
  );
  const productName = `Tesina Backup Smoke ${marker.slice(0, 12)}`;
  const isolatedHome = join(ownedRoot, "home");
  const webviewDir = join(ownedRoot, "webview2");
  const cargoTarget = join(ownedRoot, "cargo-target");
  const windowsInstallDir = join(ownedRoot, "installed-package");
  const parent = join(ownedRoot, "selected-parent");
  const folderA = join(parent, "Folder A");
  const folderB = join(parent, "Folder B");
  const siblingDir = join(parent, "Sibling");
  const transient = join(ownedRoot, "transient", "Selected Import.tesina");
  const exportPath = join(ownedRoot, "export", "Tesina Library.tesina");
  const parentSentinel = join(parent, "Parent Evidence.bin");
  const siblingSentinel = join(siblingDir, "Sibling Evidence.bin");
  const exportSibling = join(ownedRoot, "export", "Export Sibling.bin");
  let appDirectories: AppDirectories | undefined;

  await runWithRequiredCleanup(
    async () => {
      await Deno.mkdir(folderA, { recursive: true });
      await Deno.mkdir(folderB, { recursive: true });
      await Deno.mkdir(siblingDir, { recursive: true });
      await Deno.mkdir(dirname(transient), { recursive: true });
      await Deno.mkdir(dirname(exportPath), { recursive: true });
      await Deno.writeFile(parentSentinel, new TextEncoder().encode("parent"));
      await Deno.writeFile(
        siblingSentinel,
        new TextEncoder().encode("sibling"),
      );
      await Deno.writeFile(
        exportSibling,
        new TextEncoder().encode("export-sibling"),
      );
      await Deno.writeFile(
        transient,
        new TextEncoder().encode("transient-scope-proof"),
      );
      await Deno.writeFile(
        exportPath,
        new TextEncoder().encode("preexisting-export-destination"),
      );
      await Deno.mkdir(webviewDir, { recursive: true });

      let directoryInputs: AppDirectoryInputs;
      if (process.platform === "darwin") {
        await Deno.mkdir(isolatedHome, { recursive: true });
        directoryInputs = { home: isolatedHome };
      } else {
        const known = await windowsKnownFolders();
        directoryInputs = {
          windowsRoaming: known.roaming,
          windowsLocal: known.local,
        };
      }
      appDirectories = appDirectoriesForPlatform(
        process.platform,
        bundleIdentifier,
        directoryInputs,
      );
      await prepareMarkedDirectory(appDirectories.appDataDir, marker);
      await prepareMarkedDirectory(appDirectories.appCacheDir, marker);

      const smokeConfig = JSON.parse(
        await Deno.readTextFile(SMOKE_CONFIG_PATH),
      );
      smokeConfig.identifier = bundleIdentifier;
      smokeConfig.productName = productName;
      smokeConfig.bundle.publisher = WINDOWS_NSIS_PUBLISHER;
      const generatedConfig = join(ownedRoot, "tauri.backup-smoke.conf.json");
      await Deno.writeTextFile(generatedConfig, JSON.stringify(smokeConfig));
      await executePackagedBackupBuild(
        process.platform,
        cargoTarget,
        generatedConfig,
        process.env,
      );
      const artifacts = await resolvePackageArtifacts(
        process.platform,
        cargoTarget,
        windowsInstallDir,
      );
      const executableSha256 = await sha256File(artifacts.executablePath);
      const packageDigest = await packageSha256(artifacts.packagePath);
      const appVersion =
        (JSON.parse(await Deno.readTextFile(APP_CONFIG_PATH)) as {
          version: string;
        }).version;
      const paths: PhasePaths = {
        proofCommitSha: head,
        folderA,
        folderB,
        transient,
        exportPath,
      };
      const baseEnv: Record<string, string> = {
        ...sanitizeSmokeEnvironment(process.env),
        WEBVIEW2_USER_DATA_FOLDER: webviewDir,
        ...(process.platform === "darwin" ? { HOME: isolatedHome } : {}),
      };
      const processExitCodes: number[] = [];
      const phaseEvidence: PackagedBackupPhaseEvidence[] = [];
      const evidencePath = (phase: PackagedBackupPhase) =>
        join(
          appDirectories!.appDataDir,
          EVIDENCE_DIR,
          `evidence-${phase}.json`,
        );

      processExitCodes.push(
        await launchPhase(
          artifacts.executablePath,
          { ...baseEnv, ...phaseEnvironment("configure", paths) },
        ),
      );
      phaseEvidence.push(
        await readJsonBounded<PackagedBackupPhaseEvidence>(
          evidencePath("configure"),
        ),
      );
      const configuredExport = await readEvidenceFileBounded(
        exportPath,
        ARCHIVE_LIMITS.maxArchiveBytes,
      );
      const configuredExportEvidence = await verifyPackagedPortableExport(
        configuredExport,
        fullLibraryFixture(),
        appVersion,
      );
      const manualExportSha256AfterConfigure = await sha256File(exportPath);

      processExitCodes.push(
        await launchPhase(
          artifacts.executablePath,
          { ...baseEnv, ...phaseEnvironment("restart", paths) },
        ),
      );
      phaseEvidence.push(
        await readJsonBounded<PackagedBackupPhaseEvidence>(
          evidencePath("restart"),
        ),
      );
      const restartedExport = await readEvidenceFileBounded(
        exportPath,
        ARCHIVE_LIMITS.maxArchiveBytes,
      );
      const restartedExportEvidence = await verifyPackagedPortableExport(
        restartedExport,
        fullLibraryFixture(),
        appVersion,
      );
      const manualExportSha256AfterRestart = await sha256File(exportPath);
      const oldFolderSnapshotBefore = await snapshotDirectory(folderA);

      const backupB = join(folderB, "Tesina Backups");
      await Deno.mkdir(backupB, { recursive: true });
      const foreignPath = join(backupB, FOREIGN_EVIDENCE_FILE);
      await Deno.writeFile(foreignPath, FOREIGN_EVIDENCE_BYTES);
      const sentinelHashesBefore = {
        parent: await sha256File(parentSentinel),
        sibling: await sha256File(siblingSentinel),
        exportSibling: await sha256File(exportSibling),
        foreign: await sha256File(foreignPath),
        transient: await sha256File(transient),
      };

      processExitCodes.push(
        await launchPhase(
          artifacts.executablePath,
          { ...baseEnv, ...phaseEnvironment("reconfigure", paths) },
        ),
      );
      phaseEvidence.push(
        await readJsonBounded<PackagedBackupPhaseEvidence>(
          evidencePath("reconfigure"),
        ),
      );
      const state = await readJsonBounded<{
        fixture: { deletedEssayId: string };
      }>(join(appDirectories.appDataDir, EVIDENCE_DIR, "state.json"));
      if (!/^[0-9a-f-]{36}$/i.test(state.fixture.deletedEssayId)) {
        throw new Error("packaged backup smoke state has an invalid essay id");
      }
      await Deno.remove(
        join(
          appDirectories.appDataDir,
          "essays",
          `${state.fixture.deletedEssayId}.json`,
        ),
      );

      processExitCodes.push(
        await launchPhase(
          artifacts.executablePath,
          { ...baseEnv, ...phaseEnvironment("restore", paths) },
        ),
      );
      phaseEvidence.push(
        await readJsonBounded<PackagedBackupPhaseEvidence>(
          evidencePath("restore"),
        ),
      );
      if (
        processExitCodes.length !== PACKAGED_BACKUP_PHASES.length ||
        phaseEvidence.length !== PACKAGED_BACKUP_PHASES.length
      ) {
        throw new Error("packaged backup smoke did not complete four phases");
      }

      const oldFolderSnapshotAfter = await snapshotDirectory(folderA);
      const sentinelHashesAfter = {
        parent: await sha256File(parentSentinel),
        sibling: await sha256File(siblingSentinel),
        exportSibling: await sha256File(exportSibling),
        foreign: await sha256File(foreignPath),
        transient: await sha256File(transient),
      };
      const activeArchiveNames: string[] = [];
      for await (const entry of Deno.readDir(backupB)) {
        if (
          entry.isFile && entry.name.endsWith(".tesina") &&
          entry.name !== FOREIGN_EVIDENCE_FILE
        ) {
          activeArchiveNames.push(entry.name);
        }
      }
      activeArchiveNames.sort();
      const restoredLibrary = await verifyRestoredLibrary(
        appDirectories.appDataDir,
        appVersion,
      );
      return verifyPackagedBackupSmoke({
        expected: {
          featureSha: head,
          bundleIdentifier,
          appVersion,
          exportPath,
        },
        phases: phaseEvidence,
        independent: {
          processExitCodes,
          executableSha256,
          packageSha256: packageDigest,
          manualExportSha256AfterConfigure,
          manualExportSha256AfterRestart,
          configuredExport: configuredExportEvidence,
          restartedExport: restartedExportEvidence,
          sentinelHashesBefore,
          sentinelHashesAfter,
          oldFolderSnapshotBefore,
          oldFolderSnapshotAfter,
          activeArchiveNames,
          foreignFileName: FOREIGN_EVIDENCE_FILE,
          restoredLibrary,
        },
      });
    },
    async () => {
      const errors: unknown[] = [];
      const windowsUninstallerPath = join(
        windowsInstallDir,
        "uninstall.exe",
      );
      if (
        process.platform === "win32" && await exists(windowsUninstallerPath)
      ) {
        try {
          await uninstallWindowsPackage(
            windowsUninstallerPath,
            windowsInstallDir,
            productName,
          );
        } catch (error) {
          errors.push(error);
        }
      }
      try {
        await cleanupMarkedDirectories(
          [
            ...(appDirectories === undefined
              ? []
              : [appDirectories.appDataDir, appDirectories.appCacheDir]),
            ownedRoot,
          ],
          marker,
        );
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) {
        throw new AggregateError(
          errors,
          "packaged backup smoke required package cleanup failed",
        );
      }
    },
    (result) => console.log(JSON.stringify(result)),
  );
}

if (import.meta.main) await run();

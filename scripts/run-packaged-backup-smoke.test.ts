import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appDirectoriesForPlatform,
  cleanupMarkedDirectories,
  executePackagedBackupBuild,
  launchPhase,
  MARKER_FILE_NAME,
  phaseEnvironment,
  removeMarkedDirectory,
  requireCleanGitStatus,
  resolvePackageArtifacts,
  sanitizeSmokeEnvironment,
  snapshotDirectory,
  uninstallWindowsPackage,
} from "./run-packaged-backup-smoke.ts";

type Executor = NonNullable<Parameters<typeof resolvePackageArtifacts>[3]>;

const paths = {
  folderA: "/owned/parent/folder-a",
  folderB: "/owned/parent/folder-b",
  transient: "/owned/transient/import.tesina",
  exportPath: "/owned/export/Tesina Library.tesina",
};
const REGISTRY_MISSING_DIAGNOSTIC =
  "ERROR: The system was unable to find the specified registry key or value.";

describe("packaged backup smoke runner helpers", () => {
  it("passes selection only to configure and reconfigure phases", () => {
    const base = { proofCommitSha: "a".repeat(40), ...paths };

    expect(phaseEnvironment("configure", base)).toMatchObject({
      TESINA_PACKAGED_BACKUP_SMOKE_PHASE: "configure",
      TESINA_PACKAGED_BACKUP_SMOKE_SELECTION: paths.folderA,
      TESINA_PACKAGED_BACKUP_SMOKE_TRANSIENT: paths.transient,
      TESINA_PACKAGED_PORTABLE_SMOKE_DESTINATION: paths.exportPath,
    });
    expect(phaseEnvironment("restart", base)).not.toHaveProperty(
      "TESINA_PACKAGED_BACKUP_SMOKE_SELECTION",
    );
    expect(phaseEnvironment("restart", base)).toHaveProperty(
      "TESINA_PACKAGED_PORTABLE_SMOKE_DESTINATION",
      paths.exportPath,
    );
    expect(phaseEnvironment("reconfigure", base)).toMatchObject({
      TESINA_PACKAGED_BACKUP_SMOKE_SELECTION: paths.folderB,
    });
    expect(phaseEnvironment("restore", base)).not.toHaveProperty(
      "TESINA_PACKAGED_BACKUP_SMOKE_SELECTION",
    );
    expect(phaseEnvironment("restore", base)).not.toHaveProperty(
      "TESINA_PACKAGED_PORTABLE_SMOKE_DESTINATION",
    );
  });

  it("removes inherited smoke paths before applying a phase", () => {
    expect(sanitizeSmokeEnvironment({
      PATH: "/bin",
      TESINA_PROOF_COMMIT_SHA: "stale",
      TESINA_PACKAGED_BACKUP_SMOKE_PHASE: "configure",
      TESINA_PACKAGED_BACKUP_SMOKE_SELECTION: "/stale",
      TESINA_PACKAGED_BACKUP_SMOKE_TRANSIENT: "/stale",
      TESINA_PACKAGED_PORTABLE_SMOKE_DESTINATION: "/stale",
    })).toEqual({ PATH: "/bin" });
  });

  it("refuses exact-SHA evidence from a dirty worktree", () => {
    expect(() => requireCleanGitStatus("")).not.toThrow();
    expect(() => requireCleanGitStatus(" M scripts/proof.ts\n")).toThrow(
      "clean worktree",
    );
  });

  it("derives isolated macOS and Windows Tauri app roots", () => {
    const identifier = "app.tesina.desktop.backup-smoke.owned";
    expect(appDirectoriesForPlatform("darwin", identifier, {
      home: "/owned/home",
    })).toEqual({
      appDataDir: join(
        "/owned/home",
        "Library",
        "Application Support",
        identifier,
      ),
      appCacheDir: join("/owned/home", "Library", "Caches", identifier),
    });
    expect(appDirectoriesForPlatform("win32", identifier, {
      windowsRoaming: "C:\\Users\\runner\\AppData\\Roaming",
      windowsLocal: "C:\\Users\\runner\\AppData\\Local",
    })).toEqual({
      appDataDir: join(
        "C:\\Users\\runner\\AppData\\Roaming",
        identifier,
      ),
      appCacheDir: join(
        "C:\\Users\\runner\\AppData\\Local",
        identifier,
      ),
    });
  });

  it("snapshots files by relative path and SHA-256", async () => {
    const root = await Deno.makeTempDir({ prefix: "backup-smoke-snapshot-" });
    try {
      await Deno.mkdir(join(root, "nested"));
      await Deno.writeTextFile(join(root, "a.txt"), "alpha");
      await Deno.writeTextFile(join(root, "nested", "b.txt"), "beta");

      const first = await snapshotDirectory(root);
      const second = await snapshotDirectory(root);
      expect(first).toEqual(second);
      expect(Object.keys(first)).toEqual(["a.txt", "nested/b.txt"]);
      expect(Object.values(first)).toEqual([
        expect.stringMatching(/^[0-9a-f]{64}$/),
        expect.stringMatching(/^[0-9a-f]{64}$/),
      ]);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("removes only an exact marker-owned directory", async () => {
    const root = await Deno.makeTempDir({ prefix: "backup-smoke-cleanup-" });
    const owned = join(root, "owned");
    const unowned = join(root, "unowned");
    await Deno.mkdir(owned);
    await Deno.mkdir(unowned);
    await Deno.writeTextFile(join(owned, MARKER_FILE_NAME), "run-a");
    try {
      await expect(removeMarkedDirectory(unowned, "run-a")).rejects.toThrow(
        "missing ownership marker",
      );
      await expect(removeMarkedDirectory(owned, "run-b")).rejects.toThrow(
        "ownership marker mismatch",
      );
      await removeMarkedDirectory(owned, "run-a");
      await expect(Deno.stat(owned)).rejects.toBeInstanceOf(
        Deno.errors.NotFound,
      );
      expect((await Deno.stat(unowned)).isDirectory).toBe(true);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("continues required cleanup after one ownership refusal", async () => {
    const root = await Deno.makeTempDir({ prefix: "backup-smoke-cleanups-" });
    const unowned = join(root, "unowned");
    const owned = join(root, "owned");
    await Deno.mkdir(unowned);
    await Deno.mkdir(owned);
    await Deno.writeTextFile(join(owned, MARKER_FILE_NAME), "run-a");
    try {
      await expect(
        cleanupMarkedDirectories([unowned, owned], "run-a"),
      ).rejects.toThrow("required cleanup failed");
      expect((await Deno.stat(unowned)).isDirectory).toBe(true);
      await expect(Deno.stat(owned)).rejects.toBeInstanceOf(
        Deno.errors.NotFound,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("uses the current Deno executable for the nested packaged build", async () => {
    const calls: Array<{
      command: string;
      args: string[];
      options: { timeoutMs: number; env?: Record<string, string | undefined> };
    }> = [];
    const execute: Executor = (command, args, options) => {
      calls.push({ command, args, options });
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };

    await executePackagedBackupBuild(
      "darwin",
      "/owned/cargo-target",
      "/owned/tauri-smoke.json",
      { PATH: "/stale-deno" },
      execute,
    );

    expect(calls).toEqual([{
      command: Deno.execPath(),
      args: [
        "task",
        "--cwd",
        "apps/desktop",
        "tauri",
        "build",
        "--features",
        "packaged-backup-smoke",
        "--bundles",
        "app",
        "--config",
        "/owned/tauri-smoke.json",
        "--ci",
      ],
      options: {
        timeoutMs: 15 * 60_000,
        env: {
          PATH: `${dirname(Deno.execPath())}:/stale-deno`,
          CARGO_TARGET_DIR: "/owned/cargo-target",
          VITE_TESINA_PACKAGED_BACKUP_SMOKE: "1",
        },
      },
    }]);
  });

  it("normalizes the Windows Path key before the nested packaged build", async () => {
    const calls: Array<{
      args: string[];
      options: { env?: Record<string, string | undefined> };
    }> = [];
    const execute: Executor = (_command, args, options) => {
      calls.push({ args, options });
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };

    await executePackagedBackupBuild(
      "win32",
      "C:\\owned\\cargo-target",
      "C:\\owned\\tauri-smoke.json",
      { Path: "C:\\stale-deno", KEEP: "yes" },
      execute,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toContain("nsis");
    expect(calls[0]?.options.env).toEqual({
      KEEP: "yes",
      PATH: `${dirname(Deno.execPath())};C:\\stale-deno`,
      CARGO_TARGET_DIR: "C:\\owned\\cargo-target",
      VITE_TESINA_PACKAGED_BACKUP_SMOKE: "1",
    });
  });

  it("launches phases with inherited stderr instead of a retained pipe", async () => {
    const env = {
      TESINA_PACKAGED_BACKUP_SMOKE_PHASE: "configure",
    };
    let command:
      | {
        executablePath: string;
        options: {
          env: Record<string, string>;
          stdout: "null";
          stderr: "inherit";
        };
      }
      | undefined;
    const exitCode = await launchPhase(
      "/owned/installed-package/tesina.exe",
      env,
      (executablePath, options) => {
        command = { executablePath, options };
        return {
          status: Promise.resolve({ success: true, code: 0, signal: null }),
          kill() {},
        };
      },
    );

    expect(exitCode).toBe(0);
    expect(command).toEqual({
      executablePath: "/owned/installed-package/tesina.exe",
      options: {
        env,
        stdout: "null",
        stderr: "inherit",
      },
    });
  });

  it("materializes the Windows executable through the NSIS package", async () => {
    const root = await Deno.makeTempDir({ prefix: "backup-smoke-nsis-" });
    const cargoTarget = join(root, "cargo-target");
    const packageDir = join(cargoTarget, "release", "bundle", "nsis");
    const packagePath = join(packageDir, "Tesina_0.1.19_x64-setup.exe");
    const installDir = join(root, "Installed Package With Spaces");
    const calls: Array<{ command: string; args: string[] }> = [];
    await Deno.mkdir(packageDir, { recursive: true });
    await Deno.writeTextFile(packagePath, "fake NSIS package");
    const execute: Executor = async (command, args) => {
      calls.push({ command, args });
      await Deno.mkdir(installDir, { recursive: true });
      await Deno.writeTextFile(join(installDir, "tesina.exe"), "from NSIS");
      await Deno.writeTextFile(join(installDir, "uninstall.exe"), "cleanup");
      return { code: 0, stdout: "", stderr: "" };
    };
    try {
      const artifacts = await resolvePackageArtifacts(
        "win32",
        cargoTarget,
        installDir,
        execute,
      );

      expect(calls).toEqual([{
        command: packagePath,
        args: ["/S", "/NS", `/D=${installDir}`],
      }]);
      expect(artifacts).toEqual({
        executablePath: join(installDir, "tesina.exe"),
        packagePath,
      });
      await expect(Deno.readTextFile(artifacts.executablePath)).resolves.toBe(
        "from NSIS",
      );
      expect(artifacts.executablePath).not.toBe(
        join(cargoTarget, "release", "tesina.exe"),
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("refuses a pre-existing Windows install directory before invoking NSIS", async () => {
    const root = await Deno.makeTempDir({ prefix: "backup-smoke-preseeded-" });
    const cargoTarget = join(root, "cargo-target");
    const packageDir = join(cargoTarget, "release", "bundle", "nsis");
    const packagePath = join(packageDir, "Tesina_0.1.19_x64-setup.exe");
    const installDir = join(root, "pre-existing-install");
    let executorCalled = false;
    await Deno.mkdir(packageDir, { recursive: true });
    await Deno.writeTextFile(packagePath, "fake NSIS package");
    await Deno.mkdir(installDir);
    await Deno.writeTextFile(join(installDir, "tesina.exe"), "preseeded");
    await Deno.writeTextFile(join(installDir, "uninstall.exe"), "preseeded");
    const execute: Executor = () => {
      executorCalled = true;
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };
    try {
      await expect(
        resolvePackageArtifacts(
          "win32",
          cargoTarget,
          installDir,
          execute,
        ),
      ).rejects.toThrow("Windows install directory already exists");
      expect(executorCalled).toBe(false);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("removes only the retained run-owned NSIS product key and verifies both installer keys absent", async () => {
    const root = await Deno.makeTempDir({ prefix: "backup-smoke-uninstall-" });
    const installDir = join(root, "Installed Package With Spaces");
    const executablePath = join(installDir, "tesina.exe");
    const uninstallerPath = join(installDir, "uninstall.exe");
    const productName = "Tesina Backup Smoke 0123456789ab";
    const productKey = `HKCU\\Software\\tesina\\${productName}`;
    const uninstallKey =
      `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${productName}`;
    const calls: Array<{ command: string; args: string[] }> = [];
    let productKeyPresent = true;
    await Deno.mkdir(installDir);
    await Deno.writeTextFile(executablePath, "packaged executable");
    await Deno.writeTextFile(uninstallerPath, "package uninstaller");
    const execute: Executor = async (command, args) => {
      calls.push({ command, args });
      if (command === uninstallerPath) {
        await Deno.remove(executablePath);
        return { code: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "query" && args[1] === productKey && args[2] === "/ve") {
        return {
          code: productKeyPresent ? 0 : 1,
          stdout: productKeyPresent
            ? `${productKey}\r\n    (Default)    REG_SZ    ${installDir}\r\n`
            : "",
          stderr: "",
        };
      }
      if (args[0] === "delete" && args[1] === productKey) {
        productKeyPresent = false;
        return { code: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "query" && args[1] === productKey) {
        return {
          code: productKeyPresent ? 0 : 1,
          stdout: "",
          stderr: productKeyPresent
            ? ""
            : `\r\n${REGISTRY_MISSING_DIAGNOSTIC}\r\n`,
        };
      }
      if (args[0] === "query" && args[1] === uninstallKey) {
        return {
          code: 1,
          stdout: `${REGISTRY_MISSING_DIAGNOSTIC.toLowerCase()}\n`,
          stderr: "",
        };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    try {
      await uninstallWindowsPackage(
        uninstallerPath,
        installDir,
        productName,
        execute,
      );

      expect(calls).toEqual([
        {
          command: uninstallerPath,
          args: ["/S", `_?=${installDir}`],
        },
        {
          command: "reg.exe",
          args: ["query", productKey, "/ve"],
        },
        {
          command: "reg.exe",
          args: ["delete", productKey, "/f"],
        },
        {
          command: "reg.exe",
          args: ["query", productKey],
        },
        {
          command: "reg.exe",
          args: ["query", uninstallKey],
        },
      ]);
      await expect(Deno.lstat(executablePath)).rejects.toBeInstanceOf(
        Deno.errors.NotFound,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("never deletes a retained NSIS product key owned by another install directory", async () => {
    const root = await Deno.makeTempDir({
      prefix: "backup-smoke-reg-mismatch-",
    });
    const installDir = join(root, "Installed Package");
    const executablePath = join(installDir, "tesina.exe");
    const uninstallerPath = join(installDir, "uninstall.exe");
    const productName = "Tesina Backup Smoke abcdef012345";
    const productKey = `HKCU\\Software\\tesina\\${productName}`;
    const calls: Array<{ command: string; args: string[] }> = [];
    await Deno.mkdir(installDir);
    await Deno.writeTextFile(executablePath, "packaged executable");
    await Deno.writeTextFile(uninstallerPath, "package uninstaller");
    const execute: Executor = async (command, args) => {
      calls.push({ command, args });
      if (command === uninstallerPath) {
        await Deno.remove(executablePath);
        return { code: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "query" && args[1] === productKey) {
        return {
          code: 0,
          stdout:
            `${productKey}\r\n    (Default)    REG_SZ    C:\\Other Install\r\n`,
          stderr: "",
        };
      }
      throw new Error("registry deletion must not run for a mismatched path");
    };
    try {
      await expect(
        uninstallWindowsPackage(
          uninstallerPath,
          installDir,
          productName,
          execute,
        ),
      ).rejects.toThrow("does not match the owned install directory");
      expect(calls).toEqual([
        {
          command: uninstallerPath,
          args: ["/S", `_?=${installDir}`],
        },
        {
          command: "reg.exe",
          args: ["query", productKey, "/ve"],
        },
      ]);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("fails on an unexpected reg.exe query status", async () => {
    const root = await Deno.makeTempDir({ prefix: "backup-smoke-reg-status-" });
    const installDir = join(root, "Installed Package");
    const executablePath = join(installDir, "tesina.exe");
    const uninstallerPath = join(installDir, "uninstall.exe");
    const productName = "Tesina Backup Smoke fedcba987654";
    const productKey = `HKCU\\Software\\tesina\\${productName}`;
    const calls: Array<{ command: string; args: string[] }> = [];
    await Deno.mkdir(installDir);
    await Deno.writeTextFile(executablePath, "packaged executable");
    await Deno.writeTextFile(uninstallerPath, "package uninstaller");
    const execute: Executor = async (command, args) => {
      calls.push({ command, args });
      if (command === uninstallerPath) {
        await Deno.remove(executablePath);
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 2, stdout: "", stderr: "registry unavailable" };
    };
    try {
      await expect(
        uninstallWindowsPackage(
          uninstallerPath,
          installDir,
          productName,
          execute,
        ),
      ).rejects.toThrow("unexpected reg.exe query status: 2");
      expect(calls).toEqual([
        {
          command: uninstallerPath,
          args: ["/S", `_?=${installDir}`],
        },
        {
          command: "reg.exe",
          args: ["query", productKey, "/ve"],
        },
      ]);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("does not treat a generic reg.exe code 1 failure as proof of absence", async () => {
    const root = await Deno.makeTempDir({ prefix: "backup-smoke-reg-denied-" });
    const installDir = join(root, "Installed Package");
    const executablePath = join(installDir, "tesina.exe");
    const uninstallerPath = join(installDir, "uninstall.exe");
    const productName = "Tesina Backup Smoke 123456abcdef";
    const productKey = `HKCU\\Software\\tesina\\${productName}`;
    const calls: Array<{ command: string; args: string[] }> = [];
    await Deno.mkdir(installDir);
    await Deno.writeTextFile(executablePath, "packaged executable");
    await Deno.writeTextFile(uninstallerPath, "package uninstaller");
    const execute: Executor = async (command, args) => {
      calls.push({ command, args });
      if (command === uninstallerPath) {
        await Deno.remove(executablePath);
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "ERROR: Access is denied.\r\n" };
    };
    try {
      await expect(
        uninstallWindowsPackage(
          uninstallerPath,
          installDir,
          productName,
          execute,
        ),
      ).rejects.toThrow("unexpected reg.exe query failure: 1");
      expect(calls).toEqual([
        {
          command: uninstallerPath,
          args: ["/S", `_?=${installDir}`],
        },
        {
          command: "reg.exe",
          args: ["query", productKey, "/ve"],
        },
      ]);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});

import { build, preview } from "vite";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { cleanupProofRun } from "./proofRunCleanup.ts";
import { executeBoundedProcess } from "./proofProcess.ts";
import { runProofLifecycle } from "./proofLifecycle.ts";
import { waitForProofOrigin } from "./proofOrigin.ts";
import {
  nativeHostCommand,
  windowsHostBuildProcessOptions,
} from "./nativeHostCommand.ts";

const proofDir = dirname(fileURLToPath(import.meta.url));
const tauriDir = resolve(proofDir, "../../../../../src-tauri");
const proofDirectories: string[] = [];
let outputDir = "";
let profileDir = "";
let hostDir = "";
let previewServer: Awaited<ReturnType<typeof preview>> | undefined;

function windowsHostBinary(): string {
  return resolve(hostDir, "debug", "examples", "webview2-proof-host.exe");
}

async function buildMacHost(): Promise<string | undefined> {
  if (process.platform !== "darwin") return undefined;
  const appDir = resolve(hostDir, "TesinaPaginationProof.app");
  const contentsDir = resolve(appDir, "Contents");
  const executableDir = resolve(contentsDir, "MacOS");
  const executable = resolve(executableDir, "TesinaPaginationProof");
  await mkdir(executableDir, { recursive: true });
  await writeFile(
    resolve(contentsDir, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>TesinaPaginationProof</string>
<key>CFBundleIdentifier</key><string>org.tesina.pagination-proof</string>
<key>CFBundleName</key><string>Tesina Pagination Proof</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
`,
  );
  const output = await executeBoundedProcess("xcrun", [
    "swiftc",
    resolve(proofDir, "WKWebViewProofRunner.swift"),
    "-framework",
    "AppKit",
    "-framework",
    "WebKit",
    "-o",
    executable,
  ], { timeoutMs: 60_000 });
  if (output.code !== 0) {
    throw new Error(`macOS manual host build exited with ${output.code}`);
  }
  return executable;
}

async function buildWindowsHost(): Promise<void> {
  if (process.platform !== "win32") return;
  const output = await executeBoundedProcess("cargo", [
    "build",
    "--locked",
    "--manifest-path",
    resolve(tauriDir, "Cargo.toml"),
    "--example",
    "webview2-proof-host",
    "--features",
    "native-proof-host",
  ], windowsHostBuildProcessOptions(process.env, hostDir));
  if (output.code !== 0) {
    throw new Error(`WebView2 manual host build exited with ${output.code}`);
  }
}

await runProofLifecycle(async () => {
  outputDir = await mkdtemp(resolve(tmpdir(), "tesina-manual-proof-dist-"));
  proofDirectories.push(outputDir);
  profileDir = await mkdtemp(
    resolve(tmpdir(), "tesina-manual-proof-profile-"),
  );
  proofDirectories.push(profileDir);
  hostDir = await mkdtemp(resolve(tmpdir(), "tesina-manual-proof-host-"));
  proofDirectories.push(hostDir);
  const macHostBinary = await buildMacHost();
  await buildWindowsHost();
  await build({
    root: proofDir,
    configFile: false,
    base: "./",
    logLevel: "error",
    build: {
      outDir: outputDir,
      emptyOutDir: true,
      minify: false,
      rollupOptions: {
        input: resolve(proofDir, "nativeManualProof.html"),
      },
    },
  });
  previewServer = await preview({
    root: proofDir,
    configFile: false,
    base: "./",
    logLevel: "error",
    build: { outDir: outputDir },
    preview: { host: "127.0.0.1", port: 0, strictPort: true },
  });
  const address = previewServer.httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Manual proof server did not expose a loopback port");
  }
  const url = new URL(
    `http://127.0.0.1:${address.port}/nativeManualProof.html`,
  );
  await waitForProofOrigin(url, { timeoutMs: 10_000, retryIntervalMs: 25 });
  const host = macHostBinary
    ? { command: macHostBinary, args: [url.href] }
    : nativeHostCommand(process.platform, {
      proofDir,
      url,
      profileDir,
      windowsHostBinary: windowsHostBinary(),
    });
  const output = await executeBoundedProcess(host.command, host.args, {
    timeoutMs: 300_000,
  });
  if (output.stdout.trim()) console.log(output.stdout.trim());
  if (output.stderr.trim()) console.error(output.stderr.trim());
  if (output.code !== 0) {
    throw new Error(`Manual native proof exited with ${output.code}`);
  }
  const result = JSON.parse(output.stdout.trim()) as { passed?: boolean };
  if (result.passed !== true) {
    throw new Error("Manual native proof did not pass");
  }
}, async () => {
  await cleanupProofRun(proofDirectories, previewServer);
});

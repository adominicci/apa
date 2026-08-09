import { build, preview } from "vite";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { executeBoundedProcess } from "./proofProcess.ts";
import { cleanupProofRun } from "./proofRunCleanup.ts";
import { runProofLifecycle } from "./proofLifecycle.ts";
import { waitForProofOrigin } from "./proofOrigin.ts";
import {
  AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS,
  nativeHostCommand,
  type NativeHostMode,
  windowsHostBuildProcessOptions,
} from "./nativeHostCommand.ts";
import { nativeProofPhases } from "./nativeProofPhases.ts";
import { nativeHostRuntimeIdentity } from "./nativeHostRuntimeIdentity.ts";

const proofDir = dirname(fileURLToPath(import.meta.url));
console.log(
  "NATIVE_HOST_RUNTIME",
  JSON.stringify(
    nativeHostRuntimeIdentity(process.env["GITHUB_SHA"] ?? "local"),
  ),
);
const tauriDir = resolve(proofDir, "../../../../../src-tauri");
const proofDirectories: string[] = [];
let outputDir = "";
let profileDir = "";
let nativeHostDir = "";
let previewServer: Awaited<ReturnType<typeof preview>> | undefined;

function windowsHostBinary(): string {
  return resolve(
    nativeHostDir,
    "debug",
    "examples",
    process.platform === "win32"
      ? "webview2-proof-host.exe"
      : "webview2-proof-host",
  );
}

async function buildWindowsHost(): Promise<void> {
  if (process.platform !== "win32") return;
  const output = await executeBoundedProcess(
    "cargo",
    [
      "build",
      "--locked",
      "--manifest-path",
      resolve(tauriDir, "Cargo.toml"),
      "--example",
      "webview2-proof-host",
      "--features",
      "native-proof-host",
    ],
    windowsHostBuildProcessOptions(process.env, nativeHostDir),
  );
  if (output.stdout.trim()) console.error(output.stdout.trim());
  if (output.stderr.trim()) console.error(output.stderr.trim());
  if (output.code !== 0) {
    throw new Error(
      `WebView2 proof host build exited with code ${output.code}`,
    );
  }
}

async function runNativeHost(
  url: URL,
  profileName: string,
  emitResult: boolean,
  mode: NativeHostMode,
): Promise<void> {
  const readiness = await waitForProofOrigin(url, {
    timeoutMs: AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS.originReadiness,
    retryIntervalMs: 25,
  });
  console.error(
    `Native proof origin ready after ${readiness.attempts} request(s): ${readiness.url}`,
  );
  const host = nativeHostCommand(
    process.platform,
    {
      proofDir,
      url,
      profileDir: resolve(profileDir, profileName),
      windowsHostBinary: windowsHostBinary(),
    },
    mode,
  );
  const output = await executeBoundedProcess(
    host.command,
    host.args,
    {
      timeoutMs: url.pathname === "/nativeProof.html"
        ? AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS.expandedPaginationOuter
        : AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS.outerNativeHostProcess,
    },
  );
  const stdout = output.stdout.trim();
  const stderr = output.stderr.trim();
  if (emitResult && stdout) console.log(stdout);
  if (!emitResult && output.code !== 0 && stdout) console.error(stdout);
  if (stderr) console.error(stderr);
  if (output.code !== 0) {
    throw new Error(`Native proof host exited with code ${output.code}`);
  }
  const result = JSON.parse(stdout) as { passed?: boolean };
  if (result.passed !== true) throw new Error("Native proof did not pass");
}

await runProofLifecycle(async () => {
  outputDir = await mkdtemp(resolve(tmpdir(), "tesina-native-proof-dist-"));
  proofDirectories.push(outputDir);
  profileDir = await mkdtemp(
    resolve(tmpdir(), "tesina-native-proof-profile-"),
  );
  proofDirectories.push(profileDir);
  nativeHostDir = await mkdtemp(
    resolve(tmpdir(), "tesina-native-proof-host-"),
  );
  proofDirectories.push(nativeHostDir);
  await buildWindowsHost();
  await build({
    root: proofDir,
    configFile: false,
    base: "./",
    logLevel: "error",
    resolve: { alias: { $lib: resolve(proofDir, "../../..") } },
    build: {
      outDir: outputDir,
      emptyOutDir: true,
      minify: false,
      rollupOptions: {
        input: {
          nativeHarnessSelfTest: resolve(
            proofDir,
            "nativeHarnessSelfTest.html",
          ),
          nativeProof: resolve(proofDir, "nativeProof.html"),
          ...(process.platform === "win32"
            ? {
              nativeManualProof: resolve(
                proofDir,
                "nativeManualProof.html",
              ),
            }
            : {}),
        },
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
    throw new Error("WKWebView proof server did not expose a loopback port");
  }
  const baseUrl = new URL(`http://127.0.0.1:${address.port}/`);
  console.error(`Native proof bundle listening: ${baseUrl.href}`);
  for (const phase of nativeProofPhases(process.platform)) {
    await runNativeHost(
      new URL(phase.page, baseUrl),
      phase.profileName,
      phase.emitResult,
      phase.mode,
    );
    if (phase.page === "nativeHarnessSelfTest.html") {
      console.error("Native harness self-test passed");
    }
  }
}, async () => {
  await cleanupProofRun(
    proofDirectories,
    previewServer,
  );
});

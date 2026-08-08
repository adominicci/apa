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
import { nativeHostCommand } from "./nativeHostCommand.ts";

const proofDir = dirname(fileURLToPath(import.meta.url));
const tauriDir = resolve(proofDir, "../../../../../src-tauri");
const NATIVE_PROOF_TIMEOUT_MS = 60_000;
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
    {
      timeoutMs: 180_000,
      env: { ...process.env, CARGO_TARGET_DIR: nativeHostDir },
    },
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
): Promise<void> {
  const readiness = await waitForProofOrigin(url, {
    timeoutMs: 10_000,
    retryIntervalMs: 25,
  });
  console.error(
    `Native proof origin ready after ${readiness.attempts} request(s): ${readiness.url}`,
  );
  const host = nativeHostCommand(process.platform, {
    proofDir,
    url,
    profileDir: resolve(profileDir, profileName),
    windowsHostBinary: windowsHostBinary(),
  });
  const output = await executeBoundedProcess(
    host.command,
    host.args,
    { timeoutMs: NATIVE_PROOF_TIMEOUT_MS },
  );
  const stdout = output.stdout.trim();
  const stderr = output.stderr.trim();
  if (emitResult && stdout) console.log(stdout);
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
  await runNativeHost(
    new URL("nativeHarnessSelfTest.html", baseUrl),
    "self-test",
    false,
  );
  console.error("Native harness self-test passed");
  await runNativeHost(new URL("nativeProof.html", baseUrl), "proof", true);
}, async () => {
  await cleanupProofRun(
    proofDirectories,
    previewServer,
  );
});

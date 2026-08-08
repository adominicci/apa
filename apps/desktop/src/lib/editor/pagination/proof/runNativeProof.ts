import { build, preview } from "vite";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { executeBoundedProcess } from "./proofProcess.ts";
import { cleanupProofRun } from "./proofRunCleanup.ts";

const proofDir = dirname(fileURLToPath(import.meta.url));
const outputDir = await mkdtemp(resolve(tmpdir(), "tesina-wkwebview-proof-"));
const SWIFT_PROOF_TIMEOUT_MS = 60_000;
let previewServer: Awaited<ReturnType<typeof preview>> | undefined;

async function runSwiftProof(url: URL, emitResult: boolean): Promise<void> {
  const output = await executeBoundedProcess(
    "xcrun",
    [
      "swift",
      resolve(proofDir, "WKWebViewProofRunner.swift"),
      url.href,
    ],
    { timeoutMs: SWIFT_PROOF_TIMEOUT_MS },
  );
  const stdout = output.stdout.trim();
  const stderr = output.stderr.trim();
  if (emitResult && stdout) console.log(stdout);
  if (stderr) console.error(stderr);
  if (output.code !== 0) {
    throw new Error(`WKWebView proof exited with code ${output.code}`);
  }
  const result = JSON.parse(stdout) as { passed?: boolean };
  if (result.passed !== true) throw new Error("WKWebView proof did not pass");
}

try {
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
  console.error(`WKWebView proof bundle ready: ${baseUrl.href}`);
  await runSwiftProof(new URL("nativeHarnessSelfTest.html", baseUrl), false);
  console.error("WKWebView harness self-test passed");
  await runSwiftProof(new URL("nativeProof.html", baseUrl), true);
} finally {
  await cleanupProofRun(outputDir, previewServer);
}

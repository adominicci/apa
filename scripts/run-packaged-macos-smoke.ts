import { join } from "node:path";
import process from "node:process";
import {
  packagedSmokeResult,
  selectMacOSAppBundle,
  terminateOwnedProcess,
} from "./packaged-macos-smoke.ts";

const LIVENESS_MS = 3_000;

async function commandText(command: string, args: string[]): Promise<string> {
  const output = await new Deno.Command(command, {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `${command} failed: ${new TextDecoder().decode(output.stderr).trim()}`,
    );
  }
  return new TextDecoder().decode(output.stdout).trim();
}

async function plistValue(path: string, key: string): Promise<string> {
  return await commandText("plutil", ["-extract", key, "raw", "-o", "-", path]);
}

if (process.platform !== "darwin") {
  throw new Error("Packaged macOS smoke can run only on macOS");
}

const artifactPaths = JSON.parse(
  Deno.env.get("TAURI_ARTIFACT_PATHS") ?? "[]",
) as string[];
const appPath = selectMacOSAppBundle(artifactPaths);
const infoPlist = join(appPath, "Contents", "Info.plist");
const executableName = await plistValue(infoPlist, "CFBundleExecutable");
const executablePath = join(appPath, "Contents", "MacOS", executableName);
const bundleIdentifier = await plistValue(infoPlist, "CFBundleIdentifier");
const appVersion = await plistValue(infoPlist, "CFBundleShortVersionString");
const macOSVersion = await commandText("sw_vers", ["-productVersion"]);
const webKitVersion = await plistValue(
  "/System/Library/Frameworks/WebKit.framework/Versions/A/Resources/Info.plist",
  "CFBundleShortVersionString",
);

const child = new Deno.Command(executablePath, {
  stdout: "null",
  stderr: "null",
}).spawn();
const statusPromise = child.status;
const earlyStatus = await Promise.race([
  statusPromise.then((status) => ({ exited: true as const, status })),
  new Promise<{ exited: false }>((resolve) =>
    setTimeout(() => resolve({ exited: false }), LIVENESS_MS)
  ),
]);
if (earlyStatus.exited) {
  throw new Error(
    `Packaged Tesina exited before ${LIVENESS_MS}ms (code ${earlyStatus.status.code})`,
  );
}

await terminateOwnedProcess(child);

console.log(JSON.stringify(packagedSmokeResult({
  appPath,
  executablePath,
  bundleIdentifier,
  appVersion,
  commitSha: Deno.env.get("GITHUB_SHA") ?? "local",
  macOSVersion,
  webKitVersion,
  aliveAfterMs: LIVENESS_MS,
})));

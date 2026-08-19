import { dirname } from "node:path";

export interface PackagedMacOSSmokeInputs {
  appPath: string;
  executablePath: string;
  bundleIdentifier: string;
  appVersion: string;
  commitSha: string;
  macOSVersion: string;
  webKitVersion: string;
  aliveAfterMs: number;
}

export interface PackagedMacOSSmokeResult extends PackagedMacOSSmokeInputs {
  passed: true;
  evidence: "packaged-macos-launch";
  claims: string[];
  excludedClaims: string[];
}

export interface OwnedChildProcess {
  readonly status: Promise<Deno.CommandStatus>;
  kill(signal: Deno.Signal): void;
}

export interface OwnedProcessTerminationOptions {
  gracefulTimeoutMs?: number;
  forcedTimeoutMs?: number;
}

const DEFAULT_GRACEFUL_TIMEOUT_MS = 5_000;
const DEFAULT_FORCED_TIMEOUT_MS = 2_000;

export function environmentWithActiveDeno(
  platform: string,
  environment: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const inheritedPath = Object.entries(environment).find(([key]) =>
    key.toLowerCase() === "path"
  )?.[1];
  const environmentWithoutPath = Object.fromEntries(
    Object.entries(environment).filter(([key]) => key.toLowerCase() !== "path"),
  );
  const denoDirectory = dirname(Deno.execPath());
  return {
    ...environmentWithoutPath,
    PATH: inheritedPath
      ? `${denoDirectory}${platform === "win32" ? ";" : ":"}${inheritedPath}`
      : denoDirectory,
  };
}

export function packagedSmokeBundleIdentifier(
  base: string,
  runUuid = crypto.randomUUID(),
): string {
  const suffix = runUuid.replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(suffix)) {
    throw new Error("packaged smoke run identifier must be a UUID");
  }
  return `${base}.${suffix}`;
}

/** Publishes success only after task-owned cleanup has completed. */
export async function runWithRequiredCleanup<T>(
  operation: () => Promise<T>,
  cleanup: () => Promise<void>,
  publish: (result: T) => void,
): Promise<void> {
  let result!: T;
  try {
    result = await operation();
  } finally {
    await cleanup();
  }
  publish(result);
}

export async function ownedProcessStatusWithin(
  status: Promise<Deno.CommandStatus>,
  timeoutMs: number,
): Promise<Deno.CommandStatus | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      status,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Stops only the exact child spawned by the smoke and bounds both waits. */
export async function terminateOwnedProcess(
  child: OwnedChildProcess,
  options: OwnedProcessTerminationOptions = {},
): Promise<{ status: Deno.CommandStatus; forced: boolean }> {
  const gracefulTimeoutMs = Math.max(
    1,
    options.gracefulTimeoutMs ?? DEFAULT_GRACEFUL_TIMEOUT_MS,
  );
  const forcedTimeoutMs = Math.max(
    1,
    options.forcedTimeoutMs ?? DEFAULT_FORCED_TIMEOUT_MS,
  );

  child.kill("SIGTERM");
  const gracefulStatus = await ownedProcessStatusWithin(
    child.status,
    gracefulTimeoutMs,
  );
  if (gracefulStatus) return { status: gracefulStatus, forced: false };

  child.kill("SIGKILL");
  const forcedStatus = await ownedProcessStatusWithin(
    child.status,
    forcedTimeoutMs,
  );
  if (!forcedStatus) {
    throw new Error(
      `Packaged Tesina did not exit after SIGKILL within ${forcedTimeoutMs}ms`,
    );
  }
  return { status: forcedStatus, forced: true };
}

export function selectMacOSAppBundle(paths: readonly string[]): string {
  const apps = paths.filter((path) => path.endsWith(".app"));
  if (apps.length !== 1) {
    throw new Error(
      `Packaged macOS smoke requires exactly one .app bundle, got ${apps.length}`,
    );
  }
  return apps[0]!;
}

export function packagedSmokeResult(
  inputs: PackagedMacOSSmokeInputs,
): PackagedMacOSSmokeResult {
  return {
    passed: true,
    evidence: "packaged-macos-launch",
    claims: [
      "bundle metadata",
      "packaged executable launch",
      "process liveness",
    ],
    excludedClaims: ["editing", "IPC", "plugin persistence", "installer UX"],
    ...inputs,
  };
}

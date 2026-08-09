import { arch, cpus, platform, release, totalmem } from "node:os";
import process from "node:process";

export interface NativeHostRuntimeIdentity {
  commitSha: string;
  os: string;
  arch: string;
  osRelease: string;
  cpuModel: string;
  logicalCores: number;
  memoryBytes: number;
  deno: string;
  v8: string;
}

/** Host facts logged beside the embedded engine's navigator identity. */
export function nativeHostRuntimeIdentity(
  commitSha: string,
): NativeHostRuntimeIdentity {
  const logicalCpus = cpus();
  return {
    commitSha,
    os: platform(),
    arch: arch(),
    osRelease: release(),
    cpuModel: logicalCpus[0]?.model ?? "unavailable",
    logicalCores: Math.max(1, logicalCpus.length),
    memoryBytes: totalmem(),
    deno: process.versions.deno ?? "unavailable",
    v8: process.versions.v8,
  };
}

import { describe, expect, it } from "vitest";
import { nativeHostRuntimeIdentity } from "./nativeHostRuntimeIdentity.ts";

describe("native pagination host runtime identity", () => {
  it("records the exact commit, host, hardware, and Deno runtime", () => {
    const identity = nativeHostRuntimeIdentity("abc123");

    expect(identity.commitSha).toBe("abc123");
    expect(identity.os).not.toBe("");
    expect(identity.arch).not.toBe("");
    expect(identity.cpuModel).not.toBe("");
    expect(identity.logicalCores).toBeGreaterThan(0);
    expect(identity.memoryBytes).toBeGreaterThan(0);
    expect(identity.deno).toMatch(/^\d+\.\d+\.\d+/);
  });
});

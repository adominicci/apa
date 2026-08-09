import { describe, expect, it } from "vitest";
import {
  packagedSmokeResult,
  selectMacOSAppBundle,
  terminateOwnedProcess,
} from "./packaged-macos-smoke.ts";

function commandStatus(code: number): Deno.CommandStatus {
  return { success: code === 0, code, signal: null };
}

describe("packaged macOS smoke contract", () => {
  it("selects the one actual app bundle from Tauri artifact paths", () => {
    expect(selectMacOSAppBundle([
      "/tmp/Tesina.dmg",
      "/tmp/Tesina.app",
    ])).toBe("/tmp/Tesina.app");
    expect(() => selectMacOSAppBundle(["/tmp/Tesina.dmg"]))
      .toThrow("exactly one .app bundle");
    expect(() => selectMacOSAppBundle(["/tmp/One.app", "/tmp/Two.app"]))
      .toThrow("exactly one .app bundle");
  });

  it("labels a live packaged process narrowly without claiming persistence", () => {
    expect(packagedSmokeResult({
      appPath: "/tmp/Tesina.app",
      executablePath: "/tmp/Tesina.app/Contents/MacOS/Tesina",
      bundleIdentifier: "app.tesina.desktop",
      appVersion: "0.1.2",
      commitSha: "abc123",
      macOSVersion: "15.6",
      webKitVersion: "620.3.12",
      aliveAfterMs: 3_000,
    })).toEqual({
      passed: true,
      evidence: "packaged-macos-launch",
      claims: [
        "bundle metadata",
        "packaged executable launch",
        "process liveness",
      ],
      excludedClaims: ["editing", "IPC", "plugin persistence", "installer UX"],
      appPath: "/tmp/Tesina.app",
      executablePath: "/tmp/Tesina.app/Contents/MacOS/Tesina",
      bundleIdentifier: "app.tesina.desktop",
      appVersion: "0.1.2",
      commitSha: "abc123",
      macOSVersion: "15.6",
      webKitVersion: "620.3.12",
      aliveAfterMs: 3_000,
    });
  });

  it("terminates only the owned child and bounds a graceful shutdown", async () => {
    let resolveStatus!: (status: Deno.CommandStatus) => void;
    const status = new Promise<Deno.CommandStatus>((resolve) => {
      resolveStatus = resolve;
    });
    const signals: Deno.Signal[] = [];
    const child = {
      status,
      kill(signal: Deno.Signal) {
        signals.push(signal);
        if (signal === "SIGKILL") resolveStatus(commandStatus(137));
      },
    };

    const result = await terminateOwnedProcess(child, {
      gracefulTimeoutMs: 1,
      forcedTimeoutMs: 20,
    });

    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(result).toEqual({ status: commandStatus(137), forced: true });
  });

  it("fails within the second deadline when even the owned-child status stalls", async () => {
    const signals: Deno.Signal[] = [];
    const child = {
      status: new Promise<Deno.CommandStatus>(() => {}),
      kill(signal: Deno.Signal) {
        signals.push(signal);
      },
    };

    await expect(terminateOwnedProcess(child, {
      gracefulTimeoutMs: 1,
      forcedTimeoutMs: 1,
    })).rejects.toThrow("did not exit after SIGKILL within 1ms");
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });
});

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const source = await readFile(
  resolve(proofDir, "nativeManualProof.ts"),
  "utf8",
);
const runner = await readFile(
  resolve(proofDir, "runNativeManualProof.ts"),
  "utf8",
);
const automatedRunner = await readFile(
  resolve(proofDir, "runNativeProof.ts"),
  "utf8",
);
const nativeHost = await readFile(
  resolve(proofDir, "../../../../../src-tauri/examples/webview2-proof-host.rs"),
  "utf8",
);
const nativeInputDriver = await readFile(
  resolve(
    proofDir,
    "../../../../../src-tauri/examples/support/windows-native-input.rs",
  ),
  "utf8",
).catch(() => "");
const cargoManifest = await readFile(
  resolve(proofDir, "../../../../../src-tauri/Cargo.toml"),
  "utf8",
);

describe("visible native manual-proof contract", () => {
  it("records real composition, clipboard, and mouse-drag event paths", () => {
    expect(source).toContain('addEventListener("compositionstart"');
    expect(source).toContain('addEventListener("compositionend"');
    expect(source).toContain('addEventListener("copy"');
    expect(source).toContain('addEventListener("paste"');
    expect(source).toContain('addEventListener("mousedown"');
    expect(source).toContain('addEventListener("mouseup"');
    expect(source).toContain("event.isTrusted");
    expect(source).toContain("postNativeInput");
    expect(source).not.toMatch(
      /dispatchEvent|new\s+(?:Input|Composition|Clipboard|Mouse)Event/,
    );
  });

  it("uses only the audited Win32 OS paths for driven Windows evidence", () => {
    expect(nativeHost).toContain("windows_native_input");
    expect(nativeInputDriver).toContain("SendInput");
    expect(nativeInputDriver).toContain("OpenClipboard");
    expect(nativeInputDriver).toContain("GetClipboardData");
    expect(nativeInputDriver).toContain("CloseClipboard");
    expect(nativeInputDriver).toContain("LoadKeyboardLayoutW");
    expect(nativeInputDriver).toContain("00020409");
    expect(`${nativeHost}\n${nativeInputDriver}`).not.toMatch(
      /execute_script|dispatchEvent/,
    );
    expect(cargoManifest).toContain('windows-sys = { version = "=0.61.2"');
  });

  it("snapshots and restores native clipboard and cursor state fail closed", () => {
    expect(nativeInputDriver).toContain("snapshot_clipboard");
    expect(nativeInputDriver).toContain("restore_clipboard_snapshot");
    expect(nativeInputDriver).not.toContain(
      "read_clipboard_text(self.hwnd).ok()",
    );
    expect(nativeInputDriver).toContain(
      'errors.push("SetCursorPos failed during native input cleanup".into())',
    );
    expect(nativeInputDriver).toMatch(
      /restore_clipboard_snapshot[\s\S]*errors\.push\(error\)/,
    );
    const layoutMethod = nativeInputDriver.slice(
      nativeInputDriver.indexOf("fn activate_composition_layout"),
      nativeInputDriver.indexOf("fn send_dead_key_sequence"),
    );
    expect(layoutMethod.indexOf("self.original_layout = Some")).toBeGreaterThan(
      -1,
    );
    expect(layoutMethod.indexOf("self.original_layout = Some")).toBeLessThan(
      layoutMethod.indexOf("LoadKeyboardLayoutW"),
    );
  });

  it("uses the same direct platform host and bounded cleanup lifecycle", () => {
    expect(runner).toContain("nativeHostCommand(process.platform");
    expect(runner).toContain("executeBoundedProcess");
    expect(runner).toContain("runProofLifecycle");
    expect(runner).toContain("cleanupProofRun");
    expect(runner).not.toMatch(/playwright|chromium/i);
  });

  it("preserves the distinct native-host timeout exit code after cleanup", () => {
    expect(nativeHost).toMatch(
      /settle_failure\(\s*control_flow,\s*&mut input_driver,\s*124,\s*"WebView2 proof timed out"/,
    );
  });

  it("settles driven input before the outer force-kill can bypass cleanup", () => {
    expect(source).toContain(
      'evidenceMode === "windows-driven" ? 40_000 : 240_000',
    );
    expect(nativeHost).toMatch(
      /host_deadline = if drive_native_input\s*\{\s*AUTOMATED_HOST_DEADLINE/,
    );
    expect(nativeHost).toContain(
      "const AUTOMATED_HOST_DEADLINE: Duration = Duration::from_secs(45)",
    );
    expect(automatedRunner).toContain("outerNativeHostProcess");
  });
});

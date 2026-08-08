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

describe("visible native manual-proof contract", () => {
  it("records real composition, clipboard, and mouse-drag event paths", () => {
    expect(source).toContain('addEventListener("compositionstart"');
    expect(source).toContain('addEventListener("compositionend"');
    expect(source).toContain('addEventListener("copy"');
    expect(source).toContain('addEventListener("paste"');
    expect(source).toContain('addEventListener("mousedown"');
    expect(source).toContain('addEventListener("mouseup"');
    expect(source).not.toMatch(
      /dispatchEvent|new\s+(?:Input|Composition|Clipboard|Mouse)Event/,
    );
  });

  it("uses the same direct platform host and bounded cleanup lifecycle", () => {
    expect(runner).toContain("nativeHostCommand(process.platform");
    expect(runner).toContain("executeBoundedProcess");
    expect(runner).toContain("runProofLifecycle");
    expect(runner).toContain("cleanupProofRun");
    expect(runner).not.toMatch(/playwright|chromium/i);
  });
});

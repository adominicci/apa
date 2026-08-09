// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { BACKUP_NAME_PATTERN } from "$lib/portable/retention";
import { normalizeBackupError, testBackupFileName } from "./backupRuntime.ts";

/**
 * Wizard/runtime seams that must stay stable: the pre-activation test
 * filename obeys the strict retained-backup grammar (so the ledger entry
 * written at activation makes it the first retained recovery archive), and
 * every adapter failure normalizes to a stable snake_case code.
 */

describe("testBackupFileName", () => {
  it("matches the exact retained-backup grammar", () => {
    const name = testBackupFileName(() => new Date("2026-08-08T19:42:00.123Z"));
    expect(name).toMatch(BACKUP_NAME_PATTERN);
    expect(name).toContain("2026-08-08T19-42-00Z");
  });

  it("uses a fresh random middle component per call", () => {
    const now = () => new Date("2026-08-08T19:42:00Z");
    expect(testBackupFileName(now)).not.toBe(testBackupFileName(now));
  });
});

describe("normalizeBackupError", () => {
  it("preserves the Rust adapter's {code, detail} shape", () => {
    const error = normalizeBackupError({
      code: "folder_unavailable",
      detail: "offline",
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("folder_unavailable");
    expect(error.detail).toBe("offline");
  });

  it("maps unknown failures to a stable io code", () => {
    expect(normalizeBackupError("webview bridge lost").code).toBe("io");
    expect(normalizeBackupError(new TypeError("boom")).code).toBe("io");
    expect(normalizeBackupError(null).code).toBe("io");
  });
});

describe("binary backup IPC contract", () => {
  it("passes archive payloads as raw binary instead of JSON number arrays", async () => {
    const deno = (globalThis as unknown as {
      Deno: {
        cwd(): string;
        readTextFile(path: string): Promise<string>;
      };
    }).Deno;
    const source = await deno.readTextFile(
      `${deno.cwd()}/apps/desktop/src/lib/persist/backupRuntime.ts`,
    );
    expect(source).toContain("invoke<T>(command, bytes");
    expect(source).toContain('"x-tesina-file-name": fileName');
    expect(source).not.toContain("Array.from(bytes)");
    expect(source).not.toContain("Array.from(packaged.bytes)");
  });
});

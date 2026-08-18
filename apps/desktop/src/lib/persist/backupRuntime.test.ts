// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { BACKUP_NAME_PATTERN } from "$lib/portable/retention";

const { invokeMock, packageMock, validateArchiveMock, uiLocaleMock } = vi
  .hoisted(() => ({
    invokeMock: vi.fn(),
    packageMock: vi.fn(),
    validateArchiveMock: vi.fn(() => Promise.resolve()),
    uiLocaleMock: {
      backup: undefined,
      updateBackup: vi.fn(),
      flushPending: vi.fn(() => Promise.resolve()),
      clearBackup: vi.fn(),
    },
  }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("$lib/state/uiLocale.svelte", () => ({ uiLocale: uiLocaleMock }));
vi.mock("./portableRuntime.ts", () => ({
  libraryArchiveService: () => Promise.resolve({ package: packageMock }),
  recoverImportTransaction: vi.fn(),
}));
vi.mock("$lib/portable/validate", () => ({
  validateArchive: validateArchiveMock,
}));

import {
  createBackupStore,
  normalizeBackupError,
  pickAndBeginBackupConfiguration,
  tauriBackupAdapter,
  testBackupFileName,
  writeWizardTestBackup,
} from "./backupRuntime.ts";
import { operations } from "./operationCoordinator.ts";

beforeEach(() => {
  invokeMock.mockReset();
  packageMock.mockReset();
  validateArchiveMock.mockClear();
  uiLocaleMock.updateBackup.mockReset();
  uiLocaleMock.flushPending.mockClear();
  uiLocaleMock.clearBackup.mockReset();
});

/**
 * Wizard/runtime seams that must stay stable: the pre-activation test
 * filename obeys the strict retained-backup grammar (so the ledger entry
 * written at activation makes it the first retained recovery archive), and
 * every adapter failure normalizes to a stable snake_case code.
 */

describe("testBackupFileName", () => {
  const backupSetId = "a1b2c3d4-1111-4111-8111-111111111111";

  it("matches the exact retained-backup grammar", () => {
    const name = testBackupFileName(
      backupSetId,
      () => new Date("2026-08-08T19:42:00.123Z"),
    );
    expect(name).toMatch(BACKUP_NAME_PATTERN);
    expect(name).toContain("a1b2c3d4");
    expect(name).toContain("2026-08-08T19-42-00Z");
  });

  it("keeps the active pending set prefix across calls", () => {
    const first = testBackupFileName(
      backupSetId,
      () => new Date("2026-08-08T19:42:00Z"),
    );
    const second = testBackupFileName(
      backupSetId,
      () => new Date("2026-08-08T19:42:01Z"),
    );
    expect(first).toContain("Tesina Library - a1b2c3d4 -");
    expect(second).toContain("Tesina Library - a1b2c3d4 -");
    expect(second).not.toBe(first);
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

describe("backup lifecycle wiring", () => {
  it("keeps folder selection and pending setup inside one native command", async () => {
    const pending = {
      canonicalFolderPath: "/selected",
      backupSubfolderPath: "/selected/Tesina Backups",
      backupSetId: "a1b2c3d4-1111-4111-8111-111111111111",
    };
    invokeMock.mockResolvedValueOnce(pending);

    await expect(pickAndBeginBackupConfiguration()).resolves.toEqual(pending);
    expect(invokeMock).toHaveBeenCalledWith(
      "backup_pick_and_begin_configuration",
      undefined,
    );
  });

  it("packages and names the real wizard test for the native pending set", async () => {
    const backupSetId = "a1b2c3d4-1111-4111-8111-111111111111";
    packageMock.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentDigest: "content-digest",
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === "backup_write_test_archive") {
        return Promise.resolve("sha");
      }
      if (command === "backup_read_test_archive") {
        return Promise.resolve(new Uint8Array([1, 2, 3]));
      }
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });

    await expect(writeWizardTestBackup(backupSetId)).resolves.toMatchObject({
      fileName: expect.stringContaining("Tesina Library - a1b2c3d4 -"),
      contentDigest: "content-digest",
    });
    expect(packageMock).toHaveBeenCalledWith({ backupSetId });
    expect(validateArchiveMock).toHaveBeenCalledOnce();
  });

  it("uses the native pending-write identity for unconfirmed cleanup", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await tauriBackupAdapter.discardPendingArchive("candidate.tesina", "sha");

    expect(invokeMock).toHaveBeenCalledWith(
      "backup_discard_pending_archive",
      { fileName: "candidate.tesina", expectedSha256: "sha" },
    );
  });

  it("denies renderer access to native backup control state", async () => {
    const deno = (globalThis as unknown as {
      Deno: { cwd(): string; readTextFile(path: string): Promise<string> };
    }).Deno;
    const capability = JSON.parse(
      await deno.readTextFile(
        `${deno.cwd()}/apps/desktop/src-tauri/capabilities/default.json`,
      ),
    ) as {
      permissions: Array<string | { identifier: string; deny?: string[] }>;
    };

    for (
      const identifier of [
        "fs:default",
        "fs:allow-appdata-read-recursive",
        "fs:allow-appdata-write-recursive",
      ]
    ) {
      const permission = capability.permissions.find((entry) =>
        typeof entry === "object" && entry.identifier === identifier
      );
      expect(permission).toMatchObject({
        deny: [
          "$APPDATA/.tesina-native",
          "$APPDATA/.tesina-native/**",
          "$APPCACHE/.tesina-native",
          "$APPCACHE/.tesina-native/**",
        ],
      });
    }
  });

  it("uses a name-only native listing for ledger-first retention", async () => {
    invokeMock.mockResolvedValueOnce(["owned.tesina", "unowned.tesina"]);

    await expect(tauriBackupAdapter.listArchiveNames()).resolves.toEqual([
      "owned.tesina",
      "unowned.tesina",
    ]);
    expect(invokeMock).toHaveBeenCalledWith(
      "backup_list_archive_names",
      undefined,
    );
  });

  it("awaits native cancellation before an aborted operation settles", async () => {
    let resolveStatus!: (status: {
      configured: boolean;
      folderAvailable: boolean;
      requiresReauthorization: boolean;
    }) => void;
    let resolveCancellation!: () => void;
    const status = new Promise((resolve) => {
      resolveStatus = resolve;
    });
    const cancellation = new Promise<void>((resolve) => {
      resolveCancellation = resolve;
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === "backup_status") return status;
      if (command === "backup_cancel_current_operations") return cancellation;
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });

    const pending = createBackupStore().runManual();
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("backup_status", undefined);
    });
    const shutdown = operations.awaitSafeShutdown();

    try {
      await vi.waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith(
          "backup_cancel_current_operations",
          undefined,
        );
      });
      resolveStatus({
        configured: false,
        folderAvailable: false,
        requiresReauthorization: false,
      });

      let settled = false;
      void pending.finally(() => {
        settled = true;
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);

      resolveCancellation();
      await expect(pending).resolves.toEqual({
        kind: "failed",
        errorCode: "cancelled",
      });
      await shutdown;
    } finally {
      resolveStatus({
        configured: false,
        folderAvailable: false,
        requiresReauthorization: false,
      });
      resolveCancellation();
      await Promise.allSettled([pending, shutdown]);
      await operations.resumeAfterFailedShutdown();
    }
  });
});

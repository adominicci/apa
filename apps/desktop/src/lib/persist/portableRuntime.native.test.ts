import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => {
  const exportToFile = vi.fn();
  return {
    invoke: vi.fn(),
    externalDialogFs: vi.fn(() => ({ kind: "external-fs" })),
    createLibraryArchiveService: vi.fn(() => ({
      exportToFile,
    })),
    exportToFile,
    runOperation: vi.fn(
      async (_kind: string, operation: (handle: unknown) => Promise<unknown>) =>
        await operation({
          signal: new AbortController().signal,
          markRecoverable: vi.fn(),
        }),
    ),
  };
});

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(() => Promise.resolve("0.1.17")),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: runtime.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("./archiveService.ts", () => ({
  createLibraryArchiveService: runtime.createLibraryArchiveService,
}));
vi.mock("./appDataFs.ts", () => ({
  appDataImportFs: {},
  appDataReplacementJournal: {},
  appDataSnapshotIo: {},
  externalDialogFs: runtime.externalDialogFs,
}));
vi.mock("./coordinator.ts", () => ({
  persistence: {
    runMaintenance: vi.fn((operation: () => unknown) => operation()),
    flushPending: vi.fn(() => Promise.resolve()),
    activityGeneration: 0,
  },
}));
vi.mock("./operationCoordinator.ts", () => ({
  operations: { run: runtime.runOperation },
}));

import { exportLibraryToChosenFile } from "./portableRuntime.ts";

const SELECTION = {
  path: "/exports/Library.tesina",
  authorizationToken: "native-save-token",
};

beforeEach(() => {
  vi.clearAllMocks();
  runtime.invoke.mockImplementation((command: string) => {
    if (command === "external_pick_save_destination") {
      return Promise.resolve(SELECTION);
    }
    if (command === "external_finish_save_authorization") {
      return Promise.resolve();
    }
    return Promise.reject(new Error(`unexpected command: ${command}`));
  });
  runtime.exportToFile.mockResolvedValue({
    path: SELECTION.path,
    contentDigest: "digest",
  });
});

describe("native manual-export authorization", () => {
  it("binds export to the native save token and always revokes it", async () => {
    await expect(exportLibraryToChosenFile("Library.tesina")).resolves.toEqual({
      path: SELECTION.path,
    });

    expect(runtime.invoke.mock.calls).toEqual([
      ["external_pick_save_destination", {
        suggestedName: "Library.tesina",
      }],
      ["external_finish_save_authorization", {
        authorizationToken: SELECTION.authorizationToken,
      }],
    ]);
    expect(runtime.externalDialogFs).toHaveBeenCalledWith(
      SELECTION.authorizationToken,
    );
    expect(runtime.exportToFile).toHaveBeenCalledWith(
      SELECTION.path,
      expect.any(AbortSignal),
    );
  });

  it("revokes the token when safe-write export fails", async () => {
    runtime.exportToFile.mockRejectedValueOnce(new Error("write failed"));

    await expect(exportLibraryToChosenFile("Library.tesina")).rejects.toThrow(
      "write failed",
    );
    expect(runtime.invoke).toHaveBeenLastCalledWith(
      "external_finish_save_authorization",
      { authorizationToken: SELECTION.authorizationToken },
    );
  });

  it("does not create export authority when the native picker is cancelled", async () => {
    runtime.invoke.mockResolvedValueOnce(null);

    await expect(exportLibraryToChosenFile("Library.tesina")).resolves
      .toBeNull();
    expect(runtime.externalDialogFs).not.toHaveBeenCalled();
    expect(runtime.exportToFile).not.toHaveBeenCalled();
    expect(runtime.invoke).toHaveBeenCalledOnce();
  });
});

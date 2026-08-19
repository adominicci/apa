import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  open: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
  readTextFile: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
  writeTextFile: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: runtime.exists,
  mkdir: runtime.mkdir,
  open: runtime.open,
  readDir: runtime.readDir,
  readFile: runtime.readFile,
  readTextFile: runtime.readTextFile,
  remove: runtime.remove,
  rename: runtime.rename,
  stat: runtime.stat,
  writeFile: runtime.writeFile,
  writeTextFile: runtime.writeTextFile,
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn(() => Promise.resolve("/app-data")),
  dirname: vi.fn((path: string) =>
    Promise.resolve(path.slice(0, path.lastIndexOf("/")))
  ),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: runtime.invoke }));

import { appDataReplacementJournal, externalDialogFs } from "./appDataFs.ts";
import { ARCHIVE_LIMITS } from "$lib/portable/limits";

const DESTINATION = "/exports/source.tesina";
const TEMPORARY = `${DESTINATION}.00000000-0000-4000-8000-000000000001.tmp`;
const PREVIOUS = `${DESTINATION}.00000000-0000-4000-8000-000000000002.prev`;
const EXPECTED_SHA256 = "abc123";
const AUTHORIZATION_TOKEN = "save-authorization-token";

beforeEach(() => {
  vi.clearAllMocks();
  runtime.invoke.mockImplementation((command: string) => {
    switch (command) {
      case "external_related_exists":
        return Promise.resolve(true);
      case "external_read_temp":
        return Promise.resolve(new Uint8Array([1, 2, 3]));
      case "external_hash_previous":
        return Promise.resolve("abc123");
      default:
        return Promise.resolve();
    }
  });
});

describe("externalDialogFs", () => {
  it("routes dialog-related temporary and preserved files through purpose-specific native commands", async () => {
    const fs = externalDialogFs(AUTHORIZATION_TOKEN);
    const bytes = new Uint8Array([1, 2, 3]);

    await fs.writeFile(TEMPORARY, bytes);
    expect(await fs.readFile(TEMPORARY)).toEqual(bytes);
    expect(await fs.readFileBounded(TEMPORARY, bytes.byteLength)).toEqual(
      bytes,
    );
    expect(await fs.exists(PREVIOUS)).toBe(true);
    expect(await fs.sha256File(PREVIOUS, 1_024)).toBe("abc123");
    await fs.rename(DESTINATION, PREVIOUS, EXPECTED_SHA256);
    await fs.renameNoReplace(TEMPORARY, DESTINATION, EXPECTED_SHA256);
    await fs.removeIfHashMatches(TEMPORARY, EXPECTED_SHA256);
    await fs.removeIfHashMatches(
      PREVIOUS,
      EXPECTED_SHA256,
      "installed-digest",
    );

    expect(runtime.invoke.mock.calls).toEqual([
      ["external_write_temp", bytes, {
        headers: {
          "x-tesina-related-path-encoded": encodeURIComponent(TEMPORARY),
          "x-tesina-save-authorization": AUTHORIZATION_TOKEN,
        },
      }],
      ["external_read_temp", {
        path: TEMPORARY,
        maxBytes: ARCHIVE_LIMITS.maxArchiveBytes,
        authorizationToken: AUTHORIZATION_TOKEN,
      }],
      ["external_read_temp", {
        path: TEMPORARY,
        maxBytes: bytes.byteLength,
        authorizationToken: AUTHORIZATION_TOKEN,
      }],
      ["external_related_exists", {
        path: PREVIOUS,
        authorizationToken: AUTHORIZATION_TOKEN,
      }],
      ["external_hash_previous", {
        path: PREVIOUS,
        maxBytes: 1_024,
        authorizationToken: AUTHORIZATION_TOKEN,
      }],
      ["external_preserve_destination", {
        destination: DESTINATION,
        previous: PREVIOUS,
        expectedSha256: EXPECTED_SHA256,
        authorizationToken: AUTHORIZATION_TOKEN,
      }],
      ["external_rename_no_replace", {
        from: TEMPORARY,
        to: DESTINATION,
        expectedSha256: EXPECTED_SHA256,
        authorizationToken: AUTHORIZATION_TOKEN,
      }],
      ["external_remove_temp", {
        path: TEMPORARY,
        expectedSha256: EXPECTED_SHA256,
        authorizationToken: AUTHORIZATION_TOKEN,
      }],
      ["external_remove_if_hash_matches", {
        path: PREVIOUS,
        expectedSha256: EXPECTED_SHA256,
        installedDestinationSha256: "installed-digest",
        authorizationToken: AUTHORIZATION_TOKEN,
      }],
    ]);
    expect(runtime.writeFile).not.toHaveBeenCalled();
    expect(runtime.readFile).not.toHaveBeenCalled();
    expect(runtime.rename).not.toHaveBeenCalled();
    expect(runtime.remove).not.toHaveBeenCalled();
  });

  it("routes the exact save-selected destination through its native token", async () => {
    const fs = externalDialogFs(AUTHORIZATION_TOKEN);
    const bytes = new Uint8Array([4, 5, 6]);
    runtime.invoke.mockImplementation((command: string) => {
      if (command === "external_destination_exists") {
        return Promise.resolve(true);
      }
      if (command === "external_read_destination") {
        return Promise.resolve(bytes);
      }
      if (command === "external_hash_destination") {
        return Promise.resolve(EXPECTED_SHA256);
      }
      return Promise.resolve();
    });

    expect(await fs.exists(DESTINATION)).toBe(true);
    expect(await fs.readFile(DESTINATION)).toEqual(bytes);
    expect(await fs.readFileBounded(DESTINATION, 10)).toEqual(bytes);
    expect(await fs.sha256File(DESTINATION, 10)).toBe(EXPECTED_SHA256);
    await expect(fs.writeFile(DESTINATION, bytes)).rejects.toMatchObject({
      code: "portable/invalid-destination-write",
    });

    expect(runtime.invoke.mock.calls).toEqual([
      ["external_destination_exists", {
        path: DESTINATION,
        authorizationToken: AUTHORIZATION_TOKEN,
      }],
      ["external_read_destination", {
        path: DESTINATION,
        maxBytes: ARCHIVE_LIMITS.maxArchiveBytes,
        authorizationToken: AUTHORIZATION_TOKEN,
      }],
      ["external_read_destination", {
        path: DESTINATION,
        maxBytes: 10,
        authorizationToken: AUTHORIZATION_TOKEN,
      }],
      ["external_hash_destination", {
        path: DESTINATION,
        maxBytes: 10,
        authorizationToken: AUTHORIZATION_TOKEN,
      }],
    ]);
    expect(runtime.exists).not.toHaveBeenCalled();
    expect(runtime.readFile).not.toHaveBeenCalled();
    expect(runtime.writeFile).not.toHaveBeenCalled();
  });

  it("keeps an open-selected import destination on the scoped filesystem plugin", async () => {
    const fs = externalDialogFs();
    const bytes = new Uint8Array([4, 5, 6]);
    runtime.exists.mockResolvedValue(true);
    runtime.readFile.mockResolvedValue(bytes);

    expect(await fs.exists(DESTINATION)).toBe(true);
    expect(await fs.readFile(DESTINATION)).toEqual(bytes);

    expect(runtime.exists).toHaveBeenCalledWith(DESTINATION);
    expect(runtime.readFile).toHaveBeenCalledWith(DESTINATION);
    expect(runtime.invoke).not.toHaveBeenCalled();
  });

  it("bounds incremental hashes of a dialog-selected destination", async () => {
    const close = vi.fn(() => Promise.resolve());
    runtime.open.mockResolvedValue({
      read: vi.fn((buffer: Uint8Array) => {
        buffer.fill(7);
        return Promise.resolve(buffer.byteLength);
      }),
      close,
    });

    await expect(externalDialogFs().sha256File(DESTINATION, 3)).rejects
      .toMatchObject({ code: "portable/file-too-large" });

    expect(runtime.open).toHaveBeenCalledWith(DESTINATION, { read: true });
    expect(close).toHaveBeenCalledOnce();
  });

  it("encodes Unicode destinations into an ASCII-safe binary request header", async () => {
    const fs = externalDialogFs(AUTHORIZATION_TOKEN);
    const path =
      "/exports/学生.tesina.00000000-0000-4000-8000-000000000001.tmp";
    const bytes = new Uint8Array([7, 8, 9]);

    await fs.writeFile(path, bytes);

    expect(runtime.invoke).toHaveBeenCalledWith("external_write_temp", bytes, {
      headers: {
        "x-tesina-related-path-encoded": encodeURIComponent(path),
        "x-tesina-save-authorization": AUTHORIZATION_TOKEN,
      },
    });
    expect(encodeURIComponent(path)).toMatch(/^[\x20-\x7e]+$/);
  });

  it("recognizes uppercase and mixed-case .tesina dialog destinations", async () => {
    const fs = externalDialogFs(AUTHORIZATION_TOKEN);
    const uppercaseTemporary =
      "/exports/SOURCE.TESINA.00000000-0000-4000-8000-000000000003.tmp";
    const mixedCasePrevious =
      "/exports/Source.TeSiNa.00000000-0000-4000-8000-000000000004.prev";
    const bytes = new Uint8Array([10, 11, 12]);

    await fs.writeFile(uppercaseTemporary, bytes);
    expect(await fs.exists(mixedCasePrevious)).toBe(true);

    expect(runtime.invoke.mock.calls).toEqual([
      ["external_write_temp", bytes, {
        headers: {
          "x-tesina-related-path-encoded": encodeURIComponent(
            uppercaseTemporary,
          ),
          "x-tesina-save-authorization": AUTHORIZATION_TOKEN,
        },
      }],
      ["external_related_exists", {
        path: mixedCasePrevious,
        authorizationToken: AUTHORIZATION_TOKEN,
      }],
    ]);
    expect(runtime.writeFile).not.toHaveBeenCalled();
    expect(runtime.exists).not.toHaveBeenCalled();
  });

  it("keeps UUID hex and related suffixes canonical lowercase", async () => {
    const fs = externalDialogFs();
    const uppercaseUuid =
      "/exports/source.TESINA.00000000-0000-4000-8000-00000000000A.tmp";
    const uppercaseSuffix =
      "/exports/source.TESINA.00000000-0000-4000-8000-000000000005.PREV";
    const nonV4Uuid =
      "/exports/source.TESINA.00000000-0000-1000-8000-000000000005.tmp";
    runtime.exists.mockResolvedValue(false);

    expect(await fs.exists(uppercaseUuid)).toBe(false);
    expect(await fs.exists(uppercaseSuffix)).toBe(false);
    expect(await fs.exists(nonV4Uuid)).toBe(false);

    expect(runtime.exists.mock.calls).toEqual([
      [uppercaseUuid],
      [uppercaseSuffix],
      [nonV4Uuid],
    ]);
    expect(runtime.invoke).not.toHaveBeenCalled();
  });

  it("rejects related-file access without a fresh save authorization", async () => {
    await expect(externalDialogFs().exists(TEMPORARY)).rejects.toMatchObject({
      code: "portable/authorization-required",
    });
    expect(runtime.invoke).not.toHaveBeenCalled();
  });
});

describe("appDataReplacementJournal", () => {
  const legacyRecord = {
    id: "legacy-operation",
    destinationPath: "/exports/legacy.tesina",
    temporaryPath: "/exports/legacy.tesina.operation.tmp",
    previousPath: "/exports/legacy.tesina.operation.prev",
    expectedSha256: "new-digest",
    previousSha256: "old-digest",
  };

  it("normalizes v1 replacement records and rewrites schema v2 on save", async () => {
    runtime.exists.mockResolvedValue(true);
    runtime.readTextFile.mockResolvedValue(JSON.stringify({
      schemaVersion: 1,
      records: [legacyRecord],
    }));
    runtime.rename.mockResolvedValue(undefined);

    expect(await appDataReplacementJournal.list()).toEqual([{
      ...legacyRecord,
      phase: "replacing",
    }]);

    await appDataReplacementJournal.save({
      phase: "staging",
      id: "new-operation",
      destinationPath: DESTINATION,
      temporaryPath: TEMPORARY,
      previousPath: PREVIOUS,
      expectedSha256: EXPECTED_SHA256,
    });

    const written = JSON.parse(runtime.writeTextFile.mock.calls.at(-1)?.[1]);
    expect(written).toEqual({
      schemaVersion: 2,
      records: [{ ...legacyRecord, phase: "replacing" }, {
        phase: "staging",
        id: "new-operation",
        destinationPath: DESTINATION,
        temporaryPath: TEMPORARY,
        previousPath: PREVIOUS,
        expectedSha256: EXPECTED_SHA256,
      }],
    });
  });

  it("fails closed for an unknown schema-v2 phase", async () => {
    runtime.exists.mockResolvedValue(true);
    runtime.readTextFile.mockResolvedValue(JSON.stringify({
      schemaVersion: 2,
      records: [{ ...legacyRecord, phase: "unknown" }],
    }));

    await expect(appDataReplacementJournal.list()).rejects.toThrow(
      "invalid replacement journal phase",
    );
  });

  it("fails closed when the replacement journal contains JSON null", async () => {
    runtime.exists.mockResolvedValue(true);
    runtime.readTextFile.mockResolvedValue("null");

    await expect(appDataReplacementJournal.list()).rejects.toThrow(
      "invalid replacement journal",
    );
  });
});

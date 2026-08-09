import { describe, expect, it, vi } from "vitest";
import {
  installReplacement,
  recoverInterruptedReplacement,
} from "./atomicReplace.ts";

describe("installReplacement", () => {
  it("preserves the existing Windows destination until install succeeds", async () => {
    const files = new Set(["journal.tmp", "journal.json"]);
    const rename = vi.fn((from: string, to: string): Promise<void> => {
      if (!files.has(from)) throw new Error("missing source");
      if (files.has(to)) throw new Error("destination exists");
      files.delete(from);
      files.add(to);
      return Promise.resolve();
    });
    const remove = vi.fn((path: string): Promise<void> => {
      files.delete(path);
      return Promise.resolve();
    });

    await installReplacement("journal.tmp", "journal.json", {
      exists: (path) => Promise.resolve(files.has(path)),
      remove,
      rename,
    }, true);

    expect(rename).toHaveBeenNthCalledWith(
      2,
      "journal.json",
      "journal.json.previous",
    );
    expect(remove).toHaveBeenCalledWith("journal.json.previous");
    expect(files).toEqual(new Set(["journal.json"]));
  });

  it("restores the previous Windows destination when install fails", async () => {
    const files = new Set(["journal.tmp", "journal.json"]);
    let renameCount = 0;
    const rename = vi.fn((from: string, to: string): Promise<void> => {
      renameCount += 1;
      if (renameCount === 1 || renameCount === 3) {
        throw new Error("rename failed");
      }
      files.delete(from);
      files.add(to);
      return Promise.resolve();
    });

    await expect(
      installReplacement("journal.tmp", "journal.json", {
        exists: (path) => Promise.resolve(files.has(path)),
        remove: (path) => {
          files.delete(path);
          return Promise.resolve();
        },
        rename,
      }, true),
    ).rejects.toThrow("rename failed");

    expect(files.has("journal.json")).toBe(true);
    expect(files.has("journal.json.previous")).toBe(false);
  });

  it("recovers a previous file left by an interrupted Windows install", async () => {
    const files = new Set(["journal.json.previous"]);
    await recoverInterruptedReplacement("journal.json", {
      exists: (path) => Promise.resolve(files.has(path)),
      remove: (path) => {
        files.delete(path);
        return Promise.resolve();
      },
      rename: (from, to) => {
        files.delete(from);
        files.add(to);
        return Promise.resolve();
      },
    });
    expect(files).toEqual(new Set(["journal.json"]));
  });

  it("preserves the original error when no destination exists", async () => {
    const failure = new Error("permission denied");
    await expect(
      installReplacement("journal.tmp", "journal.json", {
        exists: () => Promise.resolve(false),
        remove: vi.fn(),
        rename: () => Promise.reject(failure),
      }),
    ).rejects.toBe(failure);
  });
});

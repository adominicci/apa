import { describe, expect, it, vi } from "vitest";
import { installReplacement } from "./appDataFs.ts";

describe("installReplacement", () => {
  it("retries after removing an existing Windows destination", async () => {
    const rename = vi.fn()
      .mockRejectedValueOnce(new Error("destination exists"))
      .mockResolvedValueOnce(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);

    await installReplacement("journal.tmp", "journal.json", {
      exists: () => Promise.resolve(true),
      remove,
      rename,
    }, true);

    expect(remove).toHaveBeenCalledWith("journal.json");
    expect(rename).toHaveBeenCalledTimes(2);
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

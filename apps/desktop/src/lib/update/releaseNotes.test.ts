import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPendingReleaseNotes,
  PENDING_RELEASE_NOTES_KEY,
  readPendingReleaseNotes,
  releaseNotesForVersion,
  savePendingReleaseNotes,
} from "./releaseNotes.ts";

class MemoryStorage implements Storage {
  #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

describe("pending release notes", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("round-trips the installed version and plain-text body", () => {
    savePendingReleaseNotes(storage, {
      version: "0.2.0",
      body: "New citation tools\nSafer exports",
    });

    expect(readPendingReleaseNotes(storage)).toEqual({
      version: "0.2.0",
      body: "New citation tools\nSafer exports",
    });
  });

  it("returns notes only for the running version and preserves a future marker", () => {
    savePendingReleaseNotes(storage, {
      version: "0.3.0",
      body: "Coming after restart",
    });

    expect(
      releaseNotesForVersion(storage, "0.2.0", "Update installed."),
    ).toBeNull();
    expect(readPendingReleaseNotes(storage)).toEqual({
      version: "0.3.0",
      body: "Coming after restart",
    });
    expect(
      releaseNotesForVersion(storage, "0.3.0", "Update installed."),
    ).toEqual({ version: "0.3.0", body: "Coming after restart" });
  });

  it.each([
    "not json",
    "null",
    "[]",
    "{}",
    '{"version":"","body":"Notes"}',
    '{"version":" 0.2.0","body":"Notes"}',
    '{"version":"0.2.0","body":42}',
  ])("removes malformed persisted data: %s", (raw) => {
    storage.setItem(PENDING_RELEASE_NOTES_KEY, raw);

    expect(readPendingReleaseNotes(storage)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("removes the marker when the notes are dismissed", () => {
    storage.setItem(
      PENDING_RELEASE_NOTES_KEY,
      '{"version":"0.2.0","body":"Installed successfully"}',
    );

    clearPendingReleaseNotes(storage);

    expect(readPendingReleaseNotes(storage)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("does not clear a newer marker when older displayed notes are dismissed", () => {
    const displayed = {
      version: "0.2.0",
      body: "Already displayed",
    };
    savePendingReleaseNotes(storage, {
      version: "0.3.0",
      body: "Installed while the dialog was open",
    });

    clearPendingReleaseNotes(storage, displayed);

    expect(readPendingReleaseNotes(storage)).toEqual({
      version: "0.3.0",
      body: "Installed while the dialog was open",
    });
  });

  it("clears empty-body notes after their localized fallback is dismissed", () => {
    savePendingReleaseNotes(storage, { version: "0.2.0", body: "  \n" });
    const displayed = releaseNotesForVersion(
      storage,
      "0.2.0",
      "Tesina was updated successfully.",
    )!;

    clearPendingReleaseNotes(storage, displayed);

    expect(readPendingReleaseNotes(storage)).toBeNull();
  });

  it("uses localized fallback copy when the manifest body is empty", () => {
    savePendingReleaseNotes(storage, { version: "0.2.0", body: "  \n" });

    expect(
      releaseNotesForVersion(
        storage,
        "0.2.0",
        "Tesina was updated successfully.",
      ),
    ).toEqual({
      version: "0.2.0",
      body: "Tesina was updated successfully.",
    });
  });
});

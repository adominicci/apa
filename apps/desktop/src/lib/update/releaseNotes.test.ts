import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPendingReleaseNotes,
  PENDING_RELEASE_NOTES_KEY,
  readPendingReleaseNotes,
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

  it("preserves a future marker for runtime matching by the controller", () => {
    savePendingReleaseNotes(storage, {
      version: "0.3.0",
      body: "Coming after restart",
    });

    expect(readPendingReleaseNotes(storage)).toEqual({
      version: "0.3.0",
      body: "Coming after restart",
    });
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

    clearPendingReleaseNotes(storage, readPendingReleaseNotes(storage)!);

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

  it("does not clear a concurrently replaced marker for the same version", () => {
    const displayed = {
      version: "0.2.0",
      body: "Original marker",
    };
    savePendingReleaseNotes(storage, {
      version: "0.2.0",
      body: "Replacement marker written while the dialog was open",
    });

    clearPendingReleaseNotes(storage, displayed);

    expect(readPendingReleaseNotes(storage)).toEqual({
      version: "0.2.0",
      body: "Replacement marker written while the dialog was open",
    });
  });

  it("clears empty-body markers after canonical notes are dismissed", () => {
    savePendingReleaseNotes(storage, { version: "0.2.0", body: "  \n" });
    const marker = readPendingReleaseNotes(storage)!;

    clearPendingReleaseNotes(storage, marker);

    expect(readPendingReleaseNotes(storage)).toBeNull();
  });
});

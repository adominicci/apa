// @vitest-environment jsdom

import { flushSync, mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Reference } from "@tesina/engine";
import LibraryScreen from "./LibraryScreen.svelte";

const runtime = vi.hoisted(() => {
  class IncompleteEssayScanError extends Error {
    readonly unreadableFiles: string[];

    constructor(unreadableFiles: string[]) {
      super("Incomplete essay scan");
      this.unreadableFiles = unreadableFiles;
    }
  }

  const reference: Reference = {
    id: "reference-id",
    type: "website",
    authors: [{ kind: "person", family: "Rivera", given: "Alex" }],
    date: { year: 2026 },
    title: "Evidence-based teaching",
    siteName: "Teaching Lab",
    url: "https://example.test/reference",
  };

  return {
    IncompleteEssayScanError,
    reference,
    essaysCiting: vi.fn(),
    remove: vi.fn(),
  };
});

vi.mock("$lib/state/essays.svelte", () => ({
  IncompleteEssayScanError: runtime.IncompleteEssayScanError,
  essays: {
    essaysCiting: runtime.essaysCiting,
  },
}));

vi.mock("$lib/state/library.svelte", () => ({
  library: {
    references: [runtime.reference],
    collections: [],
    reload: vi.fn(),
    add: vi.fn(),
    update: vi.fn(),
    remove: runtime.remove,
    createCollection: vi.fn(),
    renameCollection: vi.fn(),
    deleteCollection: vi.fn(),
    toggleMembership: vi.fn(),
  },
}));

vi.mock("$lib/state/uiLocale.svelte", () => ({
  uiLocale: {
    current: "es",
    theme: "system",
    cycleTheme: vi.fn(),
  },
}));

vi.mock("$lib/persist/portableRuntime", () => ({
  applyImportWithRuntime: vi.fn(),
  exportLibraryToChosenFile: vi.fn(),
  pickAndPreviewImport: vi.fn(),
}));

afterEach(() => {
  document.body.replaceChildren();
  runtime.essaysCiting.mockReset();
  runtime.remove.mockReset();
});

describe("reference deletion safety", () => {
  it("shows unreadable files without exposing a destructive confirmation", async () => {
    runtime.essaysCiting.mockRejectedValue(
      new runtime.IncompleteEssayScanError(["damaged-paper.json"]),
    );
    const component = mount(LibraryScreen, {
      target: document.body,
      props: { onBack: vi.fn() },
    });
    flushSync();

    document.querySelector<HTMLButtonElement>(".ref-card .del")!.click();
    await tick();
    flushSync();

    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    expect(dialog?.textContent).toContain("No se eliminó la referencia");
    expect(dialog?.textContent).toContain("damaged-paper.json");
    expect(dialog?.querySelector(".btn-danger-solid")).toBeNull();
    expect(runtime.remove).not.toHaveBeenCalled();
    await unmount(component);
  });
});

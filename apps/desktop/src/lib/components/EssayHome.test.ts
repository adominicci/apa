// @vitest-environment jsdom

import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EssaySummary } from "$lib/model/essay";
import { bundledReleaseNotes } from "$lib/update/bundledReleaseNotes";
import { createReleaseNotesController } from "$lib/update/releaseNotesController.svelte";
import EssayHome from "./EssayHomeReleaseNotesHarness.test.svelte";

const stores = vi.hoisted(() => ({
  create: vi.fn(),
  summaries: [] as EssaySummary[],
  uiLanguage: "es" as "es" | "en",
}));

vi.mock("$lib/state/essays.svelte", () => ({
  essays: {
    loaded: true,
    get summaries() {
      return stores.summaries;
    },
    create: stores.create,
    rename: vi.fn(),
    duplicate: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("$lib/state/uiLocale.svelte", () => ({
  uiLocale: {
    get current() {
      return stores.uiLanguage;
    },
    theme: "system",
    cycleTheme: vi.fn(),
    set: vi.fn(),
    setTheme: vi.fn(),
  },
}));

const existingSummary: EssaySummary = {
  id: "existing-paper",
  title: "Existing paper",
  updatedAt: "2026-08-07T12:00:00.000Z",
  language: "en",
  words: 120,
  preview: "Existing body text",
};

afterEach(() => {
  document.body.replaceChildren();
  stores.create.mockReset();
  stores.summaries = [];
  stores.uiLanguage = "es";
});

describe("essay launch context", () => {
  it("shows the installed version as an accessible release-notes button", async () => {
    const component = mount(EssayHome, {
      target: document.body,
      props: {
        onCreate: vi.fn(),
        onOpen: vi.fn(),
        onOpenLibrary: vi.fn(),
      },
    });
    flushSync();

    const versionButton = document.querySelector<HTMLButtonElement>(
      "button[data-release-notes-version]",
    );
    expect(versionButton).not.toBeNull();
    expect(versionButton?.type).toBe("button");
    expect(versionButton?.textContent).toBe(
      `v${bundledReleaseNotes.version}`,
    );
    expect(versionButton?.title).toBe(
      `Novedades de Tesina ${bundledReleaseNotes.version}`,
    );
    expect(versionButton?.getAttribute("aria-label")).toBe(
      `Abrir las notas de Tesina ${bundledReleaseNotes.version}`,
    );
    expect(versionButton?.closest(".foot")?.textContent).toContain(
      "APA 7.ª ed.",
    );
    await unmount(component);
  });

  it("opens only installed notes, traps focus, reopens, and returns to the home opener", async () => {
    const releaseNotesController = createReleaseNotesController({
      bundled: bundledReleaseNotes,
      getRuntimeVersion: () => Promise.resolve(bundledReleaseNotes.version),
      getStorage: () => null,
      unavailableBody: () => "Las notas no están disponibles.",
    });
    releaseNotesController.setUiReady(true);
    await releaseNotesController.resolveRuntimeVersion();
    const onCreate = vi.fn();
    const onOpen = vi.fn();
    const onOpenLibrary = vi.fn();
    const initialLocation = globalThis.location.href;
    const component = mount(EssayHome, {
      target: document.body,
      props: {
        onCreate,
        onOpen,
        onOpenLibrary,
        releaseNotesController,
      },
    });
    flushSync();

    const versionButton = document.querySelector<HTMLButtonElement>(
      "button[data-release-notes-version]",
    )!;
    versionButton.focus();
    versionButton.click();
    flushSync();

    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain(
      `Tesina ${bundledReleaseNotes.version}`,
    );
    expect(dialog?.textContent).toContain(
      "Backups can now be set up when a paper contains website links",
    );
    expect(dialog?.contains(document.activeElement)).toBe(true);
    globalThis.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    expect(dialog?.contains(document.activeElement)).toBe(true);

    document.querySelector<HTMLButtonElement>(".modal .btn-primary")!.click();
    flushSync();
    expect(document.activeElement).toBe(versionButton);
    expect(document.querySelector("[role='dialog']")).toBeNull();

    versionButton.click();
    flushSync();
    expect(document.querySelector("[role='dialog']")?.textContent).toContain(
      "Backups can now be set up when a paper contains website links",
    );
    expect(globalThis.location.href).toBe(initialLocation);
    expect(onCreate).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(onOpenLibrary).not.toHaveBeenCalled();
    await unmount(component);
  });

  it("localizes the home version control in English", async () => {
    stores.uiLanguage = "en";
    const component = mount(EssayHome, {
      target: document.body,
      props: {
        onCreate: vi.fn(),
        onOpen: vi.fn(),
        onOpenLibrary: vi.fn(),
      },
    });
    flushSync();

    const versionButton = document.querySelector<HTMLButtonElement>(
      "button[data-release-notes-version]",
    )!;
    expect(versionButton.title).toBe(
      `What's new in Tesina ${bundledReleaseNotes.version}`,
    );
    expect(versionButton.getAttribute("aria-label")).toBe(
      `Open release notes for Tesina ${bundledReleaseNotes.version}`,
    );
    expect(versionButton.closest(".foot")?.textContent).toContain(
      "APA 7th ed.",
    );
    await unmount(component);
  });

  it.each([null, undefined, "", "  ", 42, {}])(
    "keeps packaged notes available for malformed runtime version %j",
    async (runtimeVersion) => {
      const releaseNotesController = createReleaseNotesController({
        bundled: bundledReleaseNotes,
        getRuntimeVersion: () => Promise.resolve(runtimeVersion),
        getStorage: () => null,
        unavailableBody: () => "Las notas no están disponibles.",
      });
      releaseNotesController.setUiReady(true);
      await releaseNotesController.resolveRuntimeVersion();
      const component = mount(EssayHome, {
        target: document.body,
        props: {
          onCreate: vi.fn(),
          onOpen: vi.fn(),
          onOpenLibrary: vi.fn(),
          releaseNotesController,
        },
      });
      flushSync();

      const versionButton = document.querySelector<HTMLButtonElement>(
        "button[data-release-notes-version]",
      )!;
      expect(versionButton.textContent).toBe(
        `v${bundledReleaseNotes.version}`,
      );
      versionButton.click();
      flushSync();
      expect(document.querySelector("[role='dialog']")?.textContent).toContain(
        "Backups can now be set up when a paper contains website links",
      );
      expect(document.querySelector("[role='dialog']")?.textContent).not
        .toContain("Las notas no están disponibles.");
      await unmount(component);
    },
  );

  it("emits create intent synchronously before persistence begins", async () => {
    stores.create.mockResolvedValue({ id: "new-paper" });
    const onCreate = vi.fn();
    const onOpen = vi.fn();
    const component = mount(EssayHome, {
      target: document.body,
      props: { onCreate, onOpen, onOpenLibrary: vi.fn() },
    });
    flushSync();

    const createButton = document.querySelector<HTMLButtonElement>(
      "button.essay.new",
    );
    expect(createButton).not.toBeNull();
    createButton!.click();

    expect(onCreate).toHaveBeenCalledWith("es");
    expect(stores.create).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    await unmount(component);
  });

  it("marks a saved paper opened from home as existing", async () => {
    stores.summaries = [existingSummary];
    const onOpen = vi.fn();
    const component = mount(EssayHome, {
      target: document.body,
      props: { onCreate: vi.fn(), onOpen, onOpenLibrary: vi.fn() },
    });
    flushSync();

    const existingCard = document.querySelector<HTMLElement>(
      ".essay[role='button']",
    );
    expect(existingCard).not.toBeNull();
    existingCard!.click();

    expect(onOpen).toHaveBeenCalledWith("existing-paper");
    await unmount(component);
  });
});

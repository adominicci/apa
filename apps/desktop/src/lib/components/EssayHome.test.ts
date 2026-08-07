// @vitest-environment jsdom

import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EssaySummary } from "$lib/model/essay";
import EssayHome from "./EssayHome.svelte";

const stores = vi.hoisted(() => ({
  create: vi.fn(),
  summaries: [] as EssaySummary[],
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
    current: "es",
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
});

describe("essay launch context", () => {
  it("marks a paper created from home as newly created", async () => {
    stores.create.mockResolvedValue({ id: "new-paper" });
    const onOpen = vi.fn();
    const component = mount(EssayHome, {
      target: document.body,
      props: { onOpen, onOpenLibrary: vi.fn() },
    });
    flushSync();

    const createButton = document.querySelector<HTMLButtonElement>(
      "button.essay.new",
    );
    expect(createButton).not.toBeNull();
    createButton!.click();

    await vi.waitFor(() => {
      expect(onOpen).toHaveBeenCalledWith("new-paper", true);
    });
    await unmount(component);
  });

  it("marks a saved paper opened from home as existing", async () => {
    stores.summaries = [existingSummary];
    const onOpen = vi.fn();
    const component = mount(EssayHome, {
      target: document.body,
      props: { onOpen, onOpenLibrary: vi.fn() },
    });
    flushSync();

    const existingCard = document.querySelector<HTMLElement>(
      ".essay[role='button']",
    );
    expect(existingCard).not.toBeNull();
    existingCard!.click();

    expect(onOpen).toHaveBeenCalledWith("existing-paper", false);
    await unmount(component);
  });
});

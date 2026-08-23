// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, unmount } from "svelte";
import SpellingCorrectionMenu from "./SpellingCorrectionMenu.svelte";
import type { ExperienceSpellingIssue } from "./controller.ts";

const issue: ExperienceSpellingIssue = {
  source: "paper-title",
  generation: 1,
  from: 0,
  to: 4,
  word: "wrng",
  termKey: "wrng",
  suggestions: ["wrong", "wring"],
};

const labels = {
  menu: "Spelling suggestions",
  noSuggestions: "No suggestions",
  ignoreOnce: "Ignore once",
  ignoreDocument: "Ignore in this document",
  addPersonal: "Add to personal dictionary",
  next: "Next spelling issue",
};

afterEach(() => document.body.replaceChildren());

describe("SpellingCorrectionMenu", () => {
  it("pins native suggestions, separators, and durable actions in accessible order", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(SpellingCorrectionMenu, {
      target,
      props: {
        issue,
        labels,
        canAddDictionary: true,
        canNext: false,
        onAction: vi.fn(),
        onClose: vi.fn(),
      },
    });
    await Promise.resolve();
    const menu = target.querySelector('[role="menu"]')!;
    expect(menu.getAttribute("aria-label")).toBe(labels.menu);
    expect(
      [...menu.querySelectorAll('[role="menuitem"]')].map((item) =>
        item.textContent?.trim()
      ),
    ).toEqual([
      "wrong",
      "wring",
      labels.ignoreOnce,
      labels.ignoreDocument,
      labels.addPersonal,
      labels.next,
    ]);
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(2);
    expect(
      menu.querySelectorAll('[role="menuitem"]')[5]?.getAttribute(
        "aria-disabled",
      ),
    )
      .toBe("true");
    await unmount(component);
  });

  it("keeps disabled rows arrow-focusable, wraps, activates enabled rows, and closes on Escape", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const onAction = vi.fn();
    const onClose = vi.fn();
    const component = mount(SpellingCorrectionMenu, {
      target,
      props: {
        issue: { ...issue, suggestions: [] },
        labels,
        canAddDictionary: false,
        canNext: false,
        onAction,
        onClose,
      },
    });
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const menu = target.querySelector<HTMLElement>('[role="menu"]')!;
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items[0]?.textContent?.trim()).toBe(labels.noSuggestions);
    expect(document.activeElement).toBe(items[1]);
    menu.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(document.activeElement).toBe(items[0]);
    menu.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(onAction).not.toHaveBeenCalled();
    menu.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
    menu.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    menu.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(onAction).toHaveBeenCalledWith({ type: "ignore-once" });
    menu.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(onClose).toHaveBeenCalledWith("restore");
    await unmount(component);
  });

  it("owns Tab navigation so the parent can advance focus after closing", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const onClose = vi.fn();
    const component = mount(SpellingCorrectionMenu, {
      target,
      props: {
        issue,
        labels,
        canAddDictionary: true,
        canNext: true,
        onAction: vi.fn(),
        onClose,
      },
    });
    await Promise.resolve();
    const menu = target.querySelector<HTMLElement>('[role="menu"]')!;
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    menu.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledWith("backward");
    await unmount(component);
  });
});

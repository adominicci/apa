// @vitest-environment jsdom

import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import ModalBehaviorHarness from "./ModalBehaviorHarness.test.svelte";

let component: ReturnType<typeof mount> | null = null;

function openHarness(mode: "release" | "protected" = "release") {
  const onClosed = vi.fn();
  component = mount(ModalBehaviorHarness, {
    target: document.body,
    props: { mode, onClosed },
  });
  flushSync();

  const opener = document.querySelector<HTMLButtonElement>(".exact-opener")!;
  opener.focus();
  opener.click();
  flushSync();

  return {
    dialog: document.querySelector<HTMLElement>("[role='dialog']")!,
    onClosed,
    opener,
  };
}

function pressTab(target: Element, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

function pressEscape(target: Element): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

afterEach(async () => {
  if (component) await unmount(component);
  component = null;
  document.body.replaceChildren();
});

describe("shared modal accessibility", () => {
  it("renders release-note Markdown semantically inside the modal", () => {
    openHarness();
    const body = document.querySelector<HTMLElement>(".modal-body")!;

    expect(body.querySelector("h4")?.textContent).toBe("Changed");
    expect(body.querySelector("h1, h2, h3")).toBeNull();
    expect(
      Array.from(body.querySelectorAll("li"), (item) => item.textContent),
    ).toEqual(["Formatted item", "Another item"]);
    expect(body.textContent).not.toContain("# Changed");
  });

  it("wraps Tab and Shift+Tab inside the release-note controls", () => {
    const { dialog } = openHarness();
    const close = dialog.querySelector<HTMLButtonElement>(".modal-close")!;
    const done = dialog.querySelector<HTMLButtonElement>(".btn-primary")!;

    expect(document.activeElement).toBe(dialog);
    expect(pressTab(dialog).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);

    expect(pressTab(close, true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(done);

    expect(pressTab(done).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
  });

  it("keeps focus on the dialog when no focusable descendant remains", () => {
    const { dialog } = openHarness();
    for (const button of dialog.querySelectorAll<HTMLButtonElement>("button")) {
      button.disabled = true;
    }
    dialog.focus();

    expect(pressTab(dialog).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialog);
  });

  it("inerts background content and restores exact prior attributes and opener focus", () => {
    const ordinary = document.createElement("div");
    ordinary.className = "outside-background";
    document.body.append(ordinary);

    const { dialog, opener } = openHarness();
    const inHarness = document.querySelector<HTMLElement>(
      ".ordinary-background",
    )!;
    const preexisting = document.querySelector<HTMLElement>(
      ".preexisting-background",
    )!;

    expect(inHarness.hasAttribute("inert")).toBe(true);
    expect(inHarness.getAttribute("aria-hidden")).toBe("true");
    expect(preexisting.hasAttribute("inert")).toBe(true);
    expect(preexisting.getAttribute("aria-hidden")).toBe("true");
    expect(ordinary.hasAttribute("inert")).toBe(true);
    expect(ordinary.getAttribute("aria-hidden")).toBe("true");

    dialog.querySelector<HTMLButtonElement>(".btn-primary")!.click();
    flushSync();

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(inHarness.hasAttribute("inert")).toBe(false);
    expect(inHarness.hasAttribute("aria-hidden")).toBe(false);
    expect(preexisting.hasAttribute("inert")).toBe(true);
    expect(preexisting.getAttribute("aria-hidden")).toBe("false");
    expect(ordinary.hasAttribute("inert")).toBe(false);
    expect(ordinary.hasAttribute("aria-hidden")).toBe(false);
  });

  it("retains configured overlay and Escape protection for another modal consumer", () => {
    const { dialog, onClosed } = openHarness("protected");
    const overlay = document.querySelector<HTMLElement>(".modal-overlay")!;

    overlay.click();
    flushSync();
    expect(document.querySelector("[role='dialog']")).toBe(dialog);
    expect(onClosed).not.toHaveBeenCalled();

    pressEscape(dialog);
    expect(document.querySelector("[role='dialog']")).toBe(dialog);
    expect(onClosed).not.toHaveBeenCalled();

    dialog.querySelector<HTMLButtonElement>(".modal-close")!.click();
    flushSync();
    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("keeps default Escape and overlay dismissal enabled for release notes", () => {
    const first = openHarness();
    pressEscape(first.dialog);
    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(first.onClosed).toHaveBeenCalledTimes(1);
  });

  it("keeps default overlay dismissal enabled for release notes", () => {
    const { onClosed } = openHarness();
    document.querySelector<HTMLElement>(".modal-overlay")!.click();
    flushSync();

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});

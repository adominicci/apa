// @vitest-environment jsdom

import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bundledReleaseNotes } from "$lib/update/bundledReleaseNotes";
import { createReleaseNotesController } from "$lib/update/releaseNotesController.svelte";
import UpdatePillHarness from "./UpdatePillHarness.test.svelte";

const runtime = vi.hoisted(() => ({
  updater: {
    status: "idle" as "idle" | "available" | "downloading" | "error",
    version: undefined as string | undefined,
    body: undefined as string | undefined,
    progress: 0,
    install: vi.fn(),
  },
}));

vi.mock("$lib/state/updater.svelte", () => ({
  updater: runtime.updater,
}));

vi.mock("$lib/state/uiLocale.svelte", () => ({
  uiLocale: {
    current: "en",
    theme: "system",
    loaded: true,
    flushPending: () => Promise.resolve(),
    setPersistenceDirtyNotifier: vi.fn(),
  },
}));

let component: ReturnType<typeof mount> | null = null;

async function readyController() {
  const controller = createReleaseNotesController({
    bundled: bundledReleaseNotes,
    getRuntimeVersion: () => Promise.resolve(bundledReleaseNotes.version),
    getStorage: () => null,
    unavailableBody: () => "Release notes unavailable.",
  });
  controller.setUiReady(true);
  await controller.resolveRuntimeVersion();
  return controller;
}

function mountPill(
  releaseNotesController?: ReturnType<typeof createReleaseNotesController>,
) {
  component = mount(UpdatePillHarness, {
    target: document.body,
    props: { releaseNotesController },
  });
  flushSync();
}

function pill(): HTMLElement | null {
  return document.querySelector("[data-update-pill]");
}

function pillButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(
    "[data-update-pill] button",
  );
}

function card(): HTMLElement | null {
  return document.querySelector("[data-update-card]");
}

function hoverPill() {
  pill()!.dispatchEvent(new MouseEvent("mouseenter"));
  flushSync();
}

beforeEach(() => {
  runtime.updater.status = "idle";
  runtime.updater.version = undefined;
  runtime.updater.body = undefined;
  runtime.updater.progress = 0;
  runtime.updater.install.mockReset();
});

afterEach(async () => {
  if (component) await unmount(component);
  component = null;
  document.body.replaceChildren();
});

describe("UpdatePill", () => {
  it("stays hidden while the updater is idle", async () => {
    mountPill(await readyController());
    expect(pill()).toBeNull();
  });

  it("offers the available update and installs on click", async () => {
    runtime.updater.status = "available";
    runtime.updater.version = "0.9.0";
    mountPill(await readyController());

    const button = pillButton();
    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-label")).toBe(
      "Version 0.9.0 is ready",
    );
    button!.click();
    expect(runtime.updater.install).toHaveBeenCalledTimes(1);
  });

  it("shows progress and blocks clicks while downloading", async () => {
    runtime.updater.status = "downloading";
    runtime.updater.progress = 42;
    mountPill(await readyController());

    const button = pillButton();
    expect(button!.disabled).toBe(true);
    expect(button!.getAttribute("aria-label")).toBe("Downloading… 42%");
    button!.click();
    expect(runtime.updater.install).not.toHaveBeenCalled();
  });

  it("offers a retry after a failed install", async () => {
    runtime.updater.status = "error";
    mountPill(await readyController());

    const button = pillButton();
    expect(button!.getAttribute("aria-label")).toBe("Update failed");
    button!.click();
    expect(runtime.updater.install).toHaveBeenCalledTimes(1);
  });

  it("reveals the release notes on hover", async () => {
    runtime.updater.status = "available";
    runtime.updater.version = "0.9.0";
    runtime.updater.body = "- The margins behave now.";
    mountPill(await readyController());

    expect(card()).toBeNull();
    hoverPill();

    expect(card()!.textContent).toContain("Version 0.9.0 is ready");
    expect(card()!.textContent).toContain("What's new");
    expect(card()!.textContent).toContain("The margins behave now.");
    expect(card()!.textContent).toContain(
      "Click to update & restart. Your work is saved first.",
    );

    pill()!.dispatchEvent(new MouseEvent("mouseleave"));
    flushSync();
    expect(card()).toBeNull();
  });

  it("stays hidden while release-note resolution is pending", () => {
    runtime.updater.status = "available";
    runtime.updater.version = "0.9.0";
    // A fresh controller has not resolved the runtime version yet.
    mountPill();
    expect(pill()).toBeNull();
  });

  it("stays hidden while the release-notes modal is open", async () => {
    runtime.updater.status = "available";
    runtime.updater.version = "0.9.0";
    const controller = await readyController();
    controller.openInstalledNotes();
    mountPill(controller);
    expect(pill()).toBeNull();
  });
});

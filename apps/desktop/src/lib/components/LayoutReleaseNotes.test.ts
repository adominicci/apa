// @vitest-environment jsdom

import { flushSync, mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readPendingReleaseNotes,
  savePendingReleaseNotes,
} from "$lib/update/releaseNotes";
import { bundledReleaseNotes } from "$lib/update/bundledReleaseNotes";
import LayoutReleaseNotesHarness from "./LayoutReleaseNotesHarness.test.svelte";

const canonicalNotesExcerpt = "Tesina on Windows now updates itself";

const runtime = vi.hoisted(() => ({
  getVersion: vi.fn<() => Promise<string>>(),
  updater: {
    status: "available",
    version: "0.3.0",
    progress: 0,
    install: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: runtime.getVersion,
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

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  runtime.getVersion.mockReset();
  runtime.updater.status = "available";
  runtime.updater.version = "0.3.0";
  runtime.updater.install.mockReset();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

afterEach(async () => {
  if (component) await unmount(component);
  component = null;
  document.body.replaceChildren();
  localStorage.clear();
});

describe("update and release-note precedence", () => {
  it("hides updater actions until pending notes resolve and while their modal is open", async () => {
    const version = deferred<string>();
    runtime.getVersion.mockReturnValue(version.promise);
    savePendingReleaseNotes(localStorage, {
      version: bundledReleaseNotes.version,
      body: "<script>Updater body must never render</script>",
    });

    component = mount(LayoutReleaseNotesHarness, { target: document.body });
    flushSync();

    expect(document.querySelector("[data-layout-child]")?.textContent).toBe(
      "Paper list",
    );
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.querySelector("[data-update-pill]")).toBeNull();

    version.resolve(bundledReleaseNotes.version);
    await tick();
    flushSync();

    expect(document.querySelector("[role='dialog']")).not.toBeNull();
    expect(document.querySelector("[data-update-pill]")).toBeNull();
    expect(document.querySelector(".markdown-content")?.textContent).toContain(
      canonicalNotesExcerpt,
    );
    expect(document.body.textContent).not.toContain(
      "Updater body must never render",
    );
  });

  it("preserves a newer marker on dismissal before exposing the updater", async () => {
    runtime.getVersion.mockResolvedValue(bundledReleaseNotes.version);
    savePendingReleaseNotes(localStorage, {
      version: bundledReleaseNotes.version,
      body: "Displayed update notes",
    });
    component = mount(LayoutReleaseNotesHarness, { target: document.body });
    await vi.waitFor(() => {
      expect(document.querySelector("[role='dialog']")).not.toBeNull();
    });

    savePendingReleaseNotes(localStorage, {
      version: "0.3.0",
      body: "Newly installed update notes",
    });
    document.querySelector<HTMLButtonElement>(".modal .btn-primary")!.click();
    flushSync();

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.querySelector("[data-update-pill]")).not.toBeNull();
    expect(readPendingReleaseNotes(localStorage)).toEqual({
      version: "0.3.0",
      body: "Newly installed update notes",
    });
  });

  it("exposes bundled installed notes through the layout context without storage", async () => {
    runtime.getVersion.mockRejectedValue(new Error("runtime unavailable"));
    component = mount(LayoutReleaseNotesHarness, { target: document.body });
    await vi.waitFor(() => {
      expect(
        document.querySelector<HTMLButtonElement>(
          "[data-open-installed-notes]",
        )?.textContent,
      ).toContain(`v${bundledReleaseNotes.version}`);
      expect(document.querySelector("[data-update-pill]")).not.toBeNull();
    });

    document.querySelector<HTMLButtonElement>(
      "[data-open-installed-notes]",
    )!.click();
    flushSync();

    expect(document.querySelector("[role='dialog']")).not.toBeNull();
    expect(document.querySelector(".markdown-content")?.textContent).toContain(
      canonicalNotesExcerpt,
    );
    expect(document.querySelector("[data-update-pill]")).toBeNull();
  });

  it("opens the packaged fallback while runtime lookup is still pending and gates automatic notes", async () => {
    const version = deferred<string>();
    runtime.getVersion.mockReturnValue(version.promise);
    savePendingReleaseNotes(localStorage, {
      version: bundledReleaseNotes.version,
      body: "Updater body",
    });
    component = mount(LayoutReleaseNotesHarness, { target: document.body });
    flushSync();

    expect(document.querySelector("[data-update-pill]")).toBeNull();
    document.querySelector<HTMLButtonElement>(
      "[data-open-installed-notes]",
    )!.click();
    flushSync();

    expect(document.querySelector(".markdown-content")?.textContent).toContain(
      canonicalNotesExcerpt,
    );
    expect(document.body.textContent).not.toContain("Updater body");
    expect(document.querySelector("[data-update-pill]")).toBeNull();

    version.resolve("0.3.0");
    await vi.waitFor(() => {
      expect(document.querySelector(".sub")?.textContent).toContain("0.3.0");
      expect(document.querySelector(".markdown-content")?.textContent)
        .toContain(
          "Release notes are not available for this installed version.",
        );
    });

    document.querySelector<HTMLButtonElement>(".modal .btn-primary")!.click();
    flushSync();
    expect(document.querySelector("[data-update-pill]")).not.toBeNull();
    expect(readPendingReleaseNotes(localStorage)?.version).toBe(
      bundledReleaseNotes.version,
    );
  });

  it("ignores stale markers and exposes the updater after resolution", async () => {
    runtime.getVersion.mockResolvedValue(bundledReleaseNotes.version);
    savePendingReleaseNotes(localStorage, {
      version: "0.1.1",
      body: "Stale updater body",
    });
    component = mount(LayoutReleaseNotesHarness, { target: document.body });

    await vi.waitFor(() => {
      expect(document.querySelector("[data-update-pill]")).not.toBeNull();
    });

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(readPendingReleaseNotes(localStorage)?.version).toBe("0.1.1");
  });

  it("shows the runtime version with unavailable copy on a package mismatch", async () => {
    runtime.getVersion.mockResolvedValue("0.3.0");
    component = mount(LayoutReleaseNotesHarness, { target: document.body });
    await vi.waitFor(() => {
      expect(
        document.querySelector<HTMLButtonElement>(
          "[data-open-installed-notes]",
        )?.textContent,
      ).toContain("v0.3.0");
    });

    document.querySelector<HTMLButtonElement>(
      "[data-open-installed-notes]",
    )!.click();
    flushSync();

    expect(document.querySelector(".sub")?.textContent).toContain(
      "0.3.0",
    );
    expect(document.querySelector(".markdown-content")?.textContent).toContain(
      "Release notes are not available for this installed version.",
    );
    expect(document.querySelector(".markdown-content")?.textContent).not
      .toContain(canonicalNotesExcerpt);
  });
});

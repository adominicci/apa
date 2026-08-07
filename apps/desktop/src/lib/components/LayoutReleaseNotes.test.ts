// @vitest-environment jsdom

import { flushSync, mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readPendingReleaseNotes,
  savePendingReleaseNotes,
} from "$lib/update/releaseNotes";
import LayoutReleaseNotesHarness from "./LayoutReleaseNotesHarness.test.svelte";

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
      version: "0.2.0",
      body: "Installed update notes",
    });

    component = mount(LayoutReleaseNotesHarness, { target: document.body });
    flushSync();

    expect(document.querySelector(".update-banner")).toBeNull();

    version.resolve("0.2.0");
    await tick();
    flushSync();

    expect(document.querySelector("[role='dialog']")).not.toBeNull();
    expect(document.querySelector(".update-banner")).toBeNull();
  });

  it("preserves a newer marker on dismissal before exposing the updater", async () => {
    runtime.getVersion.mockResolvedValue("0.2.0");
    savePendingReleaseNotes(localStorage, {
      version: "0.2.0",
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
    expect(document.querySelector(".update-banner")).not.toBeNull();
    expect(readPendingReleaseNotes(localStorage)).toEqual({
      version: "0.3.0",
      body: "Newly installed update notes",
    });
  });
});

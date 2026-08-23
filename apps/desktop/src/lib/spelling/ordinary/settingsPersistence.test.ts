import { beforeEach, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => {
  Object.defineProperty(globalThis, "$state", {
    configurable: true,
    value: Object.assign(<T>(initial: T): T => initial, {
      snapshot: <T>(value: T): T => value,
    }),
  });
  return {
    writeJsonAtomic: vi.fn(),
    readJson: vi.fn(),
  };
});

vi.mock("$lib/persist/atomic", () => ({
  readJson: runtime.readJson,
  writeJsonAtomicQuiet: runtime.writeJsonAtomic,
}));

vi.mock("$lib/paraglide/runtime", () => ({
  overwriteGetLocale: vi.fn(),
}));

import { UiSettingsStore } from "$lib/state/uiLocale.svelte";

async function drainMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

beforeEach(() => {
  runtime.readJson.mockReset();
  runtime.writeJsonAtomic.mockReset();
});

it("preserves inert spelling settings across an unrelated write and retry", async () => {
  const spelling = {
    enabled: false,
    personalDictionaries: { en: ["Tesina"], es: ["Café"] },
    futureProofField: { nested: ["unchanged", 42] },
  };
  runtime.readJson.mockResolvedValue({
    schemaVersion: 1,
    uiTheme: "light",
    spelling,
  });
  runtime.writeJsonAtomic
    .mockRejectedValueOnce(new Error("disk full"))
    .mockResolvedValue(undefined);

  const store = new UiSettingsStore();
  await store.load();
  expect(runtime.writeJsonAtomic).not.toHaveBeenCalled();

  store.setTheme("dark");
  await drainMicrotasks();
  await store.flushPending();

  expect(runtime.writeJsonAtomic).toHaveBeenCalledTimes(2);
  for (const [, payload] of runtime.writeJsonAtomic.mock.calls) {
    expect(payload).toMatchObject({ uiTheme: "dark", spelling });
  }
});

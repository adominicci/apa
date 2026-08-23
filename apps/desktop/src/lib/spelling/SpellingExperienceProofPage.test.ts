// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, unmount } from "svelte";
import type { SpellingService } from "./types.ts";
import SpellingExperienceProofPage from "./SpellingExperienceProofPage.svelte";

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
const asyncValue = <T>(value: T): Promise<T> => Promise.resolve(value);

afterEach(() => document.body.replaceChildren());

describe("fake-service editor spelling journey", () => {
  it("rechecks the shared title and body surface in the selected document language", async () => {
    const capability = vi.fn<SpellingService["capability"]>((
      language,
    ) =>
      asyncValue({
        status: "available",
        language,
        selectedLanguageTag: language,
      })
    );
    const service: SpellingService = {
      capability,
      check: (input) =>
        asyncValue({
          status: "completed",
          requestId: input.text,
          documentRevision: input.documentRevision,
          selectedLanguageTag: input.language,
          issues: [],
        }),
    };
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(SpellingExperienceProofPage, {
      target,
      props: { service },
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    const language = target.querySelector<HTMLSelectElement>("header select");
    expect(language).not.toBeNull();
    language!.value = "es";
    language!.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(capability).toHaveBeenLastCalledWith("es");
    await unmount(component);
  });

  it("publishes one atomic title/body batch and opens the shared keyboard menu", async () => {
    const service: SpellingService = {
      capability: (language) =>
        asyncValue({
          status: "available",
          language,
          selectedLanguageTag: language,
        }),
      check: (input) => {
        const word = input.text.includes("Wrng")
          ? "Wrng"
          : input.text.includes("sentnce")
          ? "sentnce"
          : null;
        const from = word ? input.text.indexOf(word) + input.documentStart : 0;
        return asyncValue({
          status: "completed",
          requestId: input.text,
          documentRevision: input.documentRevision,
          selectedLanguageTag: input.language,
          issues: word
            ? [{
              from,
              to: from + word.length,
              word,
              suggestions: [`${word}x`],
            }]
            : [],
        });
      },
    };
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(SpellingExperienceProofPage, {
      target,
      props: { service },
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(target.querySelector("[data-spelling-status]")?.textContent)
      .toContain("2");
    target.querySelector<HTMLInputElement>(".title-label input")?.focus();
    globalThis.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F7",
        altKey: true,
        bubbles: true,
      }),
    );
    await Promise.resolve();
    const menu = target.querySelector<HTMLElement>('[role="menu"]');
    expect(menu).not.toBeNull();
    menu!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    );
    await Promise.resolve();
    expect(document.activeElement).toBe(target.querySelector(".ProseMirror"));
    await unmount(component);
  });
});

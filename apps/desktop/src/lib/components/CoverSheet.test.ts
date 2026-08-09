// @vitest-environment jsdom

import { flushSync, mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import CoverSheetHarness from "./CoverSheetHarness.test.svelte";

let component: ReturnType<typeof mount> | undefined;

afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  document.body.replaceChildren();
});

async function typeField(
  field: HTMLInputElement,
  firstWord: string,
  rest: string,
): Promise<void> {
  field.value = `${firstWord} `;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
  await tick();

  expect(field.value).toBe(`${firstWord} `);

  field.value += rest;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
  await tick();
}

describe("CoverSheet inline fields", () => {
  it("shows derived page 1 as inert cover chrome", () => {
    component = mount(CoverSheetHarness, { target: document.body });
    flushSync();

    const number = document.querySelector<HTMLElement>(
      "[data-cover-page-number]",
    );
    expect(number?.textContent).toBe("1");
    expect(number?.contentEditable).toBe("false");
    expect(number?.getAttribute("aria-hidden")).toBe("true");
    expect(number?.tabIndex).toBe(-1);
  });

  it("keeps spaces while typing multi-word course and instructor values", async () => {
    component = mount(CoverSheetHarness, { target: document.body });
    flushSync();

    const [course, instructor] = document.querySelectorAll<HTMLInputElement>(
      "input.cf.line:not(.date)",
    );
    expect(course).toBeDefined();
    expect(instructor).toBeDefined();

    await typeField(course!, "EDU", "301: Foundations of Education");
    await typeField(instructor!, "Dr.", "Rivera");

    expect(course!.value).toBe("EDU 301: Foundations of Education");
    expect(instructor!.value).toBe("Dr. Rivera");
  });
});

// @vitest-environment jsdom

import { flushSync, mount, tick, unmount } from "svelte";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import Editor from "./Editor.svelte";
import EditorLaunchHarness from "./EditorLaunchHarness.test.svelte";

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const content = {
  type: "doc",
  content: [{
    type: "sectionBody",
    content: [{
      type: "paragraph",
      content: [{ type: "text", text: "Existing body" }],
    }],
  }],
};

const baseProps = {
  initialDoc: content,
  documentLanguage: "en" as const,
  citationEnv: { refsById: new Map(), locale: "en" as const },
  referenceEnv: {
    references: [],
    locale: "en" as const,
    emptyLabel: "No references yet",
  },
};

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

function mountForLaunch(
  newlyCreated: boolean,
  onLaunchConsumed: () => void,
) {
  let editor: TiptapEditor | undefined;
  const component = mount(Editor, {
    target: document.body,
    props: {
      ...baseProps,
      newlyCreated,
      onLaunchConsumed,
      onReady: (instance) => (editor = instance),
    },
  });
  flushSync();
  vi.runAllTimers();
  return { component, editor: editor! };
}

describe("one-shot new-paper launch", () => {
  it("does not recreate the editor when its parent consumes the flag", async () => {
    vi.useFakeTimers();
    const onLaunchConsumed = vi.fn();
    const onReady = vi.fn();
    const component = mount(EditorLaunchHarness, {
      target: document.body,
      props: { initialDoc: content, onLaunchConsumed, onReady },
    });

    flushSync();
    await tick();
    flushSync();
    vi.runAllTimers();

    expect(onLaunchConsumed).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0]![0].isFocused).toBe(false);
    await unmount(component);
  });

  it("consumes the flag after the first successful editor mount", async () => {
    vi.useFakeTimers();
    const onLaunchConsumed = vi.fn();

    const { component, editor } = await mountForLaunch(
      true,
      onLaunchConsumed,
    );

    expect(onLaunchConsumed).toHaveBeenCalledTimes(1);
    expect(editor.isFocused).toBe(false);
    await unmount(component);
  });

  it("treats preview recreation as an existing-paper mount", async () => {
    vi.useFakeTimers();
    let newlyCreated = true;
    const consume = vi.fn(() => (newlyCreated = false));
    const first = await mountForLaunch(newlyCreated, consume);
    await unmount(first.component);

    document.body.replaceChildren();
    const previewReturn = await mountForLaunch(newlyCreated, consume);

    expect(consume).toHaveBeenCalledTimes(1);
    expect(previewReturn.editor.isFocused).toBe(true);
    await unmount(previewReturn.component);
  });

  it("keeps locale-keyed remounts on consumed launch semantics", async () => {
    vi.useFakeTimers();
    let newlyCreated = true;
    const consume = vi.fn(() => (newlyCreated = false));
    const firstLocale = await mountForLaunch(newlyCreated, consume);
    await unmount(firstLocale.component);

    document.body.replaceChildren();
    const secondLocale = await mountForLaunch(newlyCreated, consume);

    expect(newlyCreated).toBe(false);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(secondLocale.editor.isFocused).toBe(true);
    await unmount(secondLocale.component);
  });
});

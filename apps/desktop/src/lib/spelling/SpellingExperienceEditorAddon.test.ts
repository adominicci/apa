// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, unmount } from "svelte";
import { createTesinaEditor } from "$lib/editor/createEditor";
import { createEmptyEssay } from "$lib/model/essay";
import type { SpellingService } from "./types.ts";
import SpellingExperienceEditorAddon from "./SpellingExperienceEditorAddon.svelte";

const settings = vi.hoisted(() => ({
  spellingEnabled: true,
  personalDictionaries: { en: [] as string[], es: [] as string[] },
  setSpellingEnabled: vi.fn((enabled: boolean) => {
    settings.spellingEnabled = enabled;
  }),
  addPersonalDictionaryTerm: vi.fn(() => "added" as const),
  setPersonalDictionary: vi.fn((language: "en" | "es", terms: string[]) => {
    settings.personalDictionaries[language] = [...terms];
    return true;
  }),
  clearPersonalDictionary: vi.fn((language: "en" | "es") => {
    settings.personalDictionaries[language] = [];
  }),
}));

vi.mock("$lib/state/uiLocale.svelte", () => ({ uiLocale: settings }));

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

function createEditor(text = "This sentnce is editable.") {
  const element = document.createElement("div");
  document.body.append(element);
  return createTesinaEditor({
    element,
    content: {
      type: "doc",
      content: [{
        type: "sectionBody",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      }],
    },
    newlyCreated: true,
    citationEnv: { refsById: new Map(), locale: "en" },
    referenceEnv: { references: [], locale: "en", emptyLabel: "None" },
    paginationEnv: null,
  });
}

function fakeService(): SpellingService {
  return {
    capability: vi.fn((language) =>
      Promise.resolve({
        status: "available" as const,
        language,
        selectedLanguageTag: language,
      })
    ),
    check: vi.fn((input) => {
      const word = input.text.includes("Wrng")
        ? "Wrng"
        : input.text.includes("sentnce")
        ? "sentnce"
        : null;
      const from = word ? input.text.indexOf(word) + input.documentStart : 0;
      return Promise.resolve({
        status: "completed" as const,
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
    }),
  };
}

beforeEach(() => {
  settings.spellingEnabled = true;
  settings.personalDictionaries = { en: [], es: [] };
  vi.clearAllMocks();
});

afterEach(() => document.body.replaceChildren());

describe("real EditorScreen spelling addon", () => {
  it("honors persisted disabled state before the first native request", async () => {
    settings.spellingEnabled = false;
    const editor = createEditor();
    const titleInput = document.createElement("input");
    titleInput.value = "Wrng title";
    document.body.append(titleInput);
    const service = fakeService();
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(SpellingExperienceEditorAddon, {
      target,
      props: {
        essay: createEmptyEssay("en"),
        editor,
        titleInput,
        title: titleInput.value,
        doc: editor.getJSON(),
        documentLanguage: "en",
        onTitleChange: vi.fn(),
        onEssayMutation: vi.fn(),
        onOpenTitleForm: vi.fn(),
        service,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(service.capability).not.toHaveBeenCalled();
    await unmount(component);
    editor.destroy();
  });

  it("uses the actual editor/title seams, closes stale menus, and persists verified document ignores", async () => {
    const editor = createEditor();
    const titleInput = document.createElement("input");
    titleInput.value = "Wrng title";
    document.body.append(titleInput);
    const essay = createEmptyEssay("en");
    essay.titlePage.title = titleInput.value;
    essay.content = editor.getJSON();
    const onEssayMutation = vi.fn();
    const service = fakeService();
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(SpellingExperienceEditorAddon, {
      target,
      props: {
        essay,
        editor,
        titleInput,
        title: titleInput.value,
        doc: editor.getJSON(),
        documentLanguage: "en",
        onTitleChange: vi.fn(),
        onEssayMutation,
        onOpenTitleForm: vi.fn(),
        service,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(target.querySelector("[data-spelling-status]")?.textContent)
      .toContain("2");

    titleInput.setSelectionRange(4, 4);
    const boundary = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    titleInput.dispatchEvent(boundary);
    await Promise.resolve();
    expect(boundary.defaultPrevented).toBe(false);
    expect(target.querySelector('[role="menu"]')).toBeNull();

    titleInput.setSelectionRange(2, 2);
    titleInput.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
    expect(target.querySelector('[role="menu"]')).not.toBeNull();
    target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[1]!.click();
    await Promise.resolve();
    expect(document.activeElement).toBe(titleInput);
    expect([titleInput.selectionStart, titleInput.selectionEnd]).toEqual([
      0,
      4,
    ]);
    expect(target.querySelector('[role="menu"]')).toBeNull();

    titleInput.value = "Changed title";
    titleInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
    titleInput.value = "Wrng title";
    titleInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 350));
    titleInput.setSelectionRange(2, 2);
    titleInput.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
    expect(target.querySelector('[role="menu"]')).not.toBeNull();
    titleInput.value = "Changed title";
    titleInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await Promise.resolve();
    expect(target.querySelector('[role="menu"]')).toBeNull();
    expect(onEssayMutation).not.toHaveBeenCalled();

    titleInput.value = "Wrng title";
    titleInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 350));
    titleInput.focus();
    globalThis.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F7", altKey: true, bubbles: true }),
    );
    await Promise.resolve();
    const items = target.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    );
    items[2]!.click();
    await Promise.resolve();
    expect(essay.spelling?.documentIgnores?.en).toEqual(["Wrng"]);
    expect(onEssayMutation).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(titleInput);
    expect([titleInput.selectionStart, titleInput.selectionEnd]).toEqual([
      0,
      4,
    ]);
    expect(target.querySelector('[role="menu"]')).toBeNull();

    await unmount(component);
    editor.destroy();
  });

  it("edits and clears both device dictionaries, opens the real title form seam, and tears down per essay", async () => {
    const editor = createEditor("Clean body");
    const titleInput = document.createElement("input");
    titleInput.value = "Clean title";
    document.body.append(titleInput);
    const onOpenTitleForm = vi.fn();
    const service = fakeService();
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(SpellingExperienceEditorAddon, {
      target,
      props: {
        essay: createEmptyEssay("en"),
        editor,
        titleInput,
        title: titleInput.value,
        doc: editor.getJSON(),
        documentLanguage: "en",
        onTitleChange: vi.fn(),
        onEssayMutation: vi.fn(),
        onOpenTitleForm,
        service,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 350));

    target.querySelector<HTMLButtonElement>(".spelling-proof-row button")!
      .click();
    expect(onOpenTitleForm).toHaveBeenCalledOnce();
    const english = target.querySelector<HTMLTextAreaElement>(
      '[data-spelling-dictionary="en"]',
    )!;
    english.value = "Alpha\nBeta";
    english.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const callsBeforeSave = vi.mocked(service.capability).mock.calls.length;
    target.querySelector<HTMLButtonElement>('[data-spelling-save="en"]')!
      .click();
    expect(settings.setPersonalDictionary).toHaveBeenCalledWith("en", [
      "Alpha",
      "Beta",
    ]);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(vi.mocked(service.capability).mock.calls.length).toBeGreaterThan(
      callsBeforeSave,
    );
    target.querySelector<HTMLButtonElement>('[data-spelling-clear="es"]')!
      .click();
    expect(settings.clearPersonalDictionary).toHaveBeenCalledWith("es");

    const callsBeforeUnmount = vi.mocked(service.capability).mock.calls.length;
    await unmount(component);
    editor.commands.insertContentAt(2, "changed ");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(service.capability).toHaveBeenCalledTimes(callsBeforeUnmount);
    editor.destroy();
  });
});

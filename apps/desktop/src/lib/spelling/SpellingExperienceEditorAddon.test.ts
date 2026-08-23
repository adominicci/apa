// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, unmount } from "svelte";
import { createTesinaEditor } from "$lib/editor/createEditor";
import { createEmptyEssay } from "$lib/model/essay";
import type { SpellingService } from "./types.ts";
import SpellingExperienceEditorAddon from "./SpellingExperienceEditorAddon.svelte";
import SpellingExperienceTitleHarness from "./SpellingExperienceTitleHarness.test.svelte";

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
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  font: "",
  measureText: (text: string) => ({ width: text.length * 10 }),
})) as never;

function createEditor(
  text = "This sentnce is editable.",
  container: HTMLElement = document.body,
) {
  const element = document.createElement("div");
  container.append(element);
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

function twoTitleIssueService(dropSecondOnRecheck = false): SpellingService {
  let titleChecks = 0;
  return {
    capability: vi.fn((language) =>
      Promise.resolve({
        status: "available" as const,
        language,
        selectedLanguageTag: language,
      })
    ),
    check: vi.fn((input) => {
      const titleChunk = input.text === "Frst Scnd";
      if (titleChunk) titleChecks += 1;
      const issues = titleChunk
        ? [
          {
            from: input.documentStart,
            to: input.documentStart + 4,
            word: "Frst",
            suggestions: ["First"],
          },
          ...(dropSecondOnRecheck && titleChecks > 1 ? [] : [{
            from: input.documentStart + 5,
            to: input.documentStart + 9,
            word: "Scnd",
            suggestions: ["Second"],
          }]),
        ]
        : [];
      return Promise.resolve({
        status: "completed" as const,
        requestId: input.text,
        documentRevision: input.documentRevision,
        selectedLanguageTag: input.language,
        issues,
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
        titleFormOpen: false,
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
    titleInput.getBoundingClientRect = () => new DOMRect(0, 0, 200, 24);
    document.body.append(titleInput);
    const essay = createEmptyEssay("en");
    essay.titlePage.title = titleInput.value;
    essay.content = editor.getJSON();
    const onEssayMutation = vi.fn();
    const onOpenTitleForm = vi.fn();
    const service = fakeService();
    const target = document.createElement("div");
    target.className = "app";
    target.setAttribute("inert", "");
    document.body.append(target);
    const component = mount(SpellingExperienceEditorAddon, {
      target,
      props: {
        essay,
        editor,
        titleInput,
        titleFormOpen: false,
        title: titleInput.value,
        doc: editor.getJSON(),
        documentLanguage: "en",
        onTitleChange: vi.fn(),
        onEssayMutation,
        onOpenTitleForm,
        service,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(target.querySelector("[data-spelling-status]")?.textContent)
      .toContain("2");
    expect(titleInput.classList.contains("tesina-spelling-title-issue")).toBe(
      true,
    );
    expect(titleInput.getAttribute("aria-invalid")).toBe("spelling");
    expect(titleInput.getAttribute("data-spelling-indicator")).toBe(
      "misspelled",
    );

    titleInput.setSelectionRange(2, 2);
    const boundary = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 80,
      clientY: 12,
    });
    titleInput.dispatchEvent(boundary);
    await Promise.resolve();
    expect(boundary.defaultPrevented).toBe(false);
    expect(document.querySelector('[role="menu"]')).toBeNull();

    titleInput.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 12,
      }),
    );
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const firstMenu = document.querySelector<HTMLElement>('[role="menu"]')!;
    const firstItems = document.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    );
    expect(firstMenu.closest(".app")).toBeNull();
    expect(firstMenu.closest("[inert]")).toBeNull();
    expect(document.activeElement).toBe(firstItems[0]);
    firstItems[1]!.click();
    await Promise.resolve();
    expect(document.activeElement).toBe(titleInput);
    expect([titleInput.selectionStart, titleInput.selectionEnd]).toEqual([
      0,
      4,
    ]);
    expect(document.querySelector('[role="menu"]')).toBeNull();

    titleInput.value = "Changed title";
    titleInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
    titleInput.value = "Wrng title";
    titleInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 350));
    titleInput.setSelectionRange(2, 2);
    titleInput.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 12,
      }),
    );
    await Promise.resolve();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    titleInput.value = "Changed title";
    titleInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await Promise.resolve();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(onEssayMutation).not.toHaveBeenCalled();

    titleInput.value = "Wrng title";
    titleInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 350));
    titleInput.focus();
    globalThis.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F7", altKey: true, bubbles: true }),
    );
    await Promise.resolve();
    expect(onOpenTitleForm).toHaveBeenCalledOnce();
    titleInput.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 12,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const items = document.querySelectorAll<HTMLButtonElement>(
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
    expect(document.querySelector('[role="menu"]')).toBeNull();

    await unmount(component);
    editor.destroy();
  });

  it("closes stale replacement menus and restores safe source selections without changing data", async () => {
    const titleEditor = createEditor("Clean body");
    const titleInput = document.createElement("input");
    titleInput.value = "Wrng title";
    titleInput.getBoundingClientRect = () => new DOMRect(0, 0, 200, 24);
    document.body.append(titleInput);
    const titleTarget = document.createElement("div");
    document.body.append(titleTarget);
    const titleComponent = mount(SpellingExperienceEditorAddon, {
      target: titleTarget,
      props: {
        essay: createEmptyEssay("en"),
        editor: titleEditor,
        titleInput,
        titleFormOpen: true,
        title: titleInput.value,
        doc: titleEditor.getJSON(),
        documentLanguage: "en",
        onTitleChange: vi.fn(),
        onEssayMutation: vi.fn(),
        onOpenTitleForm: vi.fn(),
        service: fakeService(),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    titleInput.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 12,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const staleTitleSuggestion = document.querySelector<HTMLButtonElement>(
      '[role="menuitem"]',
    )!;
    titleInput.value = "Abcd title";
    staleTitleSuggestion.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(titleInput.value).toBe("Abcd title");
    expect(document.activeElement).toBe(titleInput);
    expect([titleInput.selectionStart, titleInput.selectionEnd]).toEqual([
      0,
      4,
    ]);
    await unmount(titleComponent);
    titleEditor.destroy();

    const bodyEditor = createEditor();
    const cleanTitleInput = document.createElement("input");
    cleanTitleInput.value = "Clean title";
    document.body.append(cleanTitleInput);
    const bodyTarget = document.createElement("div");
    document.body.append(bodyTarget);
    const bodyComponent = mount(SpellingExperienceEditorAddon, {
      target: bodyTarget,
      props: {
        essay: createEmptyEssay("en"),
        editor: bodyEditor,
        titleInput: cleanTitleInput,
        titleFormOpen: false,
        title: cleanTitleInput.value,
        doc: bodyEditor.getJSON(),
        documentLanguage: "en",
        onTitleChange: vi.fn(),
        onEssayMutation: vi.fn(),
        onOpenTitleForm: vi.fn(),
        service: fakeService(),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    bodyEditor.view.dom.focus();
    bodyEditor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F7", altKey: true, bubbles: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const { from, to } = bodyEditor.state.selection;
    const staleBodySuggestion = document.querySelector<HTMLButtonElement>(
      '[role="menuitem"]',
    )!;
    bodyEditor.view.updateState(
      bodyEditor.state.apply(
        bodyEditor.state.tr.insertText("altered", from, to),
      ),
    );
    staleBodySuggestion.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(bodyEditor.getText()).toContain("altered");
    expect(document.activeElement).toBe(bodyEditor.view.dom);
    expect([bodyEditor.state.selection.from, bodyEditor.state.selection.to])
      .toEqual([from, to]);
    await unmount(bodyComponent);
    bodyEditor.destroy();
  });

  it("edits and clears both device dictionaries, opens the real title form seam, and tears down per essay", async () => {
    settings.personalDictionaries = { en: ["OldEnglish"], es: ["Viejo"] };
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
        titleFormOpen: false,
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
    english.value = " Cafe\u0301 \nCAFÉ\nBeta";
    english.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const callsBeforeSave = vi.mocked(service.capability).mock.calls.length;
    target.querySelector<HTMLButtonElement>('[data-spelling-save="en"]')!
      .click();
    expect(settings.setPersonalDictionary).toHaveBeenCalledWith("en", [
      "Cafe\u0301",
      "CAFÉ",
      "Beta",
    ]);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(vi.mocked(service.capability).mock.calls.length).toBeGreaterThan(
      callsBeforeSave,
    );
    for (const language of ["en", "es"] as const) {
      const textarea = target.querySelector<HTMLTextAreaElement>(
        `[data-spelling-dictionary="${language}"]`,
      )!;
      target.querySelector<HTMLButtonElement>(
        `[data-spelling-clear="${language}"]`,
      )!.click();
      await Promise.resolve();
      expect(textarea.value).toBe("");
      target.querySelector<HTMLButtonElement>(
        `[data-spelling-save="${language}"]`,
      )!.click();
      expect(settings.setPersonalDictionary).toHaveBeenCalledWith(language, []);
    }

    const callsBeforeUnmount = vi.mocked(service.capability).mock.calls.length;
    await unmount(component);
    editor.commands.insertContentAt(2, "changed ");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(service.capability).toHaveBeenCalledTimes(callsBeforeUnmount);
    editor.destroy();
  });

  it("disables adding a new current-language term at dictionary capacity", async () => {
    settings.personalDictionaries.en = Array.from(
      { length: 256 },
      (_, index) => `term${index}`,
    );
    const editor = createEditor("Clean body");
    const titleInput = document.createElement("input");
    titleInput.value = "Wrng title";
    titleInput.getBoundingClientRect = () => new DOMRect(0, 0, 200, 24);
    document.body.append(titleInput);
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(SpellingExperienceEditorAddon, {
      target,
      props: {
        essay: createEmptyEssay("en"),
        editor,
        titleInput,
        titleFormOpen: false,
        title: titleInput.value,
        doc: editor.getJSON(),
        documentLanguage: "en",
        onTitleChange: vi.fn(),
        onEssayMutation: vi.fn(),
        onOpenTitleForm: vi.fn(),
        service: fakeService(),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    titleInput.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 12,
      }),
    );
    await Promise.resolve();
    const addPersonal = document.querySelectorAll<HTMLElement>(
      '[role="menuitem"]',
    )[3]!;
    expect(addPersonal.getAttribute("aria-disabled")).toBe("true");
    await unmount(component);
    editor.destroy();
  });

  it("invalidates a discarded title-form draft and rechecks the canonical cover title", async () => {
    const editor = createEditor("Clean body");
    const essay = createEmptyEssay("en");
    essay.titlePage.title = "Wrng title";
    const service = fakeService();
    const component = mount(SpellingExperienceTitleHarness, {
      target: document.body,
      props: { essay, editor, service },
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    const checksBeforeOpen = vi.mocked(service.check).mock.calls.length;
    const coverInput = document.querySelector<HTMLInputElement>(
      '[data-title-owner="cover"]',
    )!;
    coverInput.focus();
    globalThis.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F7",
        altKey: true,
        bubbles: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    const formInput = document.querySelector<HTMLInputElement>(
      '[data-title-owner="form"]',
    )!;
    expect(formInput).not.toBeNull();
    expect(vi.mocked(service.check).mock.calls.length).toBeGreaterThan(
      checksBeforeOpen,
    );
    const app = document.querySelector<HTMLElement>(".app")!;
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(app.hasAttribute("inert")).toBe(true);
    expect(menu.closest(".app")).toBeNull();
    expect(menu.closest("[inert]")).toBeNull();
    expect(document.activeElement).toBe(
      menu.querySelector('[role="menuitem"]'),
    );
    formInput.getBoundingClientRect = () => new DOMRect(0, 0, 200, 24);
    formInput.value = "Discarded clean draft";
    const checksBeforeClose = vi.mocked(service.check).mock.calls.length;
    document.querySelector<HTMLButtonElement>("[data-close-title]")!.click();
    await Promise.resolve();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(vi.mocked(service.check).mock.calls.length).toBeGreaterThan(
      checksBeforeClose,
    );
    expect(document.querySelector("[data-spelling-status]")?.textContent)
      .toContain("1");
    await unmount(component);
    editor.destroy();
  });

  it.each([
    [false, "[data-close-title]"],
    [true, ".modal-close"],
  ])(
    "restores title selection and moves %s from the portaled modal menu",
    async (shiftKey, expectedTarget) => {
      const editor = createEditor("Clean body");
      const essay = createEmptyEssay("en");
      essay.titlePage.title = "Wrng title";
      const component = mount(SpellingExperienceTitleHarness, {
        target: document.body,
        props: { essay, editor, service: fakeService() },
      });
      await new Promise((resolve) => setTimeout(resolve, 350));
      const coverInput = document.querySelector<HTMLInputElement>(
        '[data-title-owner="cover"]',
      )!;
      coverInput.focus();
      globalThis.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "F7",
          altKey: true,
          bubbles: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 350));
      const formInput = document.querySelector<HTMLInputElement>(
        '[data-title-owner="form"]',
      )!;
      const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
      menu.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect([formInput.selectionStart, formInput.selectionEnd]).toEqual([
        0,
        4,
      ]);
      expect(document.activeElement).toBe(
        document.querySelector(expectedTarget),
      );
      await unmount(component);
      editor.destroy();
    },
  );

  it("retains the requested second title issue across form-open reanalysis", async () => {
    const editor = createEditor("Clean body");
    const essay = createEmptyEssay("en");
    essay.titlePage.title = "Frst Scnd";
    const component = mount(SpellingExperienceTitleHarness, {
      target: document.body,
      props: { essay, editor, service: twoTitleIssueService() },
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    const coverInput = document.querySelector<HTMLInputElement>(
      '[data-title-owner="cover"]',
    )!;
    coverInput.getBoundingClientRect = () => new DOMRect(0, 0, 200, 24);
    coverInput.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 12,
      }),
    );
    await Promise.resolve();
    document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
      .item(4).click();
    await new Promise((resolve) => setTimeout(resolve, 350));
    const formInput = document.querySelector<HTMLInputElement>(
      '[data-title-owner="form"]',
    )!;
    expect([formInput.selectionStart, formInput.selectionEnd]).toEqual([5, 9]);
    expect(
      document.querySelector('[role="menuitem"]')?.textContent?.trim(),
    ).toBe("Second");
    await unmount(component);
    editor.destroy();
  });

  it("closes safely when the requested title issue is stale after reanalysis", async () => {
    const editor = createEditor("Clean body");
    const essay = createEmptyEssay("en");
    essay.titlePage.title = "Frst Scnd";
    const component = mount(SpellingExperienceTitleHarness, {
      target: document.body,
      props: {
        essay,
        editor,
        service: twoTitleIssueService(true),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    const coverInput = document.querySelector<HTMLInputElement>(
      '[data-title-owner="cover"]',
    )!;
    coverInput.getBoundingClientRect = () => new DOMRect(0, 0, 200, 24);
    coverInput.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 12,
      }),
    );
    await Promise.resolve();
    document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
      .item(4).click();
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(document.querySelector('[data-title-owner="form"]')).not.toBeNull();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await unmount(component);
    editor.destroy();
  });

  it.each([
    [false, "after"],
    [true, "before"],
  ])(
    "restores body selection and moves %s in the app owner",
    async (shiftKey, expectedTarget) => {
      const app = document.createElement("div");
      app.className = "app";
      document.body.append(app);
      const before = document.createElement("button");
      before.dataset.bodyAdjacent = "before";
      app.append(before);
      const editor = createEditor("This sentnce is editable.", app);
      const after = document.createElement("button");
      after.dataset.bodyAdjacent = "after";
      app.append(after);
      const titleInput = document.createElement("input");
      titleInput.value = "Clean title";
      app.append(titleInput);
      const target = document.createElement("div");
      app.append(target);
      const component = mount(SpellingExperienceEditorAddon, {
        target,
        props: {
          essay: createEmptyEssay("en"),
          editor,
          titleInput,
          titleFormOpen: false,
          title: titleInput.value,
          doc: editor.getJSON(),
          documentLanguage: "en",
          onTitleChange: vi.fn(),
          onEssayMutation: vi.fn(),
          onOpenTitleForm: vi.fn(),
          service: fakeService(),
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 350));
      editor.view.dom.focus();
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "F7",
          altKey: true,
          bubbles: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      const expectedSelection = {
        from: editor.state.selection.from,
        to: editor.state.selection.to,
      };
      document.querySelector<HTMLElement>('[role="menu"]')!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
      expect({
        from: editor.state.selection.from,
        to: editor.state.selection.to,
      }).toEqual(expectedSelection);
      expect(document.activeElement).toBe(
        document.querySelector(`[data-body-adjacent="${expectedTarget}"]`),
      );
      await unmount(component);
      editor.destroy();
    },
  );
});

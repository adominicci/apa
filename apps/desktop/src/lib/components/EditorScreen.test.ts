// @vitest-environment jsdom

import { flushSync, mount, tick, unmount } from "svelte";
import type { Content, Editor as TiptapEditor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Essay } from "$lib/model/essay";
import EditorScreen from "./EditorScreen.svelte";

const runtime = vi.hoisted(() => ({
  editors: [] as TiptapEditor[],
  persist: vi.fn(),
  persistedDocs: [] as unknown[],
}));

vi.mock("$lib/editor/createEditor", async () => {
  const actual = await vi.importActual<
    typeof import("$lib/editor/createEditor")
  >("$lib/editor/createEditor");
  return {
    ...actual,
    createTesinaEditor(
      args: Parameters<typeof actual.createTesinaEditor>[0],
    ) {
      const editor = actual.createTesinaEditor(args);
      runtime.editors.push(editor);
      return editor;
    },
  };
});

vi.mock("$lib/state/essays.svelte", () => ({
  essays: { persist: runtime.persist },
}));

vi.mock("$lib/state/library.svelte", () => ({
  library: {
    references: [],
    byId: () => new Map(),
    add: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("$lib/state/uiLocale.svelte", () => ({
  uiLocale: {
    current: "es",
    theme: "system",
    dock: "bottom",
    cycleTheme: vi.fn(),
    setDock: vi.fn(),
  },
}));

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

function bodyDoc(text: string): Content {
  return {
    type: "doc",
    content: [{
      type: "sectionBody",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text }],
      }],
    }],
  };
}

function docText(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";
  const node = doc as { text?: string; content?: unknown[] };
  return [node.text ?? "", ...(node.content ?? []).map(docText)].join("");
}

function essayWithBody(text: string): Essay {
  return {
    schemaVersion: 2,
    id: "preview-round-trip",
    createdAt: "2026-08-07T12:00:00.000Z",
    updatedAt: "2026-08-07T12:00:00.000Z",
    settings: {
      documentLanguage: "en",
      variant: "student",
      font: "times-new-roman-12",
      paperSize: "us-letter",
      includeUncitedReferences: false,
    },
    titlePage: {
      title: "Preview round trip",
      authors: ["Alex Rivera"],
      affiliations: ["Example University"],
    },
    content: bodyDoc(text),
    referencesSnapshot: [],
  };
}

afterEach(() => {
  vi.useRealTimers();
  runtime.editors = [];
  runtime.persist.mockReset();
  runtime.persistedDocs = [];
  document.body.replaceChildren();
});

describe("editor preview round trip", () => {
  it("keeps rapid edits visible and persists both sides of a preview toggle", async () => {
    vi.useFakeTimers();
    runtime.persist.mockImplementation((essay: Essay) => {
      runtime.persistedDocs.push(JSON.parse(JSON.stringify(essay.content)));
    });
    const essay = essayWithBody("Seed");
    const component = mount(EditorScreen, {
      target: document.body,
      props: {
        essay,
        newlyCreated: false,
        onLaunchConsumed: vi.fn(),
        onBack: vi.fn(),
        onOpenLibrary: vi.fn(),
      },
    });
    flushSync();

    expect(runtime.editors).toHaveLength(1);
    runtime.editors[0]!.commands.setContent(bodyDoc("First edit"));
    flushSync();
    expect(document.querySelector(".ProseMirror")?.textContent).toContain(
      "First edit",
    );

    const previewButton = document.querySelector<HTMLButtonElement>(
      ".tb-actions button:nth-child(3)",
    );
    expect(previewButton).not.toBeNull();
    previewButton!.click();
    flushSync();
    expect(document.querySelector(".ProseMirror")).toBeNull();
    expect(runtime.persist).not.toHaveBeenCalled();

    previewButton!.click();
    flushSync();
    await tick();
    expect(runtime.editors).toHaveLength(2);
    expect(document.querySelector(".ProseMirror")?.textContent).toContain(
      "First edit",
    );

    runtime.editors[1]!.chain().focus("end").insertContent(" Second edit")
      .run();
    flushSync();
    expect(document.querySelector(".ProseMirror")?.textContent).toContain(
      "First edit Second edit",
    );

    await vi.advanceTimersByTimeAsync(500);

    expect(runtime.persistedDocs).toHaveLength(1);
    expect(docText(runtime.persistedDocs[0])).toContain(
      "First edit Second edit",
    );
    await unmount(component);
  });
});

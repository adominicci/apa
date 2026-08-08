// @vitest-environment jsdom

import { flushSync, mount, tick, unmount } from "svelte";
import type { Content, Editor as TiptapEditor } from "@tiptap/core";
import { exportDocx } from "@tesina/docx-export";
import type { Reference } from "@tesina/engine";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Essay } from "$lib/model/essay";
import { m } from "$lib/paraglide/messages";
import { persistence } from "$lib/persist/coordinator";
import { createCloseRequestHandler } from "$lib/persist/windowClose";
import { UpdaterStore } from "$lib/state/updater.svelte";
import {
  readPendingReleaseNotes,
  type ReleaseNotesStorage,
} from "$lib/update/releaseNotes";
import EditorScreen from "./EditorScreen.svelte";

const runtime = vi.hoisted(() => ({
  editors: [] as TiptapEditor[],
  persist: vi.fn(),
  persistedDocs: [] as unknown[],
  libraryReferences: [] as Reference[],
  exportEssayToDocx: vi.fn(),
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

async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

class MemoryStorage implements ReleaseNotesStorage {
  #values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

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
    get references() {
      return runtime.libraryReferences;
    },
    byId: () => new Map(runtime.libraryReferences.map((ref) => [ref.id, ref])),
    add: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("$lib/export/exportEssay", () => ({
  exportEssayToDocx: runtime.exportEssayToDocx,
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

function authoredBodyTitleDoc(title: string): Content {
  return {
    type: "doc",
    content: [{
      type: "sectionBody",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: title }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Editable authored opening" }],
        },
      ],
    }],
  };
}

function citationDoc(refId: string): Content {
  return {
    type: "doc",
    content: [{
      type: "sectionBody",
      content: [{
        type: "paragraph",
        content: [{
          type: "citation",
          attrs: {
            mode: "parenthetical",
            items: [{ refId }],
          },
        }],
      }],
    }],
  };
}

function reference(
  id: string,
  title = "Evidence-based teaching",
): Reference {
  return {
    id,
    type: "website",
    authors: [{ kind: "person", family: "Rivera", given: "Alex" }],
    date: { year: 2026 },
    title,
    siteName: "Teaching Lab",
    url: `https://example.test/${id}`,
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

function exportableEssay(content: Content): Essay {
  const essay = essayWithBody("Seed");
  essay.content = content;
  essay.titlePage = {
    ...essay.titlePage,
    course: "EDU 301: Foundations of Education",
    instructor: "Dr. Rivera",
    dueDate: "2026-08-07",
  };
  return essay;
}

function exportButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    '.fm-primary-action[aria-label="Exportar"]',
  );
  if (!button) throw new Error("Export button not found");
  return button;
}

afterEach(() => {
  vi.useRealTimers();
  runtime.editors = [];
  runtime.persist.mockReset();
  runtime.persistedDocs = [];
  runtime.libraryReferences = [];
  runtime.exportEssayToDocx.mockReset();
  runtime.exportEssayToDocx.mockResolvedValue({ status: "cancelled" });
  document.body.replaceChildren();
});

describe("editor preview round trip", () => {
  it("suppresses only the pseudo body title for a matching authored H1", async () => {
    const essay = essayWithBody("Seed");
    essay.titlePage.title = "Legacy Body Title";
    essay.content = authoredBodyTitleDoc(essay.titlePage.title);
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

    try {
      flushSync();
      await tick();
      const sheetStack = document.querySelector<HTMLElement>(".sheet-stack");
      const authoredHeading = document.querySelector<HTMLHeadingElement>(
        ".ProseMirror .sec-body > h1",
      );

      expect(sheetStack?.style.getPropertyValue("--body-title")).toBe("none");
      expect(authoredHeading?.textContent).toBe("Legacy Body Title");
      expect(runtime.editors[0]?.getJSON()).toEqual(essay.content);
    } finally {
      await unmount(component);
    }
  });

  it("keeps close pending until an edit made during the active write is persisted", async () => {
    vi.useFakeTimers();
    const firstWrite = deferred<void>();
    runtime.persist
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValueOnce(undefined);
    const component = mount(EditorScreen, {
      target: document.body,
      props: {
        essay: essayWithBody("Seed"),
        newlyCreated: false,
        onLaunchConsumed: vi.fn(),
        onBack: vi.fn(),
        onOpenLibrary: vi.fn(),
      },
    });
    flushSync();

    runtime.editors[0]!.commands.setContent(bodyDoc("First close edit"));
    const destroy = vi.fn<() => Promise<void>>().mockResolvedValue();
    const close = createCloseRequestHandler({
      flushPending: () => persistence.flushPending(),
      destroy,
      onError: vi.fn(),
    });
    const closing = close({ preventDefault: vi.fn() });
    await drainMicrotasks();
    expect(runtime.persist).toHaveBeenCalledOnce();

    runtime.editors[0]!.commands.setContent(bodyDoc("Edit during write"));
    firstWrite.resolve();
    try {
      await closing;
      expect(runtime.persist).toHaveBeenCalledTimes(2);
      expect(docText(runtime.persist.mock.calls[1]![0].content)).toContain(
        "Edit during write",
      );
      expect(destroy).toHaveBeenCalledOnce();
    } finally {
      await unmount(component);
    }
  });

  it("does not queue the current revision twice when autosave is in flight", async () => {
    vi.useFakeTimers();
    const writing = deferred<void>();
    runtime.persist.mockReturnValueOnce(writing.promise);
    const component = mount(EditorScreen, {
      target: document.body,
      props: {
        essay: essayWithBody("Seed"),
        newlyCreated: false,
        onLaunchConsumed: vi.fn(),
        onBack: vi.fn(),
        onOpenLibrary: vi.fn(),
      },
    });
    flushSync();

    runtime.editors[0]!.commands.setContent(bodyDoc("One revision"));
    await vi.advanceTimersByTimeAsync(500);
    const flushing = persistence.flushPending();
    expect(runtime.persist).toHaveBeenCalledOnce();

    writing.resolve();
    try {
      await flushing;
      expect(runtime.persist).toHaveBeenCalledOnce();
    } finally {
      await unmount(component);
    }
  });

  it("retries a transient editor flush without a new edit before updater relaunch", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(
      () => {},
    );
    runtime.persist
      .mockRejectedValueOnce(new Error("temporary disk failure"))
      .mockResolvedValueOnce(undefined);
    const storage = new MemoryStorage();
    let relaunches = 0;
    const updater = new UpdaterStore({
      check: () =>
        Promise.resolve({
          version: "0.2.0",
          body: "Retry-safe persistence",
          downloadAndInstall: () => Promise.resolve(),
        }),
      flushPending: () => persistence.flushPending(),
      storage: () => storage,
      relaunch: () => {
        relaunches += 1;
        return Promise.resolve();
      },
    });
    const component = mount(EditorScreen, {
      target: document.body,
      props: {
        essay: essayWithBody("Seed"),
        newlyCreated: false,
        onLaunchConsumed: vi.fn(),
        onBack: vi.fn(),
        onOpenLibrary: vi.fn(),
      },
    });
    flushSync();
    runtime.editors[0]!.commands.setContent(bodyDoc("Retry this edit"));
    await updater.check();

    try {
      await updater.install();
      expect(updater.status).toBe("error");
      expect(readPendingReleaseNotes(storage)).toBeNull();
      expect(relaunches).toBe(0);

      await updater.install();
      expect(readPendingReleaseNotes(storage)).toEqual({
        version: "0.2.0",
        body: "Retry-safe persistence",
      });
      expect(relaunches).toBe(1);
      expect(runtime.persist).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
      await unmount(component);
    }
  });

  it("shares one persistence barrier between native close and updater relaunch", async () => {
    vi.useFakeTimers();
    const writing = deferred<void>();
    runtime.persist.mockReturnValueOnce(writing.promise);
    const storage = new MemoryStorage();
    const destroy = vi.fn<() => Promise<void>>().mockResolvedValue();
    const relaunch = vi.fn<() => Promise<void>>().mockResolvedValue();
    const updater = new UpdaterStore({
      check: () =>
        Promise.resolve({
          version: "0.2.0",
          body: "Shared barrier",
          downloadAndInstall: () => Promise.resolve(),
        }),
      flushPending: () => persistence.flushPending(),
      storage: () => storage,
      relaunch,
    });
    const component = mount(EditorScreen, {
      target: document.body,
      props: {
        essay: essayWithBody("Seed"),
        newlyCreated: false,
        onLaunchConsumed: vi.fn(),
        onBack: vi.fn(),
        onOpenLibrary: vi.fn(),
      },
    });
    flushSync();
    runtime.editors[0]!.commands.setContent(bodyDoc("Shared close edit"));
    await updater.check();
    const close = createCloseRequestHandler({
      flushPending: () => persistence.flushPending(),
      destroy,
      onError: vi.fn(),
    });

    const closing = close({ preventDefault: vi.fn() });
    const installing = updater.install();
    await drainMicrotasks();
    expect(runtime.persist).toHaveBeenCalledOnce();

    writing.resolve();
    await Promise.all([closing, installing]);
    expect(runtime.persist).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
    await unmount(component);
  });

  it("flushes the latest edit before an app close inside the debounce window", async () => {
    vi.useFakeTimers();
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

    runtime.editors[0]!.commands.setContent(bodyDoc("Close-safe edit"));
    flushSync();
    const destroy = vi.fn<() => Promise<void>>().mockResolvedValue();
    const close = createCloseRequestHandler({
      flushPending: () => persistence.flushPending(),
      destroy,
      onError: vi.fn(),
    });
    const preventDefault = vi.fn();

    await close({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(runtime.persist).toHaveBeenCalledOnce();
    expect(docText(runtime.persist.mock.calls[0]![0].content)).toContain(
      "Close-safe edit",
    );
    expect(destroy).toHaveBeenCalledOnce();
    await unmount(component);
  });

  it("serializes rapid edits so an older write cannot commit last", async () => {
    vi.useFakeTimers();
    const firstWrite = deferred<void>();
    const committed: string[] = [];
    runtime.persist.mockImplementation((saved: Essay) => {
      const text = docText(saved.content);
      if (runtime.persist.mock.calls.length === 1) {
        return firstWrite.promise.then(() => {
          committed.push(text);
        });
      }
      committed.push(text);
      return Promise.resolve();
    });
    const component = mount(EditorScreen, {
      target: document.body,
      props: {
        essay: essayWithBody("Seed"),
        newlyCreated: false,
        onLaunchConsumed: vi.fn(),
        onBack: vi.fn(),
        onOpenLibrary: vi.fn(),
      },
    });
    flushSync();

    runtime.editors[0]!.commands.setContent(bodyDoc("Older edit"));
    await vi.advanceTimersByTimeAsync(500);
    runtime.editors[0]!.commands.setContent(bodyDoc("Newest edit"));
    await vi.advanceTimersByTimeAsync(500);

    expect(runtime.persist).toHaveBeenCalledOnce();
    firstWrite.resolve();
    await vi.waitFor(() => expect(runtime.persist).toHaveBeenCalledTimes(2));
    expect(committed).toEqual(["Older edit", "Newest edit"]);
    await unmount(component);
  });

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

describe("APA export title-page gate", () => {
  it("shows a live validation error and resumes the export after a fixing save", async () => {
    const essay = exportableEssay(bodyDoc("Seed"));
    essay.titlePage.course = "PSYC 232"; // no colon → blocked
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

    exportButton().click();
    await vi.waitFor(() => {
      expect(document.querySelector(".modal [role='alert']")).not.toBeNull();
    });
    expect(runtime.exportEssayToDocx).not.toHaveBeenCalled();
    expect(document.querySelector(".modal [role='alert']")?.textContent).toBe(
      m.titlepage_error_missing_course(),
    );

    const courseInput = document.querySelector<HTMLInputElement>(
      `input[placeholder="${m.titlepage_course_placeholder()}"]`,
    );
    if (!courseInput) throw new Error("Course input not found");
    courseInput.value = "PSYC 232: Desarrollo humano";
    courseInput.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(document.querySelector(".modal [role='alert']")).toBeNull();

    const saveButton = [
      ...document.querySelectorAll<HTMLButtonElement>(".modal .btn-primary"),
    ].find((button) => button.textContent === m.titlepage_save());
    if (!saveButton) throw new Error("Save button not found");
    saveButton.click();
    await vi.waitFor(() => {
      expect(runtime.exportEssayToDocx).toHaveBeenCalledOnce();
    });
    expect(document.querySelector(".modal")).toBeNull();

    await unmount(component);
  });
});

describe("APA export reference integrity", () => {
  it("preserves a newly cited reference deleted during the autosave debounce", async () => {
    vi.useFakeTimers();
    const cited = reference("deleted-before-autosave");
    runtime.libraryReferences = [cited];
    runtime.persist.mockResolvedValue(undefined);
    const essay = exportableEssay(bodyDoc("Seed"));
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

    runtime.editors[0]!.commands.setContent(citationDoc(cited.id));
    flushSync();
    runtime.libraryReferences = [];

    await vi.advanceTimersByTimeAsync(500);

    expect(runtime.persist).toHaveBeenCalledOnce();
    const persisted = runtime.persist.mock.calls[0]![0] as Essay;
    expect(persisted.referencesSnapshot).toEqual([cited]);

    exportButton().click();
    await vi.waitFor(() => {
      expect(runtime.exportEssayToDocx).toHaveBeenCalledOnce();
    });
    expect(runtime.exportEssayToDocx.mock.calls[0]![2]).toEqual([cited]);

    await unmount(component);
  });

  it("exports a cited snapshot fallback without a missing citation marker", async () => {
    const cited = reference("deleted-ref");
    const essay = exportableEssay(citationDoc(cited.id));
    essay.referencesSnapshot = [cited];

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

    exportButton().click();
    await vi.waitFor(() => {
      expect(runtime.exportEssayToDocx).toHaveBeenCalledOnce();
    });

    const [exportedEssay, exportedDocument, exportedReferences] = runtime
      .exportEssayToDocx.mock.calls[0] as [Essay, Content, Reference[]];
    expect(exportedReferences).toEqual([cited]);

    const bytes = await exportDocx({
      content: exportedDocument,
      settings: {
        documentLanguage: exportedEssay.settings.documentLanguage,
        variant: exportedEssay.settings.variant,
        font: exportedEssay.settings.font,
        paperSize: exportedEssay.settings.paperSize,
      },
      titlePage: exportedEssay.titlePage,
      references: exportedReferences,
    });
    const xml = strFromU8(unzipSync(bytes)["word/document.xml"]!);
    expect(xml).toContain("Rivera");
    expect(xml).toContain("Evidence-based teaching");
    expect(xml).not.toContain("???");

    await unmount(component);
  });

  it("blocks an unresolved citation before export and shows the localized error", async () => {
    const essay = exportableEssay(citationDoc("gone-for-good"));
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

    exportButton().click();
    await tick();

    expect(runtime.exportEssayToDocx).not.toHaveBeenCalled();
    expect(document.querySelector(".export-msg")?.textContent).toContain(
      "Este trabajo cita una referencia que ya no está disponible",
    );
    expect(
      m.editor_export_missing_references(undefined, { locale: "en" }),
    ).toContain(
      "This paper cites a reference that is no longer available",
    );
    expect(
      m.editor_export_missing_references(undefined, { locale: "es" }),
    ).toContain(
      "Este trabajo cita una referencia que ya no está disponible",
    );

    await unmount(component);
  });

  it("includes uncited live references once and prefers live cited data", async () => {
    const liveCited = reference("cited-ref", "Current live title");
    const staleSnapshot = reference("cited-ref", "Stale snapshot title");
    const uncited = reference("uncited-ref", "Uncited title");
    runtime.libraryReferences = [uncited, liveCited];
    const essay = exportableEssay(citationDoc(liveCited.id));
    essay.settings.includeUncitedReferences = true;
    essay.referencesSnapshot = [staleSnapshot, liveCited];

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

    exportButton().click();
    await vi.waitFor(() => {
      expect(runtime.exportEssayToDocx).toHaveBeenCalledOnce();
    });

    const references = runtime.exportEssayToDocx.mock
      .calls[0]![2] as Reference[];
    expect(references.map((ref) => ref.id).sort()).toEqual([
      "cited-ref",
      "uncited-ref",
    ]);
    expect(references.find((ref) => ref.id === "cited-ref")?.title).toBe(
      "Current live title",
    );

    await unmount(component);
  });
});

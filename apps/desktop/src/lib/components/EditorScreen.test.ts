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
import { createQuitRequest } from "$lib/persist/windowClose";
import { UpdaterStore } from "$lib/state/updater.svelte";
import {
  readPendingReleaseNotes,
  type ReleaseNotesStorage,
} from "$lib/update/releaseNotes";
import { bundledReleaseNotes } from "$lib/update/bundledReleaseNotes";
import { createReleaseNotesController } from "$lib/update/releaseNotesController.svelte";
import EditorScreen from "./EditorScreenReleaseNotesHarness.test.svelte";
import type {
  PaginationEnvironment,
  StablePaginationPlan,
} from "$lib/editor/pagination/types";

const runtime = vi.hoisted(() => ({
  editors: [] as TiptapEditor[],
  persist: vi.fn(),
  persistedDocs: [] as unknown[],
  libraryReferences: [] as Reference[],
  exportEssayToDocx: vi.fn(),
  exportEssayToPdf: vi.fn(),
  paginationEnvs: [] as PaginationEnvironment[],
  paginationInvalidations: [] as string[],
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
      if (args.paginationEnv) runtime.paginationEnvs.push(args.paginationEnv);
      const editor = actual.createTesinaEditor({
        ...args,
        // jsdom has no layout engine; the lifecycle contract is exercised by
        // driving the captured production environment below.
        paginationEnv: null,
      });
      runtime.editors.push(editor);
      return editor;
    },
  };
});

vi.mock("$lib/editor/pagination/extension", async () => {
  const actual = await vi.importActual<
    typeof import("$lib/editor/pagination/extension")
  >("$lib/editor/pagination/extension");
  return {
    ...actual,
    invalidatePagination(
      editor: Parameters<typeof actual.invalidatePagination>[0],
      reason: Parameters<typeof actual.invalidatePagination>[1],
    ) {
      runtime.paginationInvalidations.push(reason);
      return actual.invalidatePagination(editor, reason);
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

vi.mock("$lib/export/exportEssay", async () => {
  const actual = await vi.importActual<
    typeof import("$lib/export/exportEssay")
  >(
    "$lib/export/exportEssay",
  );
  return { ...actual, exportEssayToDocx: runtime.exportEssayToDocx };
});

vi.mock("$lib/export/exportPdf", () => ({
  exportEssayToPdf: runtime.exportEssayToPdf,
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

/**
 * The persistence barrier these tests exercise lives in the quit request; the
 * native close button only routes to it. Confirmation is pre-answered and the
 * deadline never elapses, so each test measures the flush alone.
 */
function quitRequest(
  flushPending: () => Promise<void>,
  exitApp: () => Promise<void>,
): () => Promise<void> {
  return createQuitRequest({
    flushPending,
    exitApp,
    confirmQuit: () => Promise.resolve(true),
    confirmQuitWithoutSaving: () => Promise.resolve(false),
    onError: vi.fn(),
    delay: () => new Promise<void>(() => {}),
  });
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

/** Opens the export menu and picks a format, as a user must. */
function exportAs(format: "docx" | "pdf"): void {
  exportButton().click();
  flushSync();
  const label = format === "pdf"
    ? m.editor_export_pdf()
    : m.editor_export_docx();
  const item = [
    ...document.querySelectorAll<HTMLButtonElement>(".export-menu button"),
  ].find((button) => button.textContent?.trim() === label);
  if (!item) throw new Error(`Export menu item not found: ${label}`);
  item.click();
  flushSync();
}

afterEach(() => {
  vi.useRealTimers();
  runtime.editors = [];
  runtime.persist.mockReset();
  runtime.persistedDocs = [];
  runtime.libraryReferences = [];
  runtime.exportEssayToDocx.mockReset();
  runtime.exportEssayToDocx.mockResolvedValue({ status: "cancelled" });
  runtime.exportEssayToPdf.mockReset();
  runtime.exportEssayToPdf.mockResolvedValue({ status: "cancelled" });
  runtime.paginationEnvs = [];
  runtime.paginationInvalidations = [];
  document.body.replaceChildren();
});

describe("editor preview round trip", () => {
  it("shows a native installed-version button beside APA 7 in the status bar", async () => {
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

    const versionButton = document.querySelector<HTMLButtonElement>(
      ".statusbar button[data-release-notes-version]",
    );
    expect(versionButton).not.toBeNull();
    expect(versionButton?.type).toBe("button");
    expect(versionButton?.textContent).toBe(
      `v${bundledReleaseNotes.version}`,
    );
    expect(versionButton?.title).toBe(
      `Novedades de Tesina ${bundledReleaseNotes.version}`,
    );
    expect(versionButton?.getAttribute("aria-label")).toBe(
      `Abrir las notas de Tesina ${bundledReleaseNotes.version}`,
    );
    expect(versionButton?.previousElementSibling?.textContent).toBe("APA 7");

    document.querySelector<HTMLButtonElement>(
      `.fm-btn[aria-label="${m.fab_focus()}"]`,
    )!.click();
    flushSync();
    expect(document.querySelector(".statusbar")?.classList).toContain("dim");
    expect(versionButton?.isConnected).toBe(true);
    await unmount(component);
  });

  it("opens the canonical installed notes from the editor without changing the essay", async () => {
    const essay = essayWithBody("Canonical-note identity");
    const before = structuredClone(essay);
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

    const authoredJson = JSON.stringify(runtime.editors[0]!.getJSON());
    const versionButton = document.querySelector<HTMLButtonElement>(
      ".statusbar button[data-release-notes-version]",
    )!;
    expect(versionButton.type).toBe("button");
    versionButton.focus();
    versionButton.click();
    flushSync();

    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    expect(dialog?.textContent).toContain(
      `Tesina ${bundledReleaseNotes.version}`,
    );
    expect(dialog?.textContent).toContain(
      "checks your APA format while you write",
    );
    document.querySelector<HTMLButtonElement>(".modal .btn-primary")!.click();
    flushSync();
    expect(document.activeElement).toBe(versionButton);
    expect(JSON.stringify(runtime.editors[0]!.getJSON())).toBe(authoredJson);
    expect(essay).toEqual(before);
    await unmount(component);
  });

  it("opens mismatch-safe notes and returns focus without navigation or essay mutation", async () => {
    const releaseNotesController = createReleaseNotesController({
      bundled: bundledReleaseNotes,
      getRuntimeVersion: () => Promise.resolve("9.8.7"),
      getStorage: () => null,
      unavailableBody: () =>
        "Las notas no están disponibles para esta versión.",
    });
    releaseNotesController.setUiReady(true);
    await releaseNotesController.resolveRuntimeVersion();
    const essay = essayWithBody("Identity-safe body");
    const essayBefore = structuredClone(essay);
    const onBack = vi.fn();
    const onOpenLibrary = vi.fn();
    const initialLocation = globalThis.location.href;
    const component = mount(EditorScreen, {
      target: document.body,
      props: {
        essay,
        newlyCreated: false,
        onLaunchConsumed: vi.fn(),
        onBack,
        onOpenLibrary,
        releaseNotesController,
      },
    });
    flushSync();
    const authoredJson = JSON.stringify(runtime.editors[0]!.getJSON());

    const versionButton = document.querySelector<HTMLButtonElement>(
      ".statusbar button[data-release-notes-version]",
    )!;
    expect(versionButton.textContent).toBe("v9.8.7");
    expect(versionButton.title).toBe("Novedades de Tesina 9.8.7");
    versionButton.focus();
    versionButton.click();
    flushSync();

    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    expect(dialog?.textContent).toContain("Tesina 9.8.7");
    expect(dialog?.textContent).toContain(
      "Las notas no están disponibles para esta versión.",
    );
    expect(dialog?.textContent).not.toContain(
      "checks your APA format while you write",
    );
    globalThis.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    expect(dialog?.contains(document.activeElement)).toBe(true);

    document.querySelector<HTMLButtonElement>(".modal .btn-primary")!.click();
    flushSync();
    expect(document.activeElement).toBe(versionButton);

    versionButton.click();
    flushSync();
    expect(document.querySelector("[role='dialog']")?.textContent).toContain(
      "Las notas no están disponibles para esta versión.",
    );
    expect(JSON.stringify(runtime.editors[0]!.getJSON())).toBe(authoredJson);
    expect(essay).toEqual(essayBefore);
    expect(globalThis.location.href).toBe(initialLocation);
    expect(onBack).not.toHaveBeenCalled();
    expect(onOpenLibrary).not.toHaveBeenCalled();
    await unmount(component);
  });

  it("shows localized live pagination lifecycle without a words-based estimate", async () => {
    const component = mount(EditorScreen, {
      target: document.body,
      props: {
        essay: essayWithBody("Seed ".repeat(900)),
        newlyCreated: false,
        onLaunchConsumed: vi.fn(),
        onBack: vi.fn(),
        onOpenLibrary: vi.fn(),
      },
    });
    flushSync();
    await tick();

    const pageStatus = () =>
      document.querySelector<HTMLElement>("[data-live-page-status]")
        ?.textContent?.trim();
    expect(pageStatus()).toBe(m.status_pages_pending());
    expect(pageStatus()).not.toBe(m.status_pages_many({ count: 4 }));

    const environment = runtime.paginationEnvs[0]!;
    environment.onPageCount?.({
      status: "fallback",
      epoch: 1,
      reason: "canonical-layout",
      pageCount: null,
      visiblePlan: null,
      lastStablePlan: null,
    });
    flushSync();
    expect(pageStatus()).toBe(m.status_pages_unavailable());

    const plan: StablePaginationPlan = {
      status: "stable",
      epoch: 2,
      pageStarts: [
        { pageIndex: 0, pos: 1, section: "body", kind: "section" },
        { pageIndex: 1, pos: 20, section: "body", kind: "line" },
      ],
      pageGaps: [],
      tableRowStarts: [],
      overflows: [],
      pageCount: {
        authored: 2,
        references: 1,
        total: 3,
        bySection: { abstract: 0, body: 2, appendix: 0, references: 1 },
      },
    };
    environment.onPageCount?.({
      status: "stable",
      epoch: 2,
      reason: "authored-content",
      pageCount: plan.pageCount,
      visiblePlan: plan,
      lastStablePlan: plan,
    });
    flushSync();
    expect(pageStatus()).toBe(m.status_pages_many({ count: 4 }));

    runtime.editors[0]!.commands.insertContentAt(2, "Page-growing edit ");
    const editedJson = JSON.stringify(runtime.editors[0]!.getJSON());
    expect(editedJson).toContain("Page-growing edit");
    const expandedPlan: StablePaginationPlan = {
      ...plan,
      epoch: 3,
      pageStarts: [
        ...plan.pageStarts,
        { pageIndex: 2, pos: 30, section: "body", kind: "line" },
      ],
      pageCount: {
        authored: 3,
        references: 1,
        total: 4,
        bySection: { abstract: 0, body: 3, appendix: 0, references: 1 },
      },
    };
    environment.onPageCount?.({
      status: "settling",
      epoch: 3,
      reason: "authored-content",
      pageCount: plan.pageCount,
      visiblePlan: plan,
      lastStablePlan: plan,
    });
    flushSync();
    expect(pageStatus()).toBe(m.status_pages_many({ count: 4 }));
    environment.onPageCount?.({
      status: "stable",
      epoch: 3,
      reason: "authored-content",
      pageCount: expandedPlan.pageCount,
      visiblePlan: expandedPlan,
      lastStablePlan: expandedPlan,
    });
    flushSync();
    expect(pageStatus()).toBe(m.status_pages_many({ count: 5 }));

    environment.onPageCount?.({
      status: "settling",
      epoch: 4,
      reason: "font",
      pageCount: expandedPlan.pageCount,
      visiblePlan: expandedPlan,
      lastStablePlan: expandedPlan,
    });
    flushSync();
    expect(pageStatus()).toBe(m.status_pages_many({ count: 5 }));

    const previewButton = document.querySelector<HTMLButtonElement>(
      ".tb-actions button:nth-child(3)",
    )!;
    previewButton.click();
    flushSync();
    expect(pageStatus()).toBe(m.status_pages_many({ count: 5 }));
    previewButton.click();
    flushSync();
    expect(pageStatus()).toBe(m.status_pages_many({ count: 5 }));

    const outer = document.querySelector<HTMLElement>(".paper-scale-outer");
    const inner = document.querySelector<HTMLElement>(".paper-scale-inner");
    expect(outer?.style.width).toBe("816px");
    expect(inner?.style.width).toBe("816px");
    expect(inner?.style.transform).toBe("scale(1)");
    await unmount(component);
  });

  it("fits narrow and wide canvases without repaginating for panel or focus changes", async () => {
    let availableWidth = 612;
    const observerCallbacks: Array<() => void> = [];
    const originalResizeObserver = globalThis.ResizeObserver;
    const clientWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth",
    );
    const scrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        observerCallbacks.push(() => callback([], this));
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: TestResizeObserver,
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return this.classList.contains("paper-fit-viewport")
          ? availableWidth
          : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return this.classList.contains("paper-scale-inner") ? 2112 : 0;
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
    try {
      flushSync();
      expect(
        document.querySelector<HTMLElement>(".paper-scale-inner")?.style
          .transform,
      ).toBe("scale(0.75)");
      expect(
        document.querySelector<HTMLElement>(".paper-scale-outer")?.style
          .height,
      ).toBe("1584px");
      expect(
        document.querySelector<HTMLButtonElement>(
          ".statusbar button[data-release-notes-version]",
        )?.type,
      ).toBe("button");

      availableWidth = 816;
      document.querySelector<HTMLButtonElement>(
        ".tb-actions button:nth-child(2)",
      )!.click();
      observerCallbacks.forEach((callback) => callback());
      flushSync();
      expect(
        document.querySelector<HTMLElement>(".paper-scale-inner")?.style
          .transform,
      ).toBe("scale(1)");

      document.querySelector<HTMLButtonElement>(
        `.fm-btn[aria-label="${m.fab_focus()}"]`,
      )!.click();
      flushSync();
      expect(runtime.paginationInvalidations).toEqual([]);
    } finally {
      await unmount(component);
      if (originalResizeObserver) {
        Object.defineProperty(globalThis, "ResizeObserver", {
          configurable: true,
          value: originalResizeObserver,
        });
      } else {
        Reflect.deleteProperty(globalThis, "ResizeObserver");
      }
      if (clientWidth) {
        Object.defineProperty(
          HTMLElement.prototype,
          "clientWidth",
          clientWidth,
        );
      }
      if (scrollHeight) {
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollHeight",
          scrollHeight,
        );
      }
    }
  });

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

  it("repaginates after a cover-title edit updates the generated body heading", async () => {
    const essay = essayWithBody("Seed");
    essay.titlePage.title = "Short title";
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
      runtime.paginationInvalidations = [];

      const title = document.querySelector<HTMLInputElement>(
        ".cover-sheet input.cf.title",
      );
      expect(title).not.toBeNull();
      title!.value =
        "A substantially longer generated body title that wraps onto several lines";
      title!.dispatchEvent(new Event("input", { bubbles: true }));
      flushSync();
      await tick();
      await drainMicrotasks();

      expect(
        document.querySelector<HTMLElement>(".sheet-stack")?.style
          .getPropertyValue("--body-title"),
      ).toContain("substantially longer generated body title");
      expect(runtime.paginationInvalidations).toEqual(["canonical-layout"]);
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
    const close = quitRequest(() => persistence.flushPending(), destroy);
    const closing = close();
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
    const close = quitRequest(() => persistence.flushPending(), destroy);

    const closing = close();
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
    const close = quitRequest(() => persistence.flushPending(), destroy);
    await close();

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

describe("APA export title-page advice", () => {
  /** Mounts an essay whose course lacks the colon APA asks for. */
  function mountIncompleteTitlePage() {
    const essay = exportableEssay(bodyDoc("Seed"));
    essay.titlePage.course = "PSYC 232"; // no colon → APA shortfall
    return mount(EditorScreen, {
      target: document.body,
      props: {
        essay,
        newlyCreated: false,
        onLaunchConsumed: vi.fn(),
        onBack: vi.fn(),
        onOpenLibrary: vi.fn(),
      },
    });
  }

  function dialogButton(label: string): HTMLButtonElement {
    const button = [
      ...document.querySelectorAll<HTMLButtonElement>(".modal .btn"),
    ].find((candidate) => candidate.textContent?.trim() === label);
    if (!button) throw new Error(`Button not found: ${label}`);
    return button;
  }

  async function waitForAdvice() {
    await vi.waitFor(() => {
      expect(document.querySelector(".modal .status-panel[data-tone='warn']"))
        .not.toBeNull();
    });
  }

  it("exports an APA-complete title page without raising advice", async () => {
    const component = mount(EditorScreen, {
      target: document.body,
      props: {
        essay: exportableEssay(bodyDoc("Seed")),
        newlyCreated: false,
        onLaunchConsumed: vi.fn(),
        onBack: vi.fn(),
        onOpenLibrary: vi.fn(),
      },
    });
    flushSync();

    exportAs("docx");
    await vi.waitFor(() => {
      expect(runtime.exportEssayToDocx).toHaveBeenCalledOnce();
    });
    expect(document.querySelector(".modal")).toBeNull();

    await unmount(component);
  });

  it("advises instead of blocking, then exports on confirmation", async () => {
    const component = mountIncompleteTitlePage();
    flushSync();

    exportAs("docx");
    await waitForAdvice();
    expect(runtime.exportEssayToDocx).not.toHaveBeenCalled();
    expect(document.querySelector(".modal .warn-list")?.textContent).toContain(
      m.titlepage_warn_missing_course(),
    );

    dialogButton(m.export_warn_anyway()).click();
    await vi.waitFor(() => {
      expect(runtime.exportEssayToDocx).toHaveBeenCalledOnce();
    });
    expect(document.querySelector(".modal")).toBeNull();

    await unmount(component);
  });

  it("resumes the export after the advice is acted on and saved", async () => {
    const component = mountIncompleteTitlePage();
    flushSync();

    exportAs("docx");
    await waitForAdvice();
    dialogButton(m.export_warn_fix()).click();
    flushSync();

    const courseInput = document.querySelector<HTMLInputElement>(
      `input[placeholder="${m.titlepage_course_placeholder()}"]`,
    );
    if (!courseInput) throw new Error("Course input not found");
    courseInput.value = "PSYC 232: Desarrollo humano";
    courseInput.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    // The live list empties as the draft satisfies APA.
    expect(document.querySelector(".modal .warn-list")).toBeNull();

    dialogButton(m.titlepage_save()).click();
    await vi.waitFor(() => {
      expect(runtime.exportEssayToDocx).toHaveBeenCalledOnce();
    });
    expect(document.querySelector(".modal")).toBeNull();

    await unmount(component);
  });

  it("routes PDF through its own exporter and leaves DOCX untouched", async () => {
    const component = mount(EditorScreen, {
      target: document.body,
      props: {
        essay: exportableEssay(bodyDoc("Seed")),
        newlyCreated: false,
        onLaunchConsumed: vi.fn(),
        onBack: vi.fn(),
        onOpenLibrary: vi.fn(),
      },
    });
    flushSync();

    exportAs("pdf");
    await vi.waitFor(() => {
      expect(runtime.exportEssayToPdf).toHaveBeenCalledOnce();
    });
    expect(runtime.exportEssayToDocx).not.toHaveBeenCalled();

    await unmount(component);
  });

  it("keeps the PDF format through the advice dialog", async () => {
    const component = mountIncompleteTitlePage();
    flushSync();

    exportAs("pdf");
    await waitForAdvice();
    expect(runtime.exportEssayToPdf).not.toHaveBeenCalled();

    // Confirming must honour the format chosen before the advice appeared,
    // not silently fall back to the default.
    dialogButton(m.export_warn_anyway()).click();
    await vi.waitFor(() => {
      expect(runtime.exportEssayToPdf).toHaveBeenCalledOnce();
    });
    expect(runtime.exportEssayToDocx).not.toHaveBeenCalled();

    await unmount(component);
  });

  it("keeps the PDF format across a fix-the-title-page detour", async () => {
    const component = mountIncompleteTitlePage();
    flushSync();

    exportAs("pdf");
    await waitForAdvice();
    dialogButton(m.export_warn_fix()).click();
    flushSync();

    const courseInput = document.querySelector<HTMLInputElement>(
      `input[placeholder="${m.titlepage_course_placeholder()}"]`,
    );
    if (!courseInput) throw new Error("Course input not found");
    courseInput.value = "PSYC 232: Desarrollo humano";
    courseInput.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    dialogButton(m.titlepage_save()).click();
    await vi.waitFor(() => {
      expect(runtime.exportEssayToPdf).toHaveBeenCalledOnce();
    });
    expect(runtime.exportEssayToDocx).not.toHaveBeenCalled();

    await unmount(component);
  });

  it("abandons the export when the advice is dismissed", async () => {
    const component = mountIncompleteTitlePage();
    flushSync();

    exportAs("docx");
    await waitForAdvice();

    document.querySelector<HTMLButtonElement>(".modal .modal-close")!.click();
    flushSync();
    expect(document.querySelector(".modal")).toBeNull();
    await drainMicrotasks();
    expect(runtime.exportEssayToDocx).not.toHaveBeenCalled();

    // A later unrelated title-page save must not launch the abandoned export.
    document.querySelector<HTMLButtonElement>("button.out-item")!.click();
    flushSync();
    dialogButton(m.titlepage_save()).click();
    flushSync();
    await drainMicrotasks();
    expect(runtime.exportEssayToDocx).not.toHaveBeenCalled();

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

    exportAs("docx");
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

    exportAs("docx");
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

    exportAs("docx");
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

    exportAs("docx");
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

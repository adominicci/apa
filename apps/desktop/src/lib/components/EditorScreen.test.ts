// @vitest-environment jsdom

import { flushSync, mount, tick, unmount } from "svelte";
import type { Content, Editor as TiptapEditor } from "@tiptap/core";
import { exportDocx } from "@tesina/docx-export";
import type { Reference } from "@tesina/engine";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Essay } from "$lib/model/essay";
import { m } from "$lib/paraglide/messages";
import EditorScreen from "./EditorScreen.svelte";

const runtime = vi.hoisted(() => ({
  editors: [] as TiptapEditor[],
  persist: vi.fn(),
  persistedDocs: [] as unknown[],
  libraryReferences: [] as Reference[],
  exportEssayToDocx: vi.fn(),
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

describe("APA export reference integrity", () => {
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

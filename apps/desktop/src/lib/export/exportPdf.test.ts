import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Essay } from "$lib/model/essay";
import { exportEssayToPdf } from "$lib/export/exportPdf";

const runtime = vi.hoisted(() => ({
  save: vi.fn(),
  invoke: vi.fn(),
  paginateForPrint: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: runtime.save }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: runtime.invoke }));
vi.mock("$lib/export/paginateForPrint", () => ({
  paginateForPrint: runtime.paginateForPrint,
}));
vi.mock("$lib/export/exportAssets", () => ({
  buildExportAssets: () =>
    Promise.resolve({ imageUrls: new Map(), mathml: new Map() }),
}));

function essay(): Essay {
  return {
    schemaVersion: 2,
    id: "pdf-export",
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    settings: {
      documentLanguage: "en",
      variant: "student",
      font: "times-new-roman-12",
      paperSize: "us-letter",
      includeUncitedReferences: false,
    },
    titlePage: {
      title: "Reading Habits",
      authors: ["Ana Ruiz"],
      affiliations: ["Example University"],
    },
    content: { type: "doc", content: [] },
    referencesSnapshot: [],
  };
}

beforeEach(() => {
  runtime.save.mockReset();
  runtime.invoke.mockReset();
  runtime.paginateForPrint.mockReset();
  runtime.paginateForPrint.mockResolvedValue({
    html: "<html></html>",
    pages: 4,
  });
});

describe("PDF export adapter", () => {
  it("asks where to save before doing any rendering work", async () => {
    runtime.save.mockResolvedValue(null);

    const outcome = await exportEssayToPdf(essay(), { type: "doc" }, []);

    // macOS needs the destination before it will start a save-job print, so
    // cancelling must cost the user nothing.
    expect(outcome).toEqual({ status: "cancelled" });
    expect(runtime.paginateForPrint).not.toHaveBeenCalled();
    expect(runtime.invoke).not.toHaveBeenCalled();
  });

  it("offers the sanitized essay title with a .pdf extension", async () => {
    runtime.save.mockResolvedValue("/tmp/paper.pdf");
    runtime.invoke.mockResolvedValue(4);

    await exportEssayToPdf(essay(), { type: "doc" }, []);

    expect(runtime.save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "Reading Habits.pdf" }),
    );
  });

  it("passes the preview's page count so the printed result can be checked", async () => {
    runtime.save.mockResolvedValue("/tmp/paper.pdf");
    runtime.invoke.mockResolvedValue(4);

    const outcome = await exportEssayToPdf(essay(), { type: "doc" }, []);

    expect(runtime.invoke).toHaveBeenCalledWith("export_pdf", {
      html: "<html></html>",
      destination: "/tmp/paper.pdf",
      expectedPages: 4,
    });
    expect(outcome).toEqual({ status: "saved", path: "/tmp/paper.pdf" });
  });

  it("surfaces a render failure instead of reporting a saved file", async () => {
    runtime.save.mockResolvedValue("/tmp/paper.pdf");
    runtime.invoke.mockRejectedValue(
      new Error("the PDF did not finish in time"),
    );

    const outcome = await exportEssayToPdf(essay(), { type: "doc" }, []);

    // A timeout must never leave the UI claiming success.
    expect(outcome).toEqual({
      status: "error",
      message: "the PDF did not finish in time",
    });
  });

  it("surfaces a pagination failure", async () => {
    runtime.save.mockResolvedValue("/tmp/paper.pdf");
    runtime.paginateForPrint.mockRejectedValue(new Error("pagination failed"));

    const outcome = await exportEssayToPdf(essay(), { type: "doc" }, []);

    expect(outcome).toEqual({ status: "error", message: "pagination failed" });
    expect(runtime.invoke).not.toHaveBeenCalled();
  });
});

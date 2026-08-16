import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildExportAssets,
  collectEquationLatex,
  collectFigureSrcs,
} from "$lib/export/exportAssets";

const runtime = vi.hoisted(() => ({
  readImageBytes: vi.fn(),
  latexToMathml: vi.fn(),
}));

vi.mock("$lib/persist/assets", async () => {
  const actual = await vi.importActual<typeof import("$lib/persist/assets")>(
    "$lib/persist/assets",
  );
  return { ...actual, readImageBytes: runtime.readImageBytes };
});

vi.mock("$lib/editor/mathml", () => ({
  latexToMathml: runtime.latexToMathml,
}));

function doc(...nodes: unknown[]) {
  return { type: "doc", content: nodes };
}

function figure(src: string) {
  return { type: "figureImage", attrs: { src } };
}

function equation(latex: string) {
  return { type: "apaEquation", attrs: { latex } };
}

beforeEach(() => {
  runtime.readImageBytes.mockReset();
  runtime.latexToMathml.mockReset();
});

describe("export asset collection", () => {
  it("finds figures and equations nested at any depth", () => {
    const nested = doc({
      type: "sectionBody",
      content: [figure("a/one.png"), { content: [equation("x^2")] }],
    });

    const srcs = new Set<string>();
    const latexes = new Set<string>();
    collectFigureSrcs(nested, srcs);
    collectEquationLatex(nested, latexes);

    expect([...srcs]).toEqual(["a/one.png"]);
    expect([...latexes]).toEqual(["x^2"]);
  });
});

describe("self-contained export assets", () => {
  it("inlines figures as data URLs with the type from the extension", async () => {
    runtime.readImageBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const { imageUrls } = await buildExportAssets(doc(figure("a/one.jpg")));

    // The printing webview outlives nothing, so a blob URL would be dead on
    // arrival; the bytes have to travel inside the document.
    expect(imageUrls.get("a/one.jpg")).toBe(
      `data:image/jpeg;base64,${btoa("\x01\x02\x03")}`,
    );
  });

  it("skips an unreadable figure instead of failing the export", async () => {
    runtime.readImageBytes.mockRejectedValue(new Error("missing"));

    const { imageUrls } = await buildExportAssets(doc(figure("gone.png")));

    expect(imageUrls.size).toBe(0);
  });

  it("converts equations to MathML", async () => {
    runtime.latexToMathml.mockReturnValue("<math><mi>x</mi></math>");

    const { mathml } = await buildExportAssets(doc(equation("x")));

    expect(mathml.get("x")).toBe("<math><mi>x</mi></math>");
  });

  it("skips malformed LaTeX instead of failing the export", async () => {
    runtime.latexToMathml.mockImplementation(() => {
      throw new Error("bad latex");
    });

    const { mathml } = await buildExportAssets(doc(equation("\\frac{")));

    expect(mathml.size).toBe(0);
  });

  it("encodes a figure larger than the argument limit", async () => {
    // Spreading this into String.fromCharCode would throw, turning a big
    // figure into a failed export rather than a big one.
    runtime.readImageBytes.mockResolvedValue(new Uint8Array(300_000).fill(65));

    const { imageUrls } = await buildExportAssets(doc(figure("big.png")));

    const url = imageUrls.get("big.png");
    expect(url).toMatch(/^data:image\/png;base64,/);
    expect(atob(url!.split(",")[1]!).length).toBe(300_000);
  });
});

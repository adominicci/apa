import { describe, expect, it } from "vitest";
import { mathTreeToOmml } from "../src/math.ts";
import type { MathNode } from "../src/input.ts";

/** Atajo para armar árboles a mano en los tests. */
function el(tag: string, ...children: MathNode[]): MathNode {
  return { tag, children };
}
function leaf(tag: string, text: string): MathNode {
  return { tag, text };
}

describe("mathTreeToOmml — construcciones soportadas", () => {
  it("mapea una hoja de texto a un MathRun", () => {
    const result = mathTreeToOmml(leaf("mi", "x"));
    expect(result.ok).toBe(true);
  });

  it("mapea una fracción", () => {
    const frac = el("mfrac", leaf("mn", "1"), leaf("mn", "2"));
    expect(mathTreeToOmml(frac).ok).toBe(true);
  });

  it("mapea una raíz cuadrada", () => {
    expect(mathTreeToOmml(el("msqrt", leaf("mi", "x"))).ok).toBe(true);
  });

  it("mapea superíndice y subíndice", () => {
    expect(mathTreeToOmml(el("msup", leaf("mi", "e"), leaf("mi", "x"))).ok)
      .toBe(true);
    expect(mathTreeToOmml(el("msub", leaf("mi", "x"), leaf("mn", "1"))).ok)
      .toBe(true);
  });

  it("aplana un mrow en sus hijos", () => {
    const row = el("mrow", leaf("mi", "a"), leaf("mo", "+"), leaf("mi", "b"));
    const result = mathTreeToOmml(row);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.children).toHaveLength(3);
  });
});

describe("mathTreeToOmml — no soportado", () => {
  it("rechaza una matriz e informa cuál elemento fue", () => {
    // docx@9 no expone ningún tipo de matriz: es techo de la librería, no
    // recorte nuestro. Ver el spec.
    const result = mathTreeToOmml(el("mtable", el("mtr", leaf("mn", "1"))));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("mtable");
  });

  it("rechaza un elemento desconocido en vez de ignorarlo en silencio", () => {
    const result = mathTreeToOmml(el("mglyph"));
    expect(result.ok).toBe(false);
  });

  it("mapea la sumatoria con límites que emite Temml", () => {
    // Temml usa munderover para \\sum_{i=1}^{n}. Medido en el spike: sin este
    // caso la primera ecuación realista de una tesina ya falla.
    const sum = el(
      "munderover",
      leaf("mo", "∑"),
      el("mrow", leaf("mi", "i"), leaf("mo", "="), leaf("mn", "1")),
      leaf("mi", "n"),
    );
    expect(mathTreeToOmml(sum).ok).toBe(true);
  });

  it("mapea la integral con límites (msubsup)", () => {
    const integral = el(
      "msubsup",
      leaf("mo", "∫"),
      leaf("mn", "0"),
      leaf("mi", "∞"),
    );
    expect(mathTreeToOmml(integral).ok).toBe(true);
  });

  it("mapea la raíz n-ésima (mroot)", () => {
    expect(mathTreeToOmml(el("mroot", leaf("mi", "x"), leaf("mn", "3"))).ok)
      .toBe(true);
  });

  it("ignora mspace sin romper ni emitir nada", () => {
    // Temml lo intercala por espaciado; OMML hace el suyo. Ignorarlo es
    // correcto, y por eso se afirma que no produce hijos.
    const result = mathTreeToOmml(
      el("mrow", leaf("mi", "x"), { tag: "mspace" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.children).toHaveLength(1);
  });

  it("propaga el rechazo desde un hijo anidado", () => {
    // Lo importante: que un mtable enterrado no pase inadvertido porque el
    // padre sí es soportado.
    const frac = el("mfrac", leaf("mn", "1"), el("mtable"));
    expect(mathTreeToOmml(frac).ok).toBe(false);
  });
});

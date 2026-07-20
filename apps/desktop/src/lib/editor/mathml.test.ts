// @vitest-environment jsdom
//
// Necesita DOM porque el parseo de MathML usa DOMParser. Ese es justamente el
// reparto del diseño: la capa app parsea, el paquete puro solo mapea.
import { describe, expect, it } from "vitest";
import { latexToMathTree } from "./mathml.ts";

describe("latexToMathTree", () => {
  it("convierte una fracción en un árbol con mfrac", () => {
    const tree = latexToMathTree("\\frac{1}{2}");
    expect(tree).not.toBeNull();
    expect(JSON.stringify(tree)).toContain("mfrac");
  });

  it("produce un árbol serializable, sin nodos del DOM", () => {
    // El contrato con el paquete puro depende de esto: si se colara un
    // Element, JSON.stringify lo perdería y el mapeador recibiría basura.
    const tree = latexToMathTree("x^2");
    expect(() => structuredClone(tree)).not.toThrow();
  });

  it("conserva el texto de las hojas", () => {
    const tree = latexToMathTree("x");
    expect(JSON.stringify(tree)).toContain('"x"');
  });

  it("devuelve null ante LaTeX inválido en vez de lanzar", () => {
    // La exportación nunca debe romperse por una ecuación mal escrita.
    expect(latexToMathTree("\\frac{")).toBeNull();
  });
});

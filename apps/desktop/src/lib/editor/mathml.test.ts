// @vitest-environment jsdom
//
// Necesita DOM porque el parseo de MathML usa DOMParser. Ese es justamente el
// reparto del diseño: la capa app parsea, el paquete puro solo mapea.
import { describe, expect, it } from "vitest";
import { isValidLatex, latexToMathml, latexToMathTree } from "./mathml.ts";

describe("latexToMathTree", () => {
  it("convierte una fracción en un árbol con mfrac", () => {
    const tree = latexToMathTree("\\frac{1}{2}");
    expect(tree).not.toBeNull();
    expect(JSON.stringify(tree)).toContain("mfrac");
  });

  it("produce un árbol sin nodos del DOM, recorriéndolo entero", () => {
    /*
     * El contrato con el paquete puro depende de esto: `docx-export` no tiene
     * DOM, así que un Element colado en el árbol reventaría allá.
     *
     * Una versión anterior de este test usaba `structuredClone` y NO servía:
     * en Node con jsdom, clonar un Element no lanza — lo serializa a `{}` en
     * silencio, porque el algoritmo no reconoce el Element de jsdom como
     * objeto de host y solo copia propiedades propias enumerables, que jsdom
     * deja vacías. El test pasaba aunque se filtrara un Element. Por eso acá
     * se recorre el árbol y se verifica cada valor.
     */
    const tree = latexToMathTree(
      "\\frac{x^2}{\\sqrt{n}} + \\sum_{i=1}^{n} \\alpha_i",
    );
    expect(tree).not.toBeNull();

    const seen: string[] = [];
    function assertPlain(value: unknown, path: string): void {
      if (value === null || typeof value !== "object") return;
      expect(value, `${path} es un nodo del DOM`).not.toBeInstanceOf(Node);
      seen.push(path);
      for (const [key, child] of Object.entries(value)) {
        if (Array.isArray(child)) {
          child.forEach((item, i) => assertPlain(item, `${path}.${key}[${i}]`));
        } else {
          assertPlain(child, `${path}.${key}`);
        }
      }
    }
    assertPlain(tree, "raíz");

    // Guarda contra el propio recorrido: si el árbol viniera plano o vacío,
    // las aserciones de arriba pasarían sin haber mirado nada.
    expect(seen.length).toBeGreaterThan(5);
  });

  it("conserva el texto de las hojas", () => {
    const tree = latexToMathTree("x");
    expect(JSON.stringify(tree)).toContain('"x"');
  });

  it("conserva atributos MathML que afectan la semántica", () => {
    const tree = latexToMathTree("\\binom{n}{k}");
    expect(JSON.stringify(tree)).toContain('"linethickness":"0px"');
  });

  it("devuelve null ante LaTeX inválido en vez de lanzar", () => {
    // La exportación nunca debe romperse por una ecuación mal escrita.
    expect(latexToMathTree("\\frac{")).toBeNull();
  });

  it("valida LaTeX antes de permitir confirmarlo", () => {
    expect(isValidLatex("x^2")).toBe(true);
    expect(isValidLatex("\\frac{")).toBe(false);
    expect(isValidLatex("   ")).toBe(false);
  });

  it("limita las dimensiones solicitadas por LaTeX", () => {
    const mathml = latexToMathml("\\rule{500em}{500em}");
    expect(mathml).toContain('width="10em"');
    expect(mathml).toContain('height="10em"');
    expect(mathml).not.toContain("500em");
  });
});

import temml from "temml";
import type { MathNode } from "@tesina/docx-export";

/**
 * LaTeX → MathML. Vive en la capa app porque el parseo necesita DOMParser, y
 * `docx-export` es puro y sin DOM. Mismo reparto que los bytes de las
 * imágenes de figuras.
 */
export function latexToMathml(latex: string): string {
  return temml.renderToString(latex, {
    displayMode: true,
    throwOnError: true,
    maxSize: [10, 100],
  });
}

/** Convierte un elemento del DOM al árbol plano serializable del contrato. */
function elementToNode(element: Element): MathNode {
  const children = Array.from(element.children);
  const attrs = Object.fromEntries(
    Array.from(element.attributes, ({ name, value }) => [name, value]),
  );
  const withAttrs = Object.keys(attrs).length > 0 ? { attrs } : {};
  if (children.length === 0) {
    return {
      tag: element.tagName,
      text: element.textContent ?? "",
      ...withAttrs,
    };
  }
  return {
    tag: element.tagName,
    children: children.map(elementToNode),
    ...withAttrs,
  };
}

/**
 * Devuelve `null` —no lanza— cuando el LaTeX no es válido: una ecuación mal
 * escrita no puede hacer fallar la exportación del documento entero.
 */
export function latexToMathTree(latex: string): MathNode | null {
  try {
    const mathml = latexToMathml(latex);
    const doc = new DOMParser().parseFromString(mathml, "text/xml");
    if (doc.querySelector("parsererror")) return null;
    const root = doc.documentElement;
    return root ? elementToNode(root) : null;
  } catch {
    return null;
  }
}

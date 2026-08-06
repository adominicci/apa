import {
  Math as DocxMath,
  type MathComponent,
  MathFraction,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSubSuperScript,
  MathSum,
  MathSuperScript,
} from "docx";
import type { MathNode } from "./input.ts";

/**
 * Resultado discriminado, y a propósito no hay un predicado `esExportable()`
 * aparte: sería una segunda implementación de las mismas reglas y con el
 * tiempo se desincronizaría. El exportador usa `children`; el editor llama
 * exactamente esto y se queda solo con `ok`.
 *
 * En el caso `false`, `unsupported` es SOLO un identificador — el tag del
 * elemento (`"mtable"`) o el glifo del operador (`"∏"`) — sin prosa, sin
 * puntuación y sin idioma. Este paquete es puro (ver AGENTS.md: nada de DOM,
 * nada de imports de la app) y no tiene por qué decidir en qué idioma ni con
 * qué palabras se le avisa al usuario; eso es responsabilidad de la capa de
 * app, que arma el texto del badge vía Paraglide a partir de este nombre.
 */
export type MathResult =
  | { ok: true; children: MathComponent[] }
  | { ok: false; unsupported: string };

/** Hojas: su texto va tal cual a un MathRun. */
const LEAF_TAGS = new Set(["mi", "mn", "mo", "mtext", "ms"]);

/**
 * Texto del operador base de un munderover: una hoja directa, o (por si
 * Temml lo envuelve) un mrow de un único hijo que sea hoja. undefined si no
 * se puede determinar con certeza — en ese caso NO es "∑" y se rechaza.
 */
function baseOperatorGlyph(node: MathNode): string | undefined {
  if (LEAF_TAGS.has(node.tag)) return node.text;
  if (node.tag === "mrow" && node.children?.length === 1) {
    return baseOperatorGlyph(node.children[0]!);
  }
  return undefined;
}

export function mathTreeToOmml(node: MathNode): MathResult {
  const children = node.children ?? [];

  const mathVariant = node.attrs?.["mathvariant"];
  if (mathVariant && mathVariant !== "italic") {
    return {
      ok: false,
      unsupported: `${node.tag}[mathvariant=${mathVariant}]`,
    };
  }

  // MathML renders multi-character identifiers upright by default, whereas
  // a plain OMML MathRun is italic. Fall back rather than change notation.
  if (node.tag === "mi" && Array.from(node.text ?? "").length > 1) {
    return { ok: false, unsupported: "mi[upright]" };
  }

  if (LEAF_TAGS.has(node.tag)) {
    return { ok: true, children: [new MathRun(node.text ?? "")] };
  }

  // mrow y math son agrupadores sin forma propia: se aplanan.
  if (node.tag === "mrow" || node.tag === "math" || node.tag === "mstyle") {
    const flattened: MathComponent[] = [];
    for (const child of children) {
      const result = mathTreeToOmml(child);
      if (!result.ok) return result;
      flattened.push(...result.children);
    }
    return { ok: true, children: flattened };
  }

  if (node.tag === "mfrac" && children.length === 2) {
    if (/^0(?:[a-z%]+)?$/i.test(node.attrs?.["linethickness"] ?? "")) {
      return { ok: false, unsupported: "mfrac[linethickness=0]" };
    }
    const numerator = mathTreeToOmml(children[0]!);
    if (!numerator.ok) return numerator;
    const denominator = mathTreeToOmml(children[1]!);
    if (!denominator.ok) return denominator;
    return {
      ok: true,
      children: [
        new MathFraction({
          numerator: numerator.children,
          denominator: denominator.children,
        }),
      ],
    };
  }

  if (node.tag === "msqrt") {
    const inner = mathTreeToOmml({ tag: "mrow", children });
    if (!inner.ok) return inner;
    return {
      ok: true,
      children: [new MathRadical({ children: inner.children })],
    };
  }

  if (node.tag === "msup" && children.length === 2) {
    const base = mathTreeToOmml(children[0]!);
    if (!base.ok) return base;
    const sup = mathTreeToOmml(children[1]!);
    if (!sup.ok) return sup;
    return {
      ok: true,
      children: [
        new MathSuperScript({
          children: base.children,
          superScript: sup.children,
        }),
      ],
    };
  }

  if (node.tag === "msub" && children.length === 2) {
    const base = mathTreeToOmml(children[0]!);
    if (!base.ok) return base;
    const sub = mathTreeToOmml(children[1]!);
    if (!sub.ok) return sub;
    return {
      ok: true,
      children: [
        new MathSubScript({
          children: base.children,
          subScript: sub.children,
        }),
      ],
    };
  }

  // Raíz n-ésima: en MathML el índice va SEGUNDO (mroot > base, índice), al
  // revés de como se lee.
  if (node.tag === "mroot" && children.length === 2) {
    const base = mathTreeToOmml(children[0]!);
    if (!base.ok) return base;
    const degree = mathTreeToOmml(children[1]!);
    if (!degree.ok) return degree;
    return {
      ok: true,
      children: [
        new MathRadical({ children: base.children, degree: degree.children }),
      ],
    };
  }

  // Integral con límites: msubsup > base, inferior, superior.
  if (node.tag === "msubsup" && children.length === 3) {
    const base = mathTreeToOmml(children[0]!);
    if (!base.ok) return base;
    const sub = mathTreeToOmml(children[1]!);
    if (!sub.ok) return sub;
    const sup = mathTreeToOmml(children[2]!);
    if (!sup.ok) return sup;
    return {
      ok: true,
      children: [
        new MathSubSuperScript({
          children: base.children,
          subScript: sub.children,
          superScript: sup.children,
        }),
      ],
    };
  }

  // Sumatoria con límites: munderover > base, inferior, superior. Es lo que
  // Temml emite para \sum_{i=1}^{n}; sin este caso la primera ecuación
  // realista de una tesina ya falla.
  //
  // OJO: la clase `MathSum` de docx tiene el glifo "∑" hardcodeado
  // (`accent: "∑"` en createMathNAryProperties, docx/dist/index.mjs) — no
  // recibe el operador como parámetro. munderover también es lo que Temml
  // emite para \prod (∏), \bigcup (⋃), \bigcap, \bigvee, etc., y docx no
  // tiene una clase equivalente para ninguno de esos. Mapear todo
  // munderover a MathSum sin mirar la base convertiría un producto o una
  // unión en una sumatoria en Word, en silencio: la peor forma de fallar,
  // porque matemáticamente es simplemente incorrecto y nadie lo nota. Este
  // gate es lo que lo evita: solo se acepta cuando la base es literalmente
  // "∑"; cualquier otro operador cae a `unsupported` (LaTeX crudo + aviso
  // del editor) en vez de renderizar el símbolo equivocado.
  if (node.tag === "munderover" && children.length === 3) {
    const glyph = baseOperatorGlyph(children[0]!);
    if (glyph !== "∑") {
      return { ok: false, unsupported: glyph ?? children[0]!.tag };
    }
    const sub = mathTreeToOmml(children[1]!);
    if (!sub.ok) return sub;
    const sup = mathTreeToOmml(children[2]!);
    if (!sup.ok) return sup;
    return {
      ok: true,
      children: [
        new MathSum({
          children: [],
          subScript: sub.children,
          superScript: sup.children,
        }),
      ],
    };
  }

  // Temml intercala mspace por espaciado tipográfico. No aporta nada al OMML,
  // que hace su propio espaciado; ignorarlo es correcto, no una omisión.
  if (node.tag === "mspace") {
    return { ok: true, children: [] };
  }

  return { ok: false, unsupported: node.tag };
}

/** Envuelve el resultado en el `Math` que va dentro de un párrafo. */
export function toDocxMath(children: MathComponent[]): DocxMath {
  return new DocxMath({ children });
}

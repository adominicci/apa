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
 */
export type MathResult =
  | { ok: true; children: MathComponent[] }
  | { ok: false; reason: string };

/** Hojas: su texto va tal cual a un MathRun. */
const LEAF_TAGS = new Set(["mi", "mn", "mo", "mtext", "ms"]);

export function mathTreeToOmml(node: MathNode): MathResult {
  const children = node.children ?? [];

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
  if (node.tag === "munderover" && children.length === 3) {
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

  return {
    ok: false,
    reason: `Elemento MathML no soportado: <${node.tag}>`,
  };
}

/** Envuelve el resultado en el `Math` que va dentro de un párrafo. */
export function toDocxMath(children: MathComponent[]): DocxMath {
  return new DocxMath({ children });
}

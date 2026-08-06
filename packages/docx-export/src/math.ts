import {
  Math as DocxMath,
  type MathComponent,
  MathFraction,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSubSuperScript,
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

/** Standard and supplemental Unicode integral operators. */
function isIntegralGlyph(glyph: string | undefined): glyph is string {
  return glyph !== undefined && /^[\u222B-\u2233\u2A0B-\u2A1C]$/u.test(glyph);
}

function integralOperatorLabel(node: MathNode): string | undefined {
  const glyph = baseOperatorGlyph(node);
  if (isIntegralGlyph(glyph)) return glyph;
  // Temml represents \idotsint limits on a lone ellipsis, with the surrounding
  // integral signs as siblings. Treat that known base as the composite operator.
  if (glyph === "⋯" || glyph === "…") return "∫⋯∫";
  if (node.tag !== "mrow") return undefined;

  let label = "";
  let hasIntegral = false;
  for (const child of node.children ?? []) {
    if (child.tag === "mspace") continue;
    const part = baseOperatorGlyph(child);
    if (isIntegralGlyph(part)) hasIntegral = true;
    else if (part !== "⋯" && part !== "…") return undefined;
    label += part;
  }
  return hasIntegral ? label : undefined;
}

export function mathTreeToOmml(node: MathNode): MathResult {
  const children = node.children ?? [];

  // Temml uses mspace for typographic spacing. OMML supplies its own math
  // spacing, so only attribute-free/internal-class nodes are omitted. Explicit
  // spacing or visible attributes must trigger the safe fallback.
  if (node.tag === "mspace") {
    const explicitAttributes = Object.keys(node.attrs ?? {}).filter(
      (name) => name !== "class",
    );
    const visibleAttribute = explicitAttributes.find((name) =>
      name !== "width"
    ) ??
      explicitAttributes[0];
    return visibleAttribute
      ? { ok: false, unsupported: `mspace[${visibleAttribute}]` }
      : { ok: true, children: [] };
  }

  for (const [name, rawValue] of Object.entries(node.attrs ?? {})) {
    // Temml emits internal class names without shipping CSS in this app;
    // they are transport metadata and do not affect native MathML rendering.
    if (name === "class") continue;
    if (
      node.tag === "math" &&
      (name === "display" || name === "style" ||
        name === "xmlns")
    ) {
      continue;
    }
    if (name === "mathvariant") {
      if (
        rawValue === "italic" && node.tag === "mi" &&
        Array.from(node.text ?? "").length === 1
      ) continue;
      return {
        ok: false,
        unsupported: `${node.tag}[mathvariant=${rawValue}]`,
      };
    }
    if (node.tag === "mfrac" && name === "linethickness") {
      if (/^0(?:\.0+)?(?:[a-z%]+)?$/i.test(rawValue.trim())) {
        return { ok: false, unsupported: "mfrac[linethickness=0]" };
      }
    }
    return { ok: false, unsupported: `${node.tag}[${name}]` };
  }

  // MathML renders multi-character identifiers upright by default, whereas
  // a plain OMML MathRun is italic. Fall back rather than change notation.
  if (node.tag === "mi" && Array.from(node.text ?? "").length > 1) {
    return { ok: false, unsupported: "mi[upright]" };
  }
  if (node.tag === "mtext") {
    return { ok: false, unsupported: "mtext[upright]" };
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
    const integral = integralOperatorLabel(children[0]!);
    if (integral) {
      return { ok: false, unsupported: `${integral}[operand]` };
    }
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
    const integral = integralOperatorLabel(children[0]!);
    if (integral) {
      return { ok: false, unsupported: `${integral}[operand]` };
    }
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

  // MathML leaves an integral's operand as following siblings, so this
  // isolated node cannot build a valid native n-ary OMML operand.
  if (node.tag === "msubsup" && children.length === 3) {
    const integral = integralOperatorLabel(children[0]!);
    if (integral) {
      return { ok: false, unsupported: `${integral}[operand]` };
    }
    const sub = mathTreeToOmml(children[1]!);
    if (!sub.ok) return sub;
    const sup = mathTreeToOmml(children[2]!);
    if (!sup.ok) return sup;
    const base = mathTreeToOmml(children[0]!);
    if (!base.ok) return base;
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

  // munderover has the same operand ambiguity for sums and other n-ary
  // operators. Fall back rather than emit an empty native operand.
  if (node.tag === "munderover" && children.length === 3) {
    const glyph = baseOperatorGlyph(children[0]!);
    return {
      ok: false,
      unsupported: glyph === "∑" ? "∑[operand]" : glyph ?? children[0]!.tag,
    };
  }

  return { ok: false, unsupported: node.tag };
}

/** Envuelve el resultado en el `Math` que va dentro de un párrafo. */
export function toDocxMath(children: MathComponent[]): DocxMath {
  return new DocxMath({ children });
}

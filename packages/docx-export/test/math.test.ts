import { describe, expect, it } from "vitest";
import type { IContext } from "docx";
import {
  MathFraction,
  MathRadical,
  MathSubScript,
  MathSuperScript,
} from "docx";
import { mathTreeToOmml } from "../src/math.ts";
import type { MathNode } from "../src/input.ts";

/** Atajo para armar árboles a mano en los tests. */
function el(tag: string, ...children: MathNode[]): MathNode {
  return { tag, children };
}
function leaf(tag: string, text: string): MathNode {
  return { tag, text };
}

/**
 * `prepForXml` es público en `docx` (lo llama el Formatter interno de la
 * librería); un `IContext` real solo aporta `file`/`viewWrapper`, que los
 * componentes de math no tocan, así que un `stack` vacío basta.
 */
function xmlOf(component: unknown): unknown {
  const withPrep = component as {
    prepForXml(context: IContext): unknown;
  };
  return withPrep.prepForXml({ stack: [] } as unknown as IContext);
}

/**
 * Recorre el objeto que produce `prepForXml` y junta el texto de cada
 * `m:r`/`m:t` (run) en el orden en que quedaría serializado en el XML. Esto
 * es lo que permite a un test distinguir "numerador y denominador en el
 * orden correcto" de "numerador y denominador intercambiados" — dos
 * instancias de la misma clase docx con el mismo largo de `children` que,
 * sin esto, se verían idénticas para el test.
 */
function runTextsInOrder(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) runTextsInOrder(item, out);
  } else if (node !== null && typeof node === "object") {
    for (
      const [key, value] of Object.entries(node as Record<string, unknown>)
    ) {
      if (key === "m:t" && Array.isArray(value)) {
        for (const v of value) if (typeof v === "string") out.push(v);
      } else {
        runTextsInOrder(value, out);
      }
    }
  }
  return out;
}

describe("mathTreeToOmml — construcciones soportadas", () => {
  it("mapea una hoja de texto a un MathRun", () => {
    const result = mathTreeToOmml(leaf("mi", "x"));
    expect(result.ok).toBe(true);
  });

  it("rechaza identificadores MathML rectos que Word volvería cursivos", () => {
    expect(mathTreeToOmml(leaf("mi", "kg"))).toEqual({
      ok: false,
      unsupported: "mi[upright]",
    });
    expect(
      mathTreeToOmml({
        tag: "mi",
        text: "x",
        attrs: { mathvariant: "normal" },
      }),
    ).toEqual({ ok: false, unsupported: "mi[mathvariant=normal]" });
  });

  it("rechaza texto MathML recto que Word volvería cursivo", () => {
    expect(mathTreeToOmml(leaf("mtext", "where"))).toEqual({
      ok: false,
      unsupported: "mtext[upright]",
    });
  });

  it("rechaza atributos MathML que el mapeador no implementa", () => {
    expect(
      mathTreeToOmml({ tag: "mi", text: "x", attrs: { color: "red" } }),
    ).toEqual({ ok: false, unsupported: "mi[color]" });
  });

  it("acepta atributos de transporte del elemento math", () => {
    expect(
      mathTreeToOmml({
        tag: "math",
        attrs: {
          xmlns: "http://www.w3.org/1998/Math/MathML",
          display: "block",
          class: "tml-display",
        },
        children: [leaf("mi", "x")],
      }).ok,
    ).toBe(true);
  });

  it("rechaza variantes cursivas explícitas que OMML no conserva", () => {
    expect(
      mathTreeToOmml({
        tag: "mstyle",
        attrs: { mathvariant: "italic" },
        children: [leaf("mn", "123")],
      }),
    ).toEqual({ ok: false, unsupported: "mstyle[mathvariant=italic]" });
  });

  it("mapea una fracción con numerador y denominador en el orden correcto", () => {
    const frac = el("mfrac", leaf("mn", "1"), leaf("mn", "2"));
    const result = mathTreeToOmml(frac);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.children).toHaveLength(1);
    const [component] = result.children;
    expect(component).toBeInstanceOf(MathFraction);
    expect(runTextsInOrder(xmlOf(component))).toEqual(["1", "2"]);
  });

  it("rechaza una fracción sin barra para conservar su semántica", () => {
    const frac: MathNode = {
      ...el("mfrac", leaf("mi", "n"), leaf("mi", "k")),
      attrs: { linethickness: "0" },
    };
    expect(mathTreeToOmml(frac)).toEqual({
      ok: false,
      unsupported: "mfrac[linethickness=0]",
    });
    for (const linethickness of ["0px", "0.0", " 0.0px ", "0.00em"]) {
      expect(
        mathTreeToOmml({ ...frac, attrs: { linethickness } }),
      ).toEqual({ ok: false, unsupported: "mfrac[linethickness=0]" });
    }
  });

  it("mapea una raíz cuadrada", () => {
    expect(mathTreeToOmml(el("msqrt", leaf("mi", "x"))).ok).toBe(true);
  });

  it("mapea superíndice y subíndice con base y script en el orden correcto", () => {
    const sup = mathTreeToOmml(el("msup", leaf("mi", "e"), leaf("mi", "x")));
    expect(sup.ok).toBe(true);
    if (sup.ok) {
      expect(sup.children).toHaveLength(1);
      const [component] = sup.children;
      expect(component).toBeInstanceOf(MathSuperScript);
      expect(runTextsInOrder(xmlOf(component))).toEqual(["e", "x"]);
    }

    const sub = mathTreeToOmml(el("msub", leaf("mi", "x"), leaf("mn", "1")));
    expect(sub.ok).toBe(true);
    if (sub.ok) {
      expect(sub.children).toHaveLength(1);
      const [component] = sub.children;
      expect(component).toBeInstanceOf(MathSubScript);
      expect(runTextsInOrder(xmlOf(component))).toEqual(["x", "1"]);
    }
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
    if (!result.ok) expect(result.unsupported).toBe("mtable");
  });

  it("rechaza un elemento desconocido en vez de ignorarlo en silencio", () => {
    const result = mathTreeToOmml(el("mglyph"));
    expect(result.ok).toBe(false);
  });

  it("rechaza una sumatoria sin operando estructural", () => {
    // Temml usa munderover para \\sum_{i=1}^{n}. Medido en el spike: sin este
    // caso la primera ecuación realista de una tesina ya falla.
    const sum = el(
      "munderover",
      leaf("mo", "∑"),
      el("mrow", leaf("mi", "i"), leaf("mo", "="), leaf("mn", "1")),
      leaf("mi", "n"),
    );
    const result = mathTreeToOmml(sum);
    expect(result).toEqual({ ok: false, unsupported: "∑[operand]" });
  });

  it("rechaza munderover con base ∏ en vez de mapearlo a MathSum (∑)", () => {
    // Regresión del hallazgo: `MathSum` de docx tiene el glifo "∑"
    // hardcodeado (`accent: "∑"`), así que mapear CUALQUIER munderover a
    // MathSum convertía un \\prod en una sumatoria en Word, en silencio. Este
    // es el guardia: solo se acepta cuando la base es literalmente "∑".
    const prod = el(
      "munderover",
      leaf("mo", "∏"),
      el("mrow", leaf("mi", "i"), leaf("mo", "="), leaf("mn", "1")),
      leaf("mi", "n"),
    );
    const result = mathTreeToOmml(prod);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.unsupported).toBe("∏");
  });

  it("rechaza munderover con base ⋃ (bigcup) por la misma razón", () => {
    const union = el(
      "munderover",
      leaf("mo", "⋃"),
      leaf("mi", "i"),
      leaf("mi", "n"),
    );
    const result = mathTreeToOmml(union);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.unsupported).toBe("⋃");
  });

  it("rechaza una integral sin operando estructural", () => {
    const integral = el(
      "msubsup",
      leaf("mo", "∫"),
      leaf("mn", "0"),
      leaf("mi", "∞"),
    );
    const result = mathTreeToOmml(integral);
    expect(result).toEqual({ ok: false, unsupported: "∫[operand]" });
  });

  it("mapea la raíz n-ésima (mroot) con base y grado en el orden correcto", () => {
    const result = mathTreeToOmml(
      el("mroot", leaf("mi", "x"), leaf("mn", "3")),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.children).toHaveLength(1);
    const [component] = result.children;
    expect(component).toBeInstanceOf(MathRadical);
    // OMML serializa el grado (m:deg) ANTES que la base (m:e) — al revés del
    // orden de MathML (mroot > base, índice). Por eso importa comprobar el
    // orden real y no solo que la clase sea MathRadical: un swap de
    // base/degree en la implementación produce igual clase e igual cantidad
    // de children, y este assert es el único que lo distingue.
    expect(runTextsInOrder(xmlOf(component))).toEqual(["3", "x"]);
  });

  it("rechaza mspace con ancho explícito", () => {
    const result = mathTreeToOmml(
      { tag: "mspace", attrs: { width: "0.1667em" } },
    );
    expect(result).toEqual({ ok: false, unsupported: "mspace[width]" });
  });

  it("rechaza mspace con atributos visibles", () => {
    expect(
      mathTreeToOmml({
        tag: "mspace",
        attrs: {
          width: "1em",
          height: "0.1em",
          mathbackground: "currentColor",
        },
      }),
    ).toEqual({ ok: false, unsupported: "mspace[height]" });
  });

  it("propaga el rechazo desde un hijo anidado", () => {
    // Lo importante: que un mtable enterrado no pase inadvertido porque el
    // padre sí es soportado.
    const frac = el("mfrac", leaf("mn", "1"), el("mtable"));
    expect(mathTreeToOmml(frac).ok).toBe(false);
  });
});

# Ecuaciones en bloque — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ecuaciones desplegadas en LaTeX, centradas y numeradas `(1)`, que se
exporten al `.docx` como ecuaciones **nativas de Word** editables.

**Architecture:** LaTeX es lo único que se guarda. Temml lo convierte a MathML,
que es la representación intermedia única: WKWebView lo renderiza en editor y
preview, y para DOCX la capa app lo parsea a un árbol plano serializable que el
paquete puro `docx-export` mapea a objetos `Math` (OMML).

**Tech Stack:** Temml (MIT), `docx@9`, Svelte 5, TipTap 3, vitest.

Spec: `docs/superpowers/specs/2026-07-20-equations-design.md`

## Global Constraints

- Verificación desde la raíz tras **cada** tarea: `deno task check` (**0 errores,
  0 warnings**), `deno task test`, `deno fmt`, `deno lint`.
- **Leer la salida de `deno lint` completa, no su última línea.** El resumen
  `Found N problems` aparece ANTES de `Checked N files`, así que un
  `| tail -1` muestra el conteo de archivos y esconde los errores. Usar
  `deno lint 2>&1 | grep -E 'Found|Checked'`. Este error real dejó pasar 6
  problemas de lint durante tres PRs.
- Todo `.svelte` tocado pasa además el autofixer del MCP de Svelte
  (`desired_svelte_version: 5`) con `issues: []`.
- **`docx-export` es un paquete puro**: no importa código de app ni de Tauri, y
  **no tiene DOM**. Sus tests corren en `node`. Todo lo que necesite `DOMParser`
  vive en la capa app.
- El contrato entre ambos es `docx-export/src/input.ts`, el único sancionado por
  AGENTS.md. Precedente exacto a imitar: `images?: Record<string, ExportImage>`,
  donde la app lee los bytes y los pasa.
- **Numeración calculada en tiempo de render, nunca guardada** — se cuenta en
  orden de documento en cada renderizador.
- Nunca hardcodear cadena visible (Paraglide) ni color (tokens de `tokens.css`).
- **No** tocar `essay.schemaVersion`: sigue en `2`. Los nodos nuevos son aditivos.
- Licencias: solo MIT / Apache-2 / ISC / BSD / OFL. Nada de AGPL.
- API de Temml, ya verificada contra su documentación:
  `temml.renderToString(latex, { displayMode: true })` devuelve el MathML como
  string; `temml.render(latex, elemento, opciones)` renderiza dentro de un
  elemento del DOM.
- **RESUELTO por el spike: la fuente de Temml NO hace falta.** WKWebView
  renderiza el MathML nativo y correcto con las fuentes del sistema. La Task 4
  **no toca `app.html`**. (Si algún día hiciera falta, el único camino admitido
  es empotrarla en base64 en `app.html` como Inter — nunca como `import` de CSS
  ni asset de Vite; AGENTS.md lo prohíbe tras romperse varias veces.)
- Baseline actual: **316 tests**.
- Do NOT `git push`.

---

### Task 1: Spike — MathML y fuente en WKWebView  ✅ HECHO (caso A)

> **Resultado (2026-07-20):** WKWebView renderiza el MathML de Temml de forma
> nativa y correcta **sin su fuente**: fracciones apiladas con raya, radicales
> con techo, `∑` e `∫` con límites arriba y abajo, raíz n-ésima con índice en
> el ángulo, y glifos `∑ ∫ ∞ α` completos. **Caso A** — la Task 4 no toca
> `app.html`.
>
> El spike además midió qué MathML emite Temml y encontró cuatro elementos que
> el mapeador de la Task 2 no cubría (`munderover`, `msubsup`, `mroot`,
> `mspace`). Ya están incorporados abajo; sin ellos la primera ecuación
> realista fallaba.

**Es una compuerta, no una entrega.** Si WKWebView no renderiza el MathML de
Temml de forma aceptable, se cae la elección de Temml y con ella el diseño
entero; enterarse con el mapeador ya escrito sería el peor orden posible.

Produce una **decisión registrada**, no código de producción. Se permite código
descartable.

**Files:**
- Modify: `apps/desktop/package.json` (dependencia `temml`)
- Temporal: un render mínimo en alguna pantalla, a revertir al final

- [ ] **Step 1: Instalar Temml**

```bash
cd apps/desktop && deno install --allow-scripts npm:temml
```

Si eso no lo agrega, editar `apps/desktop/package.json` a mano añadiendo
`"temml": "^0.12.0"` a `dependencies` y correr `deno install` desde la raíz.

- [ ] **Step 2: Render mínimo, temporal**

En `EditorScreen.svelte`, dentro del `<script>`, y renderizado en cualquier
lugar visible del editor:

```ts
import temml from "temml";

const spikeMathml = temml.renderToString(
  "E = mc^2 \\quad \\sum_{i=1}^{n} \\frac{x_i - \\bar{x}}{\\sqrt{n}} \\quad \\int_0^\\infty e^{-x} dx",
  { displayMode: true },
);
```

```svelte
<div style="padding: 1rem; background: white">{@html spikeMathml}</div>
```

- [ ] **Step 3: Mirar dentro de Tauri, NO en el navegador**

```bash
deno task dev
```

Registrar, con capturas si es posible:
1. ¿Se renderiza como matemática (fracción apilada, raíz con su radical,
   sumatoria con límites arriba y abajo) o como texto plano corrido?
2. ¿Los glifos se ven correctos o hay cuadrados/faltantes?

- [ ] **Step 4: Probar con la CSS y la fuente de Temml**

Copiar `Temml-Local.css` y `Temml.woff2` desde `node_modules/temml/dist/` a
`apps/desktop/static/fonts/`, referenciarlos **temporalmente** y comparar con
el resultado del paso 3. La pregunta que se responde es: **¿cambia algo?**

- [ ] **Step 5: Registrar la decisión**

Escribir en el reporte, explícitamente, cuál de los tres casos aplica:

- **A — sirve sin fuente**: el MathML se ve bien con la fuente del sistema. La
  Task 4 no toca `app.html`.
- **B — sirve con la fuente de Temml**: la Task 4 empotra `Temml.woff2` en
  base64 dentro de `app.html`, siguiendo el patrón ya documentado para Inter.
- **C — no sirve**: WKWebView no renderiza MathML de forma usable. **PARAR** y
  escalar: cambia la elección de Temml y hay que rediseñar.

- [ ] **Step 6: Revertir el código temporal y commitear solo la dependencia**

```bash
git checkout apps/desktop/src/lib/components/EditorScreen.svelte
git add apps/desktop/package.json deno.lock
git commit -m "Ecuaciones: dependencia Temml y spike de MathML en WKWebView"
```

---

### Task 2: Contrato del árbol y mapeador puro (TDD)

El corazón, y la parte con mejor red automática: es lógica pura, testeable en
`node` sin DOM.

**Files:**
- Modify: `packages/docx-export/src/input.ts` (tipo del árbol)
- Create: `packages/docx-export/src/math.ts`
- Test: `packages/docx-export/test/math.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `MathNode`, `MathResult`, `mathTreeToOmml(node: MathNode): MathResult`.

- [ ] **Step 1: Definir el contrato en `input.ts`**

Al final de `packages/docx-export/src/input.ts`:

```ts
/**
 * Un nodo de MathML ya parseado, en forma serializable. La capa app hace el
 * parseo (tiene DOMParser) y pasa esto; el paquete se mantiene puro y sin DOM,
 * igual que con los bytes de las imágenes de figuras.
 */
export interface MathNode {
  /** Nombre del elemento MathML: "mfrac", "msup", "mi", "mn", "mo"… */
  tag: string;
  /** Texto, solo en las hojas (mi, mn, mo, mtext). */
  text?: string;
  children?: MathNode[];
}
```

- [ ] **Step 2: Escribir el test que falla**

Crear `packages/docx-export/test/math.test.ts`:

```ts
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

  it("rechaza una sumatoria sin operando estructural", () => {
    const sum = el("munderover", leaf("mo", "∑"),
      el("mrow", leaf("mi", "i"), leaf("mo", "="), leaf("mn", "1")),
      leaf("mi", "n"));
    expect(mathTreeToOmml(sum).ok).toBe(false);
  });

  it("rechaza una integral sin operando estructural", () => {
    const integral = el("msubsup", leaf("mo", "∫"), leaf("mn", "0"), leaf("mi", "∞"));
    expect(mathTreeToOmml(integral).ok).toBe(false);
  });

  it.each(["msub", "msup"])("rechaza una integral %s de un solo límite", (tag) => {
    expect(mathTreeToOmml(el(tag, leaf("mo", "∫"), leaf("mn", "0"))).ok).toBe(false);
  });

  it("mapea la raíz n-ésima (mroot)", () => {
    expect(mathTreeToOmml(el("mroot", leaf("mi", "x"), leaf("mn", "3"))).ok).toBe(true);
  });

  it("rechaza mspace con ancho explícito", () => {
    const result = mathTreeToOmml({ tag: "mspace", attrs: { width: "0.1667em" } });
    expect(result.ok).toBe(false);
  });

  it("propaga el rechazo desde un hijo anidado", () => {
    // Lo importante: que un mtable enterrado no pase inadvertido porque el
    // padre sí es soportado.
    const frac = el("mfrac", leaf("mn", "1"), el("mtable"));
    expect(mathTreeToOmml(frac).ok).toBe(false);
  });
});
```

- [ ] **Step 3: Correr y verificar que falla**

```bash
deno task test -- math
```

Esperado: FAIL — no se resuelve `../src/math.ts`.

- [ ] **Step 4: Implementar el mapeador**

Crear `packages/docx-export/src/math.ts`. La firma y el resultado
discriminado son el contrato que usan **tanto** el exportador como el editor:

```ts
import {
  Math as DocxMath,
  MathFraction,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSubSuperScript,
  MathSum,
  MathSuperScript,
  type MathComponent,
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
    return { ok: true, children: [new MathRadical({ children: inner.children })] };
  }

  if (node.tag === "msup" && children.length === 2) {
    const base = mathTreeToOmml(children[0]!);
    if (!base.ok) return base;
    const sup = mathTreeToOmml(children[1]!);
    if (!sup.ok) return sup;
    return {
      ok: true,
      children: [
        new MathSuperScript({ children: base.children, superScript: sup.children }),
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
        new MathSubScript({ children: base.children, subScript: sub.children }),
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

  // Integrales y sumatorias con límites: Temml deja el operando como hermanos
  // posteriores, por lo que este nodo aislado no puede construir un n-ario
  // OMML correcto. Se rechaza para activar el fallback a LaTeX crudo.
  if (node.tag === "msubsup" && children.length === 3) {
    if (baseOperatorGlyph(children[0]!) === "∫") {
      return { ok: false, unsupported: "∫[operand]" };
    }
  }

  if (node.tag === "munderover" && children.length === 3) {
    const glyph = baseOperatorGlyph(children[0]!);
    return {
      ok: false,
      unsupported: glyph === "∑" ? "∑[operand]" : glyph ?? children[0]!.tag,
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
```

- [ ] **Step 5: Exportar los tipos desde el índice del paquete**

Sin esto la Task 3 no compila: importa `MathNode` desde `@tesina/docx-export`,
y `index.ts` reexporta tipo por tipo, no con `export *`.

En `packages/docx-export/src/index.ts`, agregar al bloque `export type {…}` que
ya existe:

```ts
export type {
  ExportImage,
  ExportInput,
  ExportSettings,
  ExportTitlePage,
  FontChoice,
  MathNode,
  PaperSize,
  PaperVariant,
} from "./input.ts";
```

Y exportar el mapeador y su resultado:

```ts
export { mathTreeToOmml, toDocxMath, type MathResult } from "./math.ts";
```

`mathTreeToOmml` cruza la frontera del paquete a propósito: el editor lo llama
para su aviso (Task 7). Es lo que garantiza que editor y `.docx` no discrepen.

- [ ] **Step 6: Correr y verificar que pasa**

```bash
deno task test -- math
```

Esperado: PASS. Total de la suite: **328** (316 + 12).

- [ ] **Step 7: Verificación completa y commit**

```bash
deno task check && deno task test && deno fmt && deno lint
git add packages/docx-export/src/math.ts packages/docx-export/src/input.ts packages/docx-export/src/index.ts packages/docx-export/test/math.test.ts
git commit -m "Ecuaciones: mapeador puro de MathML a OMML"
```

---

### Task 3: MathML → árbol plano, en la capa app (TDD)

Esta tarea **es testeable gracias al entorno jsdom que agregó el PR #15**: es
el primer consumidor nuevo de esa infraestructura.

**Files:**
- Create: `apps/desktop/src/lib/editor/mathml.ts`
- Test: `apps/desktop/src/lib/editor/mathml.test.ts`

**Interfaces:**
- Consumes: `MathNode` de `@tesina/docx-export`.
- Produces: `latexToMathTree(latex: string): MathNode | null` y
  `latexToMathml(latex: string): string`.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/desktop/src/lib/editor/mathml.test.ts`:

```ts
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
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
deno task test -- mathml
```

Esperado: FAIL — no se resuelve `./mathml.ts`.

- [ ] **Step 3: Implementar**

Crear `apps/desktop/src/lib/editor/mathml.ts`:

```ts
import temml from "temml";
import type { MathNode } from "@tesina/docx-export";

/**
 * LaTeX → MathML. Vive en la capa app porque el parseo necesita DOMParser, y
 * `docx-export` es puro y sin DOM. Mismo reparto que los bytes de las
 * imágenes de figuras.
 */
export function latexToMathml(latex: string): string {
  return temml.renderToString(latex, { displayMode: true, throwOnError: true });
}

/** Convierte un elemento del DOM al árbol plano serializable del contrato. */
function elementToNode(element: Element): MathNode {
  const children = Array.from(element.children);
  if (children.length === 0) {
    return { tag: element.tagName, text: element.textContent ?? "" };
  }
  return { tag: element.tagName, children: children.map(elementToNode) };
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
```

- [ ] **Step 4: Correr, verificar, commitear**

```bash
deno task test -- mathml
deno task check && deno task test && deno fmt && deno lint
git add apps/desktop/src/lib/editor/mathml.ts apps/desktop/src/lib/editor/mathml.test.ts
git commit -m "Ecuaciones: LaTeX a árbol de MathML en la capa app"
```

Esperado: **334** tests (330 + 4).

---

### Task 4: Nodo `apaEquation`, node view y CSS del editor

**Files:**
- Modify: `apps/desktop/src/lib/editor/blocks.ts`
- Modify: `apps/desktop/src/lib/editor/apa.css`
- Modify: `apps/desktop/src/lib/editor/sections.ts` (permitir el nodo en el cuerpo)
- Modify: `apps/desktop/src/app.html` **solo si el spike dio el caso B**

- [ ] **Step 1: El nodo**

En `blocks.ts`, siguiendo el patrón de `Figure`:

```ts
export const ApaEquation = Node.create({
  name: "apaEquation",
  group: "block",
  atom: true,
  draggable: false,
  addAttributes() {
    return { latex: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-apa-equation]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-apa-equation": "true", class: "apa-equation" }];
  },
  // NodeView: renderiza el MathML con temml.render y agrega el lápiz,
  // reusando createMenuToggle (Escape + presión afuera ya resueltos).
});
```

- [ ] **Step 2: El CSS**

En `apa.css`:

```css
/* Ecuación desplegada (APA): centrada, con su número a la derecha. A
   diferencia de "Tabla N"/"Table N", el número es "(1)" en ambos idiomas,
   así que este es el único bloque numerado que no necesita data-doclang. */
.apa-editor .tiptap .apa-equation {
  counter-increment: apa-equation;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  margin: 1em 0;
}

.apa-editor .tiptap .apa-equation::after {
  content: "(" counter(apa-equation) ")";
  position: absolute;
  right: 0;
}
```

Y agregar `apa-equation` al `counter-reset` que ya existe en `.apa-editor .tiptap`.

- [ ] **Step 3: La fuente, solo si el spike dio caso B**

Si el spike concluyó que hace falta `Temml.woff2`, empotrarla en base64 dentro
de `apps/desktop/src/app.html`, **con el mismo procedimiento documentado para
Inter** y un comentario que explique por qué está ahí. Si el spike dio caso A,
saltar este paso.

- [ ] **Step 4: Verificar, autofixer, commitear**

Incluye verificación visual en Tauri: insertar una ecuación, ver que se
renderiza centrada y numerada, y que el lápiz abre su menú.

---

### Task 5: Preview

**Files:**
- Modify: `apps/desktop/src/lib/preview/renderEssayHtml.ts`
- Test: `apps/desktop/src/lib/preview/renderEssayHtml.test.ts`

- [ ] **Step 1: Contador en el estado del render**

Agregar `equationNo: { n: number }` a `RenderState`, junto a `tableNo` y
`figureNo`.

- [ ] **Step 2: La función**

```ts
/** Ecuación desplegada: MathML centrado con su número a la derecha. */
function apaEquationHtml(block: PMJson, state: RenderState): string {
  state.equationNo.n += 1;
  const latex = (block.attrs?.["latex"] as string | undefined) ?? "";
  const mathml = state.mathml.get(latex) ?? "";
  return `<div class="apa-equation">${mathml}<span class="eq-no">(${state.equationNo.n})</span></div>`;
}
```

El MathML llega ya renderizado desde la capa app (igual que `imageUrls`),
porque `renderEssayHtml` es una función pura y Temml necesita ejecutarse en el
navegador.

- [ ] **Step 3: CSS de la preview y el caso en `blocksHtml`**

- [ ] **Step 4: Snapshot y commit**

---

### Task 6: DOCX — visitor y golden

**Files:**
- Modify: `packages/docx-export/src/pm-visitor.ts`
- Modify: `packages/docx-export/src/input.ts` (mapa de árboles por LaTeX)
- Modify: `packages/docx-export/src/sample.ts`
- Modify: `packages/docx-export/test/export.test.ts`

- [ ] **Step 1: El mapa en el contrato**

Junto a `images?: Record<string, ExportImage>`:

```ts
/** Árboles de MathML ya parseados, indexados por su LaTeX. Los produce la
 *  capa app, que es la que tiene DOMParser. */
equations?: Record<string, MathNode>;
```

- [ ] **Step 2: El caso en el visitor**

Junto a `case "figure"`, un `case "apaEquation"` que llame al mapeador y, según
el resultado, emita el `Math` en un párrafo centrado con su número, o el LaTeX
como `TextRun` de fallback.

- [ ] **Step 3: Fixture, asserts sobre el XML, y un caso NO soportado**

El golden tiene que cubrir las dos ramas: una ecuación que mapea y una que cae
en el fallback. Es lo que evita que el fallback se rompa en silencio.

- [ ] **Step 4: Verificar y commitear**

---

### Task 7: Insertar, editar y avisar

> **Corrección al plan (2026-07-20).** Este plan diseñó el esquema, los tres
> renderizadores y la exportación, pero **ninguna tarea agregaba forma de
> insertar una ecuación**. La feature habría quedado completa e inutilizable:
> hoy solo se llega por `editor.chain().insertContentAt(...)` a mano. Lo detectó
> el implementador de la Task 4. Se amplía esta tarea en vez de crear una
> octava, porque insertar y editar comparten el mismo cuadro de LaTeX.

**Alcance:** botón en la barra + cuadro de LaTeX (para insertar y para editar
una existente) + marca de no exportable.

**Files:**
- Modify: `apps/desktop/src/lib/components/EditorScreen.svelte` (botón de la barra)
- Create: `apps/desktop/src/lib/components/EquationDialog.svelte`
- Modify: `apps/desktop/src/lib/editor/blocks.ts` (el lápiz abre el cuadro; marca)
- Modify: `apps/desktop/src/lib/editor/apa.css`
- Modify: `apps/desktop/messages/{en,es}.json`

- [ ] **Step 1: El cuadro de LaTeX**

`EquationDialog.svelte`, sobre el `Modal.svelte` que ya existe (trae Escape y
clic en overlay). Un `<textarea>` con el LaTeX y una **vista previa en vivo**
del MathML debajo, usando `latexToMathml`. Si el LaTeX es inválido,
`latexToMathTree` devuelve `null` y el cuadro lo dice sin romperse.

- [ ] **Step 2: Conectar el mapa de ecuaciones en la exportación**

Hueco detectado por el implementador de la Task 6: `ExportInput.equations`
existe y el visitor lo consume, pero **nadie lo llena**, así que hoy toda
exportación real cae al fallback de LaTeX crudo aunque la ecuación sea
perfectamente mapeable.

En `apps/desktop/src/lib/export/exportEssay.ts`, recorrer el documento
juntando los `latex` de cada `apaEquation`, convertir cada uno con
`latexToMathTree` (de `$lib/editor/mathml.ts`) y pasar el `Record` resultante
como `equations`. Es el mismo patrón con el que ya se juntan los bytes de las
imágenes de figuras.

- [ ] **Step 3: Botón en la barra**

Junto al de Figura en `EditorScreen.svelte`, con `data-tip` y `aria-label`
(obligatorio: en los docks laterales la etiqueta se oculta con `display: none`
y sale del árbol de accesibilidad). Abre el cuadro; al confirmar inserta
`{ type: "apaEquation", attrs: { latex } }`.

- [ ] **Step 4: El lápiz abre el mismo cuadro**

El node view ya tiene lápiz. Su menú hoy solo borra; se le agrega "editar",
que abre el cuadro con el LaTeX actual y al confirmar actualiza el atributo.

- [ ] **Step 5: La marca de no exportable**

El node view llama `mathTreeToOmml` —**el mismo que usa el exportador**— y si
devuelve `ok: false` marca la ecuación con un estilo de advertencia y el
`reason` como tooltip. Sin predicado aparte: es la garantía de que el editor y
el `.docx` no puedan discrepar.

- [ ] **Step 6: Cadenas en ambos JSON**

En lenguaje no técnico, como el aviso del autollenado por URL: el usuario no
tiene por qué saber qué es OMML. Hacen falta al menos: título del cuadro,
etiqueta del textarea, insertar, cancelar, editar, y el aviso de no exportable.

- [ ] **Step 7: Verificar, autofixer, commitear**

- [ ] **Step 8: Verificación manual final**

1. Insertar desde la barra una ecuación simple → se ve en editor y preview.
2. Editarla con el lápiz → cambia.
3. Insertar `\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}` → queda marcada
   como no exportable, y en el `.docx` sale el LaTeX crudo.
4. Insertar `\\prod_{i=1}^{n} x` → **también marcada**: `docx` no tiene clase de
   productorio y mapearlo a `MathSum` daría una sumatoria, que es matemática
   incorrecta.
5. **Abrir el `.docx` en Word** y confirmar que la ecuación soportada es
   editable como ecuación nativa. Los goldens verifican estructura, no
   apariencia.

---

## Notas

**El spike es una compuerta.** Si Task 1 concluye caso C, **el plan se detiene**
y hay que rediseñar: todo lo demás asume que Temml sirve.

**Dónde está la red y dónde no.** Las tareas 2 y 3 son lógica pura o casi, con
TDD real. Las 4, 5 y 7 son mayormente presentación y se verifican a mano, como
los PRs #13 y #14. La 6 tiene goldens de XML. La fidelidad visual en Word no la
cubre ningún test automático — de ahí el paso manual final.

**La Task 3 estrena el jsdom del PR #15.** Es el primer consumidor nuevo de esa
infraestructura, y la razón por la que el parseo de MathML no queda sin cubrir.

**El orden no es arbitrario:** primero la compuerta, después el núcleo puro y
testeable (2 y 3), y recién al final la presentación. Así el riesgo se resuelve
temprano y lo difícil de testear queda apoyado sobre algo ya probado.

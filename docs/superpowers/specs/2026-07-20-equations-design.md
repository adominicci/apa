# Ecuaciones en bloque, numeradas

**Fecha:** 2026-07-20
**Estado:** aprobado, pendiente de implementar

## Alcance

Ecuaciones **desplegadas**: centradas en su propio renglón, numeradas `(1)`,
`(2)`… a la derecha. Es el caso que contempla APA. Se escriben en LaTeX y se
exportan al `.docx` como **ecuaciones nativas de Word**, editables ahí dentro.

**Fuera de v1:** matemática en línea dentro del párrafo. En DOCX no sería más
difícil (`Math` ya es un `ParagraphChild`), pero duplica la superficie: nodo
inline en ProseMirror con otras reglas y una UX de edición bastante más
delicada. Queda como continuación natural.

## Decisiones acordadas

| Decisión | Elección |
|---|---|
| Fidelidad en DOCX | Ecuación nativa de Word (OMML), no imagen |
| Tipos en v1 | Solo bloque, numeradas |
| Fuera del subconjunto soportado | Aviso en el editor + LaTeX crudo en el DOCX |

## La cadena

```text
LaTeX  ← lo único que se guarda en el documento
  └─ Temml ─→ MathML ─┬─→ editor y preview (WebKit lo renderiza nativo)
                      └─→ árbol plano ─→ objetos Math de docx (OMML)
```

Una sola dependencia sirve a los tres renderizadores y MathML queda como
representación intermedia única.

### Decisión de fuentes validada por el spike

> **Nota supersedida:** antes del spike se asumió que harían falta
> `Temml-Local.css` y `Temml.woff2`. Esa hipótesis no es un requisito de
> implementación.

Eso lo vuelve un riesgo de primer orden en este repo, no un detalle: AGENTS.md
dedica una sección entera a que las fuentes entregadas por Vite se rompían una
y otra vez —HMR las descartaba, los `url()` daban 404 en el dev server de
Tauri— hasta que Inter terminó **empotrada en base64 dentro de `app.html`**,
fuera del grafo de módulos de Vite.

**Resuelto por el spike (2026-07-20): no hacen falta.** WKWebView renderiza el
MathML de Temml de forma nativa y correcta con las fuentes del sistema —
fracciones apiladas con su raya, radicales con techo, `∑` e `∫` con sus límites
arriba y abajo, raíz n-ésima con el índice en el ángulo, y los glifos `∑ ∫ ∞ α`
completos, sin cuadrados ni faltantes.

Así que **no se toca `app.html`** y no hay `.woff2` que empotrar. Nos ahorramos
entero el riesgo de fuentes que documenta AGENTS.md.

Si algún día hiciera falta, el único camino admitido sigue siendo empotrarla en
base64 en `app.html` como Inter. **Nunca** como `import` de CSS ni asset suelto
de Vite: es lo que AGENTS.md prohíbe explícitamente tras romperse varias veces.

## Arquitectura

### 1. El nodo — `editor/blocks.ts`

`apaEquation`: bloque, `atom: true`, un solo atributo `latex: string`. Más
simple que `figure`, que lleva título, imagen y nota; acá no hay contenido
editable en línea — el LaTeX se edita en un cuadro y lo que se muestra es el
MathML renderizado.

Node view con el mismo lápiz que ya usan tabla y figura, reusando
`createMenuToggle` de `blocks.ts` (Escape + presión afuera ya resueltos).

### 2. CSS del editor — `editor/apa.css`

Centrada, `counter-increment: apa-equation`, y el número por `::after` con
`content: "(" counter(apa-equation) ")"` alineado a la derecha.

**No necesita `data-doclang`.** A diferencia de "Tabla N" / "Table N", el
número de ecuación es `(1)` en los dos idiomas. Es el único de los tres
bloques numerados que no toca el eje de idioma del documento.

### 3. Preview — `preview/renderEssayHtml.ts`

`apaEquationHtml()` emite el MathML más el número, siguiendo el patrón de
`apaTableHtml` / `apaFigureHtml`. La numeración se cuenta en orden de
documento, **calculada en tiempo de render y nunca guardada**, como exige
AGENTS.md.

### 4. DOCX — el punto delicado

El mapeador necesita **parsear MathML**, pero `docx-export` es un paquete puro:
no tiene DOM y sus tests corren en `node`.

La solución tiene precedente explícito en AGENTS.md, en las imágenes de
figuras:

> *bytes are read at the app layer and passed to the pure packages — never data
> URLs, never Tauri imports inside `apa-engine`/`docx-export`*

Mismo reparto acá:

- **Capa app** (tiene `DOMParser`): LaTeX → Temml → MathML → **árbol plano
  serializable**.
- **`docx-export`** (puro): árbol → objetos `Math` de `docx`. Sin dependencias
  nuevas, sin DOM, testeable en `node`.

El árbol plano es el contrato entre ambos, y por eso vive en
`docx-export/src/input.ts`, que AGENTS.md ya designa como el único contrato de
datos sancionado.

En el `.docx` la ecuación usa tabulaciones de centro y derecha para mantener el
`Math` centrado y su número pegado al margen derecho. Verificado contra los
tipos de `docx@9`: `Math` acepta
`{ children: readonly MathComponent[] }` y **está incluido en
`ParagraphChild`**.

### 5. Goldens

Fixture en `docx-export/src/sample.ts` con asserts sobre el XML, y un snapshot
en `renderEssayHtml.test.ts`. Los cinco puntos de sincronización de AGENTS.md
tienen que caer en el mismo commit.

## Subconjunto de v1

La unión `MathComponent` de `docx@9` es:

```ts
MathRun | MathFraction | MathSum | MathIntegral | MathSuperScript |
MathSubScript | MathSubSuperScript | MathRadical | MathFunction |
MathRoundBrackets | MathCurlyBrackets | MathAngledBrackets | MathSquareBrackets
```

### Corrección: el subconjunto lo dicta Temml, no `docx`

Una primera versión de este spec decía que el subconjunto de v1 «es exactamente
esa unión». **Está al revés.** El spike midió qué MathML emite Temml de verdad,
y el subconjunto real lo determina la **salida** de Temml, no la **entrada** de
`docx`:

| Construcción | Elementos que emite Temml |
|---|---|
| fracción, potencia, raíz | `mfrac` `msup` `msqrt` `mi` `mn` `mo` `mrow` `mspace` |
| sumatoria con límites | `munderover` → fallback a LaTeX crudo |
| integral con límites | `msub`, `msup` o `msubsup` con operador integral Unicode estándar (`∫`–`∳`) o suplementario (`⨋`–`⨜`) → fallback a LaTeX crudo |
| integral compuesta | base `∫⋯∫` o la base elíptica que Temml emite para `\\idotsint` → fallback a LaTeX crudo |
| raíz n-ésima | `mroot` |
| texto | `mtext` |
| paréntesis `\left(…\right)` | `mo` `mrow` — **sin elemento de fence** |
| matriz | `mtable` `mtr` `mtd` → no soportado |

Dos consecuencias que no se ven razonando sobre las APIs por separado:

1. **`mspace` aparece en ecuaciones básicas.** Solo los nodos sin atributos o
   con clase interna son descartables; un ancho u otro atributo explícito usa
   el fallback porque OMML no puede reconstruir ese espaciado con fidelidad.
2. **Los cuatro tipos de paréntesis de `docx` son inalcanzables.** Temml emite
   `<mo>(</mo>`, un operador suelto, no un elemento de agrupación. Así que
   `MathRoundBrackets` y sus tres hermanos nunca se construyen: los paréntesis
   llegan a Word como caracteres dentro de un `MathRun`.

   El spike visual mostró la consecuencia exacta: en la app **los paréntesis sí
   se estiran** alrededor de la fracción, porque WebKit estira el `<mo>` por su
   cuenta. En Word serán caracteres de altura fija. Es la única discrepancia
   conocida donde **la app se ve mejor que el `.docx`**, y conviene tenerla
   presente antes de que aparezca como "bug" de exportación. Aceptable en v1.

El subconjunto editable real, entonces: `math` `mrow` `mstyle`, `mspace` sin
atributos visibles, las
hojas compatibles (`mi` `mn` `mo` `ms`), `mfrac`, `msqrt`, `mroot`, `msup`,
`msub` y `msubsup` cuando no representan una integral. `mtext`, sumatorias e
integrales con límites usan el fallback de LaTeX crudo: Temml deja el operando
como hermanos posteriores y no permite determinar su alcance sin heurísticas
que podrían cambiar el significado matemático.

### Matrices: techo de la librería, no decisión de alcance

`docx@9` **no expone ningún tipo de matriz** — no hay `MathMatrix`,
`MathEqArray` ni equivalente. Así que matrices y sistemas de ecuaciones quedan
afuera por un límite de la herramienta, no por recorte nuestro, y "ampliar el
subconjunto más adelante" no alcanza para cubrirlos.

Sí hay escotilla conocida para una versión futura: `ImportedXmlComponent
.fromXmlString()` permite inyectar OMML crudo, con lo que se podría emitir el
elemento `<m:m>` a mano. Es un camino distinto al de las clases tipadas —
más frágil, sin ayuda del compilador — y por eso no entra en v1.

Mientras tanto una matriz cae en el fallback como cualquier otra construcción
no soportada: aviso en el editor y LaTeX crudo en el `.docx`.

## El aviso y la exportación no pueden discrepar

No hay un predicado `esExportable()` aparte del mapeador: **es el mapeador
mismo**, que devuelve un resultado discriminado.

```ts
type MathResult =
  | { ok: true; children: MathComponent[] }
  | { ok: false; reason: string };  // qué elemento no se cubre
```

El exportador usa `children`; el editor llama exactamente lo mismo y descarta
el payload, quedándose solo con `ok`. Un predicado separado sería una segunda
implementación de las mismas reglas, y con el tiempo se desincronizaría del
mapeador — que es justo el modo de falla que este diseño quiere evitar: el
editor diciendo que algo se exporta bien y el `.docx` saliendo con LaTeX crudo.

Que el editor pueda llamarlo ya tiene precedente: `renderEssayHtml.ts` importa
de `@tesina/docx-export` hoy.

El fallback nunca hace fallar la exportación: la ecuación no soportada sale
como su LaTeX en texto plano y el resto del documento queda intacto. Sigue el
precedente del autollenado por URL, que ya avisa en lenguaje no técnico cuando
no puede leer una página.

## Dependencias

`temml` (MIT, ~10 kb de fuente) en `apps/desktop`. **Ninguna nueva en
`docx-export`.** Cumple la política del repo: solo MIT / Apache-2 / ISC / BSD /
OFL, nada de AGPL.

## Pruebas

A diferencia de los últimos cambios, acá hay red automática de verdad, porque
lo que puede romperse es lógica pura:

- **Mapeador** (`docx-export`, `node`, sin DOM): árbol de entrada → objetos de
  salida, para cada miembro del subconjunto; y los casos no soportados,
  incluida la función pura que decide si algo es exportable.
- **Goldens de DOCX**: asserts sobre el XML generado, como el resto del
  paquete.
- **Snapshot de la preview**: MathML y numeración.

Lo que sí queda manual es el renderizado de MathML en WKWebView (ver riesgos).

## Riesgos

- **MathML y la fuente de Temml en WKWebView.** Es el riesgo mayor y por eso el
  spike es la primera tarea del plan, antes de escribir una línea del mapeador.
  Responde dos cosas: si WKWebView renderiza el MathML de Temml de forma
  aceptable, y si hace falta su `.woff2`. Si el renderizado no sirve, se cae la
  elección de Temml y con ella el diseño entero — enterarse con el mapeador ya
  escrito sería el peor orden posible. La app arrastra sorpresas de WKWebView
  documentadas en `apa.css` (flex + `aspect-ratio`) y en AGENTS.md (fuentes vía
  Vite).
- **Fidelidad del mapeo.** Que Temml produzca MathML válido no garantiza que
  el OMML resultante se vea igual en Word. Los goldens verifican estructura,
  no apariencia; hace falta abrir un `.docx` en Word de verdad al menos una
  vez.
- **Superficie de LaTeX.** El usuario puede escribir cualquier cosa; Temml
  cubre mucho más que nuestro subconjunto de OMML. El aviso temprano es lo que
  hace que ese desfase no sorprenda al entregar.

## Archivos

| Archivo | Cambio |
|---|---|
| `apps/desktop/package.json` | dependencia `temml` |
| `editor/blocks.ts` | nodo `ApaEquation` + node view con lápiz |
| `editor/apa.css` | centrado, contador y número `(N)` |
| `preview/renderEssayHtml.ts` | `apaEquationHtml()` + CSS |
| `apps/desktop/src/lib/editor/mathml.ts` | **nuevo** — MathML → árbol plano (capa app, usa DOMParser) |
| `docx-export/src/math.ts` | **nuevo** — árbol → objetos `Math`; función pura de soporte |
| `docx-export/src/input.ts` | el tipo del árbol plano (contrato) |
| `docx-export/src/pm-visitor.ts` | visita `apaEquation` |
| `docx-export/src/sample.ts` | fixture del golden |
| `messages/{en,es}.json` | cadenas del cuadro de edición y del aviso |

## Verificación

Desde la raíz: `deno task check` (0 errores, 0 warnings), `deno task test`,
`deno fmt`, `deno lint`. Todo `.svelte` tocado pasa además el autofixer del MCP
de Svelte. Verificación manual en Tauri para el renderizado, y un `.docx`
abierto en Word para la fidelidad.

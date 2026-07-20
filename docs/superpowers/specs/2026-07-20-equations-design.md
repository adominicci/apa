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

```
LaTeX  ← lo único que se guarda en el documento
  └─ Temml ─→ MathML ─┬─→ editor y preview (WebKit lo renderiza nativo)
                      └─→ árbol plano ─→ objetos Math de docx (OMML)
```

Una sola dependencia sirve a los tres renderizadores y MathML queda como
representación intermedia única. El editor y la preview no necesitan CSS ni
fuentes de matemática: WebKit renderiza MathML de forma nativa.

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

En el `.docx` la ecuación es un párrafo centrado que contiene el `Math` y su
número. Verificado contra los tipos de `docx@9`: `Math` acepta
`{ children: readonly MathComponent[] }` y **está incluido en
`ParagraphChild`**.

### 5. Goldens

Fixture en `docx-export/src/sample.ts` con asserts sobre el XML, y un snapshot
en `renderEssayHtml.test.ts`. Los cinco puntos de sincronización de AGENTS.md
tienen que caer en el mismo commit.

## Subconjunto de v1

La unión `MathComponent` de `docx@9` es:

```
MathRun | MathFraction | MathSum | MathIntegral | MathSuperScript |
MathSubScript | MathSubSuperScript | MathRadical | MathFunction |
MathRoundBrackets | MathCurlyBrackets | MathAngledBrackets | MathSquareBrackets
```

El subconjunto de v1 es exactamente esa unión: fracciones, raíces,
sub/superíndices, sumatorias, integrales, funciones, los cuatro tipos de
paréntesis, y texto/símbolos sueltos (griegas y operadores entran como
`MathRun`). Cubre la matemática de una tesina de ciencias sociales, que es el
usuario real de esta app.

Que el subconjunto coincida con lo que la librería ya modela no es casualidad
buscada sino una señal de que está bien calibrado: no hay que inventar
representación para nada de lo que se soporta.

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

- **MathML en WKWebView.** WebKit lo soporta nativo, pero la app ya arrastra
  sorpresas de WKWebView documentadas en `apa.css` (flex + `aspect-ratio`) y en
  AGENTS.md (fuentes vía Vite). **Verificar dentro de Tauri, no en el
  navegador**, y temprano: si el renderizado no sirve, cambia la elección de
  Temml y conviene saberlo antes de escribir el mapeador.
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

# Barra de herramientas acoplable (arriba / abajo / izquierda / derecha)

**Fecha:** 2026-07-19
**Estado:** aprobado, pendiente de implementar

## Problema

La barra flotante del editor (`.float-menu`) está fija abajo y centrada. No se
puede mover. Se quiere poder acoplarla a los cuatro bordes; en los laterales la
barra debe pasar a solo íconos, con un tooltip al pasar el mouse.

El obstáculo real no es mover la barra: son los **cinco desplegables** que
cuelgan de ella (Headings, Lists, Table, Font, CitationPopover). Los cuatro
primeros definen `.menu-pop` en su propio `<style>` con
`bottom: calc(100% + 10px); left: 50%; transform: translateX(-50%)`
—es decir, "abrir hacia arriba y centrado"— **duplicado idéntico salvo el
`min-width`** (220 / 190 / 200 / 230 px). Con la barra arriba o a un lado, cada
uno tiene que voltearse.

## Decisiones de UX (acordadas)

| Decisión | Elección |
|---|---|
| Cómo se cambia la posición | Menú dentro de la barra misma |
| Etiquetas de texto | Automático: arriba/abajo con texto, laterales solo íconos |
| Anclaje de los laterales | Al borde de la columna del canvas, no al de la ventana |
| Tooltip | Propio, con tokens de diseño, disparado por hover **y** foco |

Los laterales de la ventana ya están ocupados por el panel de esquema (248 px) y
el de referencias (312 px). Anclar al canvas mantiene ambos paneles usables.

## Arquitectura

### 1. Estado y persistencia — `lib/state/uiLocale.svelte.ts`

```ts
export type ToolbarDock = "bottom" | "top" | "left" | "right";
```

En `UiSettingsStore`, junto a idioma y tema:

- `dock = $state<ToolbarDock>("bottom")`
- `AppSettings.toolbarDock?: ToolbarDock` — **opcional**
- `load()`: `if (settings?.toolbarDock) this.dock = settings.toolbarDock;`
- `setDock(dock: ToolbarDock)`: asigna y persiste (mismo patrón que `setTheme`)

`schemaVersion` de `settings.json` **se queda en 1**. El campo es opcional, así
que un `settings.json` previo simplemente cae en el default `"bottom"`. Esto no
tiene relación con el `schemaVersion: 2` de los ensayos, que AGENTS.md prohíbe
tocar: es otro archivo, con su propio versionado.

Es preferencia de aplicación, no de documento — igual que el tema.

### 2. Componente — `lib/components/Toolbar.svelte` (nuevo)

`Toolbar.svelte` es **solo el contenedor**, no la barra entera.

```ts
props: dock: ToolbarDock
       onDockChange: (d: ToolbarDock) => void
       children: Snippet
```

Renderiza `<div class="float-menu" data-dock={dock}>`, el selector de posición,
y `{@render children()}`.

**Los botones se quedan en `EditorScreen.svelte`.** Extraer la barra completa
exigiría ~18 props (`editor`, `library`, `documentLanguage`, `openMenu`,
`activeList`, `inTable`, `exporting`, `words`, …), una interfaz más costosa que
el problema que resuelve. El contenedor tiene una sola responsabilidad
—posicionar la barra y dejar cambiarla de lugar— y una interfaz de 2 props.

### 3. Anclaje — variables que espejan el grid

La barra sigue siendo `position: fixed`. Es obligatorio: `.canvas` es
`overflow-y: auto`, así que un `position: absolute` adentro se iría con el
scroll.

Los offsets laterales salen de variables definidas en `.app` (el contenedor raíz
que envuelve header, shell, barra y footer):

```css
.app            { --outline-w: 248px; --refs-w: 312px; --header-h: 40px; }
.app.no-outline { --outline-w: 0px; }
.app.no-refs    { --refs-w: 0px; }
.app.focus      { --outline-w: 0px; --refs-w: 0px; }

.shell { grid-template-columns: var(--outline-w) 1fr var(--refs-w); }
```

Las clases de estado (`no-outline`, `no-refs`, `focus`) hoy están en `.shell`;
se suben a `.app` para que tanto el grid como la barra lean las mismas
variables.

`--header-h` es 40 px: el `.titlebar` declara `height: 40px` y su
`border-bottom: 1px` queda **dentro** de esa altura, porque `tokens.css` aplica
`box-sizing: border-box` a todo (`*, *::before, *::after`). La barra es
`position: fixed`, así que sin este offset el dock superior quedaría **encima
del header**.

> Corregido durante la implementación: una primera versión decía 41 px, sumando
> el borde a la altura. Ese es el modelo content-box, que acá no aplica.

Posiciones:

```css
.float-menu[data-dock="bottom"] { left: 50%; bottom: 40px; transform: translateX(-50%); }
.float-menu[data-dock="top"]    { left: 50%; top: calc(var(--header-h) + 16px); transform: translateX(-50%); }

.float-menu[data-dock="left"],
.float-menu[data-dock="right"] {
  top: calc(var(--header-h) + 16px);
  bottom: 16px;
  margin-block: auto;      /* centra en la banda disponible */
  height: max-content;
  flex-direction: column;
}
.float-menu[data-dock="left"]  { left:  calc(var(--outline-w) + 16px); }
.float-menu[data-dock="right"] { right: calc(var(--refs-w) + 16px); }
```

El centrado vertical usa `top` + `bottom` + `margin-block: auto` en lugar de
`top: 50%; transform: translateY(-50%)`. Razón: el `.statusbar` no tiene altura
fija (es `padding` + tamaño de fuente), así que no hay un `--footer-h` confiable
que restar. Con esta técnica la barra se centra en la banda que queda bajo el
header sin depender de la altura del footer, y si algún día la barra fuera más
alta que la banda, crece hacia abajo en vez de desbordar hacia arriba tapando el
header.

Beneficio secundario: las **cuatro** reglas `grid-template-columns` de `.shell`
colapsan en **una**, y los anchos pasan a tener una sola fuente de verdad. La
barra se desliza en sincronía al colapsar un panel o entrar en modo foco, porque
hereda la transición de 220 ms que ya existe.

### 4. Volteo de los desplegables — consolidar `.menu-pop`

El núcleo del trabajo. `.menu-pop` se consolida en `float-menu.css`, que **ya es
global a propósito** (su comentario de cabecera lo documenta: para que los menús
sueltos rendericen triggers idénticos a los botones definidos en EditorScreen).

Los cuatro menús borran su bloque `.menu-pop` y conservan solo su ancho:

```css
/* en cada componente */ .menu-wrap { --pop-min-w: 190px; }
/* en float-menu.css  */ .menu-pop  { min-width: var(--pop-min-w, 200px); /* …base… */ }
```

Y las cuatro variantes, una sola vez:

```css
.float-menu[data-dock="bottom"] .menu-pop { bottom: calc(100% + 10px); left: 50%; transform: translateX(-50%); }
.float-menu[data-dock="top"]    .menu-pop { top:    calc(100% + 10px); left: 50%; transform: translateX(-50%); }
.float-menu[data-dock="left"]   .menu-pop { left:   calc(100% + 10px); top: 0; }
.float-menu[data-dock="right"]  .menu-pop { right:  calc(100% + 10px); top: 0; }
```

Funciona cruzando fronteras de componente porque el popover es descendiente del
DOM de `.float-menu`. Especificidad: `0,3,0` contra el `0,2,0` que agrega el
scoping de Svelte, así que gana sin `!important`.

Mismo tratamiento para `.pop` de `CitationPopover`, cuyo override vive hoy en
`EditorScreen` (`.fab-cite :global(.pop)`).

**Se sale con menos duplicación de la que se entra:** 4 copias → 1, y la lógica
nueva de volteo se escribe una sola vez en lugar de cuatro.

### 5. Modo solo-íconos y tooltip

- Las etiquetas de los `.fm-btn` se envuelven en un `<span class="fm-label">`;
  `[data-dock="left"|"right"] .fm-label { display: none; }`.
- Tooltip: `::after` con `content: attr(data-tip)`, disparado por `:hover` **y
  `:focus-visible`** — funciona también navegando con teclado, que es donde el
  `title` nativo falla. Sale hacia el canvas: a la derecha si la barra está a la
  izquierda, y viceversa.
- `.fm-sep` pasa de vertical a horizontal.
- `.fm-count` se oculta en vertical: el `footer.statusbar` ya muestra
  "N palabras · N páginas · N referencias", así que no se pierde información.

### 6. Selector de posición

Un botón dentro de `Toolbar.svelte` (siempre presente, sea cual sea el
`children` que reciba) que abre un `.menu-pop` con las cuatro opciones,
reutilizando el patrón `.mi` que ya usan los otros menús. Íconos SVG propios:
un rectángulo con una barra en el borde correspondiente.

### 7. i18n

Cinco cadenas nuevas en `messages/en.json` y `messages/es.json`:
`toolbar_position`, `toolbar_pos_bottom`, `toolbar_pos_top`,
`toolbar_pos_left`, `toolbar_pos_right`.

Los tooltips **reutilizan los `m.*()` que ya tiene cada botón** — cero cadenas
nuevas ahí. Todo es eje UI (Paraglide, `uiLocale.current`), no eje documento.

## Pruebas

El repositorio **no tiene tests de componentes Svelte** (cero archivos) y esta
feature es casi enteramente CSS. Los 301 tests actuales cubren funciones puras y
ninguno se ve afectado.

Lo que sí es genuinamente testeable es la persistencia, que es donde puede
romperse en silencio. Tests nuevos sobre `UiSettingsStore`:

1. `setDock("left")` persiste el valor y `load()` lo restaura.
2. Un `settings.json` **sin** `toolbarDock` carga como `"bottom"`
   (compatibilidad hacia atrás con instalaciones existentes).
3. `setDock` con el valor actual no vuelve a escribir (igual que `setTheme`).

El resto se verifica visualmente: 4 posiciones × tema claro/oscuro, abriendo
cada uno de los 5 desplegables en cada posición. No se agregan tests de CSS que
solo re-afirmen el string de la regla sin probar comportamiento.

## Riesgos

- **`backdrop-filter` en WKWebView** con la barra en vertical. La app ya arrastra
  un bug de WebKit documentado en `apa.css` (flex + `aspect-ratio`). Verificar
  dentro de Tauri, no en el navegador.
- **Ventanas angostas:** con ambos paneles abiertos (248 + 312 = 560 px) más el
  papel de 8.5 in (816 px) más la barra lateral, hacen falta ~1400 px. Por
  debajo de eso el papel se aprieta. Mitigación: `@media (max-width: 1100px)`
  fuerza `bottom` aunque la preferencia guardada sea lateral (la preferencia no
  se sobrescribe: al agrandar la ventana vuelve a su lado).
- **Colapso de paneles:** al ocultar el esquema con la barra a la izquierda, esta
  se desliza junto con el panel. Es el comportamiento buscado, pero hay que
  confirmar que la transición no arrastre los popovers abiertos; si molesta,
  cerrar el menú abierto al cambiar de dock.

## Alcance

**Incluye:** los 6 archivos listados abajo.
**No incluye:** la bubble de selección de texto, el `<header>` de la app, y
cualquier reordenamiento de los botones dentro de la barra.

## Archivos

| Archivo | Cambio |
|---|---|
| `lib/state/uiLocale.svelte.ts` | tipo `ToolbarDock`, estado, `setDock`, persistencia |
| `lib/components/Toolbar.svelte` | **nuevo** — contenedor + selector de posición |
| `lib/components/EditorScreen.svelte` | usa `<Toolbar>`, sube clases de estado a `.app`, simplifica el grid |
| `lib/components/float-menu.css` | `.menu-pop` consolidado, variantes de dock, modo ícono, tooltip |
| `lib/components/{Heading,List,Table,Font}Menu.svelte` | borrar `.menu-pop` duplicado, dejar `--pop-min-w` |
| `messages/{en,es}.json` | 5 cadenas nuevas |

## Verificación

Según AGENTS.md, desde la raíz: `deno task check` (0 errores, 0 warnings),
`deno task test`, `deno fmt`, `deno lint`. Todo `.svelte` tocado debe pasar
además el autofixer del MCP de Svelte.

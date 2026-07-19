# Barra de herramientas acoplable — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir acoplar la barra flotante del editor a los cuatro bordes
(abajo, arriba, izquierda, derecha), con modo solo-íconos y tooltip en los
laterales.

**Architecture:** Un `data-dock` en `.float-menu` maneja todo el posicionamiento
vía CSS. Los desplegables se voltean con reglas globales en `float-menu.css`,
que alcanzan a los componentes hijos porque el popover es descendiente del DOM
de `.float-menu`. La preferencia vive en `settings.json` junto a idioma y tema.

**Tech Stack:** Svelte 5 (runes), TypeScript, Paraglide (i18n), vitest, Deno
tasks.

Spec: `docs/superpowers/specs/2026-07-19-toolbar-dock-design.md`

## Global Constraints

- Verificación obligatoria desde la raíz del repo, tras **cada** tarea:
  `deno task check` (debe dar **0 errores, 0 warnings**), `deno task test`,
  `deno fmt`, `deno lint`.
- Todo archivo `.svelte` tocado debe pasar además el **autofixer del MCP de
  Svelte** antes de commitear.
- **Nunca** hardcodear una cadena visible al usuario: va por Paraglide (`m.*()`).
  Estas cadenas son eje **UI**, no eje documento.
- **Nunca** hardcodear color: todo pasa por los tokens de
  `lib/styles/tokens.css`. Hex crudo solo dentro de los bloques de tema.
- Todo botón cuya etiqueta pueda ocultarse en modo solo-íconos lleva
  `aria-label`. `data-tip` alimenta el tooltip visual y **no** es leído por la
  tecnología asistiva; `display: none` saca la etiqueta del árbol de
  accesibilidad. Un botón sin nombre accesible es un defecto, no un detalle.
- **No** tocar `essay.schemaVersion` (es `2` y debe seguir así). El
  `schemaVersion` de `settings.json` también se queda en `1`: el campo nuevo es
  opcional.
- Los tests corren en `environment: "node"` **sin plugin de Svelte**. Por eso
  ningún archivo con runes (`$state`, `.svelte.ts`) puede importarse desde un
  test. La lógica testeable va en módulos `.ts` puros.
- `deno fmt` excluye `**/*.md`: los archivos de este plan y del spec no se
  formatean.
- Anchos de los popovers, a preservar exactamente: HeadingMenu `220px`,
  ListMenu `190px`, TableMenu `200px`, FontMenu `230px`.

---

### Task 1: Módulo puro de dock + tests

Fundación testeable. Se aísla acá porque `uiLocale.svelte.ts` usa runes y no
puede importarse desde vitest.

**Files:**
- Create: `apps/desktop/src/lib/state/toolbarDock.ts`
- Test: `apps/desktop/src/lib/state/toolbarDock.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type ToolbarDock = "bottom" | "top" | "left" | "right"`
  - `const DEFAULT_DOCK: ToolbarDock` (= `"bottom"`)
  - `const TOOLBAR_DOCKS: readonly ToolbarDock[]` (orden: bottom, top, left, right)
  - `function parseDock(value: unknown): ToolbarDock`

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/desktop/src/lib/state/toolbarDock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_DOCK, parseDock, type ToolbarDock } from "./toolbarDock.ts";

describe("parseDock", () => {
  it("acepta cada dock válido", () => {
    const docks: ToolbarDock[] = ["bottom", "top", "left", "right"];
    for (const dock of docks) {
      expect(parseDock(dock)).toBe(dock);
    }
  });

  it("cae al default cuando el campo no existe", () => {
    // Un settings.json escrito antes de esta feature no tiene toolbarDock.
    expect(parseDock(undefined)).toBe("bottom");
    expect(parseDock(null)).toBe("bottom");
  });

  it("cae al default ante valores no reconocidos", () => {
    // Un archivo editado a mano o corrupto no debe llegar a data-dock: un
    // valor desconocido no matchea ninguna regla CSS y deja la barra sin
    // posicionar.
    expect(parseDock("middle")).toBe(DEFAULT_DOCK);
    expect(parseDock(42)).toBe(DEFAULT_DOCK);
    expect(parseDock({})).toBe(DEFAULT_DOCK);
    expect(parseDock("")).toBe(DEFAULT_DOCK);
  });
});

describe("TOOLBAR_DOCKS", () => {
  it("ofrece las cuatro posiciones, empezando por el default", () => {
    expect(TOOLBAR_DOCKS).toEqual(["bottom", "top", "left", "right"]);
    expect(TOOLBAR_DOCKS[0]).toBe(DEFAULT_DOCK);
  });
});
```

Agregar `TOOLBAR_DOCKS` al import del test:

```ts
import {
  DEFAULT_DOCK,
  parseDock,
  TOOLBAR_DOCKS,
  type ToolbarDock,
} from "./toolbarDock.ts";
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
deno task test -- toolbarDock
```

Esperado: FAIL — `Failed to resolve import "./toolbarDock.ts"`.

- [ ] **Step 3: Implementar el módulo**

Crear `apps/desktop/src/lib/state/toolbarDock.ts`:

```ts
/**
 * Dónde se acopla la barra flotante del editor. Módulo puro (sin runes) a
 * propósito: `uiLocale.svelte.ts` usa `$state`, y vitest corre en node sin el
 * plugin de Svelte, así que las reglas de parseo solo son testeables acá.
 */
export type ToolbarDock = "bottom" | "top" | "left" | "right";

export const DEFAULT_DOCK: ToolbarDock = "bottom";

/** Orden en que se ofrecen las posiciones en el selector. */
export const TOOLBAR_DOCKS: readonly ToolbarDock[] = [
  "bottom",
  "top",
  "left",
  "right",
];

/**
 * Narrowing de un valor leído de settings.json. Cualquier cosa ausente o no
 * reconocida cae al default: un valor desconocido llegaría al atributo
 * `data-dock`, no matchearía ninguna regla y dejaría la barra sin posicionar.
 */
export function parseDock(value: unknown): ToolbarDock {
  return TOOLBAR_DOCKS.includes(value as ToolbarDock)
    ? (value as ToolbarDock)
    : DEFAULT_DOCK;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
deno task test -- toolbarDock
```

Esperado: PASS — 4 tests.

- [ ] **Step 5: Verificación completa**

```bash
deno task check && deno task test && deno fmt && deno lint
```

Esperado: check con `0 ERRORS 0 WARNINGS`; test con 304 pasando (300 previos + 4).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/lib/state/toolbarDock.ts apps/desktop/src/lib/state/toolbarDock.test.ts
git commit -m "Barra: módulo puro de posición de la barra (parseDock)"
```

---

### Task 2: Persistir la posición en UiSettingsStore

**Files:**
- Modify: `apps/desktop/src/lib/state/uiLocale.svelte.ts`

**Interfaces:**
- Consumes: `parseDock`, `ToolbarDock`, `DEFAULT_DOCK` de Task 1.
- Produces: `uiLocale.dock: ToolbarDock` y `uiLocale.setDock(dock: ToolbarDock): void`.

Sin test propio: el archivo usa runes y no es importable desde vitest (ver
Global Constraints). Lo testeable ya quedó cubierto en Task 1; acá la red de
seguridad es `deno task check`.

- [ ] **Step 1: Agregar el import**

En `apps/desktop/src/lib/state/uiLocale.svelte.ts`, tras la línea 2:

```ts
import { readJson, writeJsonAtomic } from "$lib/persist/atomic";
import { overwriteGetLocale } from "$lib/paraglide/runtime";
import { DEFAULT_DOCK, parseDock, type ToolbarDock } from "$lib/state/toolbarDock";
```

- [ ] **Step 2: Extender AppSettings**

Reemplazar la interfaz `AppSettings`:

```ts
interface AppSettings {
  schemaVersion: 1;
  uiLanguage?: UiLanguage;
  uiTheme?: UiTheme;
  /** Opcional: un settings.json previo a esta feature cae en DEFAULT_DOCK. */
  toolbarDock?: ToolbarDock;
}
```

- [ ] **Step 3: Agregar el estado**

Tras `theme = $state<UiTheme>("system");`:

```ts
  dock = $state<ToolbarDock>(DEFAULT_DOCK);
```

- [ ] **Step 4: Leerlo en load()**

Dentro de `load()`, tras la línea de `uiTheme`:

```ts
      if (settings?.uiTheme) this.theme = settings.uiTheme;
      this.dock = parseDock(settings?.toolbarDock);
```

Nota: sin `if`. `parseDock` ya devuelve el default cuando el campo falta, así
que asignar siempre es correcto y deja el comportamiento en un solo lugar.

- [ ] **Step 5: Persistirlo**

En `#persist()`, agregar al objeto:

```ts
      {
        schemaVersion: 1,
        uiLanguage: this.current,
        uiTheme: this.theme,
        toolbarDock: this.dock,
      } satisfies AppSettings,
```

- [ ] **Step 6: Agregar el setter**

Tras `setTheme`:

```ts
  setDock(dock: ToolbarDock): void {
    if (this.dock === dock) return;
    this.dock = dock;
    this.#persist();
  }
```

- [ ] **Step 7: Verificación**

```bash
deno task check && deno task test && deno fmt && deno lint
```

Esperado: `0 ERRORS 0 WARNINGS`, 304 tests pasando.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/lib/state/uiLocale.svelte.ts
git commit -m "Barra: persistir la posición en settings.json"
```

---

### Task 3: Consolidar `.menu-pop` en float-menu.css

Refactor puro: **no debe cambiar nada visualmente**. Se hace antes de agregar
las variantes de dock para no escribir la lógica nueva cuatro veces.

Alcance: solo `.menu-pop`. **No** tocar `.mi` — está duplicado pero no es
idéntico (HeadingMenu usa `align-items: baseline` y otro padding, a propósito,
porque muestra previews de títulos en distintos tamaños). Consolidarlo cambiaría
su aspecto.

**Files:**
- Modify: `apps/desktop/src/lib/components/float-menu.css`
- Modify: `apps/desktop/src/lib/components/HeadingMenu.svelte`
- Modify: `apps/desktop/src/lib/components/ListMenu.svelte`
- Modify: `apps/desktop/src/lib/components/TableMenu.svelte`
- Modify: `apps/desktop/src/lib/components/FontMenu.svelte`

**Interfaces:**
- Consumes: nada.
- Produces: clase global `.menu-pop`, que lee `--pop-min-w` del `.menu-wrap`
  contenedor.

- [ ] **Step 1: Agregar `.menu-pop` al CSS global**

Al final de `apps/desktop/src/lib/components/float-menu.css`:

```css
/*
 * Popover compartido de los menús de la barra (Headings, Lists, Table, Font y
 * el selector de posición). Vive acá, global, por la misma razón que .fm-btn:
 * los menús son componentes sueltos, pero su popover es descendiente del DOM
 * de .float-menu, así que las variantes por posición (abajo) pueden alcanzarlo
 * cruzando la frontera de componentes sin props ni contexto.
 *
 * Cada .menu-wrap declara su propio ancho vía --pop-min-w.
 */
.menu-pop {
  position: absolute;
  min-width: var(--pop-min-w, 200px);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--elev-raised);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 60;
  /* Colocación por defecto (barra abajo): abre hacia arriba y centrado. */
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
}
```

- [ ] **Step 2: Borrar el duplicado de HeadingMenu**

En `HeadingMenu.svelte`, **borrar** el bloque `.menu-pop { … }` completo y
reemplazar `.menu-wrap`:

```css
  .menu-wrap {
    position: relative;
    --pop-min-w: 220px;
  }
```

- [ ] **Step 3: Borrar el duplicado de ListMenu**

En `ListMenu.svelte`, **borrar** el bloque `.menu-pop { … }` y reemplazar:

```css
  .menu-wrap {
    position: relative;
    --pop-min-w: 190px;
  }
```

- [ ] **Step 4: Borrar el duplicado de TableMenu**

En `TableMenu.svelte`, **borrar** el bloque `.menu-pop { … }` y reemplazar:

```css
  .menu-wrap {
    position: relative;
    --pop-min-w: 200px;
  }
```

- [ ] **Step 5: Borrar el duplicado de FontMenu**

En `FontMenu.svelte`, **borrar** el bloque `.menu-pop { … }` y reemplazar:

```css
  .menu-wrap {
    position: relative;
    --pop-min-w: 230px;
  }
```

- [ ] **Step 6: Verificación**

```bash
deno task check && deno task test && deno fmt && deno lint
```

Esperado: `0 ERRORS 0 WARNINGS`. En particular, **cero warnings de "Unused CSS
selector"**: si aparece uno, quedó un `.menu-pop` huérfano en algún componente.

- [ ] **Step 7: Autofixer de Svelte**

Pasar los 4 componentes modificados por el MCP `svelte-autofixer`
(`desired_svelte_version: 5`). Esperado: `issues: []`.

- [ ] **Step 8: Verificación visual — sin cambios**

Levantar la app (`deno task dev`) y abrir los 4 menús. Deben verse y ubicarse
**exactamente igual que antes**: hacia arriba, centrados, con sus anchos
respectivos. Esta tarea no cambia comportamiento; cualquier diferencia visible
es un bug.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/lib/components/float-menu.css \
        apps/desktop/src/lib/components/HeadingMenu.svelte \
        apps/desktop/src/lib/components/ListMenu.svelte \
        apps/desktop/src/lib/components/TableMenu.svelte \
        apps/desktop/src/lib/components/FontMenu.svelte
git commit -m "Barra: consolidar .menu-pop duplicado en float-menu.css"
```

---

### Task 4: Variables de layout en `.app`

Refactor puro: **no debe cambiar nada visualmente**. Sube las clases de estado a
`.app` y colapsa las cuatro reglas de `grid-template-columns` en una.

**Files:**
- Modify: `apps/desktop/src/lib/components/EditorScreen.svelte`

**Interfaces:**
- Consumes: nada.
- Produces: `--outline-w`, `--refs-w`, `--header-h` en `.app`, legibles por
  cualquier descendiente (incluida la barra).

- [ ] **Step 1: Mover las clases de estado al contenedor raíz**

En el markup, línea 523, reemplazar `<div class="app">`:

```svelte
<div
  class="app"
  class:no-outline={!outlineOpen}
  class:no-refs={!refsOpen}
  class:focus={focusMode}
>
```

- [ ] **Step 2: Quitarlas del shell**

Reemplazar el `<div class="shell" …>` (línea ~577) por:

```svelte
  <div class="shell">
```

- [ ] **Step 3: Definir las variables en `.app`**

Reemplazar el bloque `.app { … }`:

```css
  .app {
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--canvas);
    /* Anchos de los paneles laterales y alto del header. Viven acá (y no en
       .shell) porque la barra flotante es hermana del shell y necesita leerlos
       para anclarse al borde del canvas. --header-h son los 40px del .titlebar,
       borde inferior incluido: tokens.css aplica box-sizing:border-box a todo,
       así que el border-bottom de 1px va DENTRO de height:40px, no encima. */
    --outline-w: 248px;
    --refs-w: 312px;
    --header-h: 40px;
  }

  .app.no-outline { --outline-w: 0px; }
  .app.no-refs { --refs-w: 0px; }

  .app.no-outline.no-refs,
  .app.focus {
    --outline-w: 0px;
    --refs-w: 0px;
  }
```

- [ ] **Step 4: Colapsar el grid a una sola regla**

Reemplazar los cinco bloques `.shell`, `.shell.no-outline`, `.shell.no-refs`,
`.shell.no-outline.no-refs`, `.shell.focus` por uno solo:

```css
  .shell {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: var(--outline-w) 1fr var(--refs-w);
    transition: grid-template-columns 220ms var(--ease);
  }
```

- [ ] **Step 5: Verificación**

```bash
deno task check && deno task test && deno fmt && deno lint
```

Esperado: `0 ERRORS 0 WARNINGS`. Si aparece "Unused CSS selector `.shell.focus`"
u otro similar, quedó una regla vieja sin borrar.

- [ ] **Step 6: Autofixer de Svelte**

`EditorScreen.svelte` por el MCP `svelte-autofixer`. Esperado: `issues: []`.

Nota: el autofixer puede sugerir `SvelteMap` para el `new Map()` que ya existe
en el archivo. Es un falso positivo (es un Map local no reactivo) y es
preexistente — **no cambiarlo**.

- [ ] **Step 7: Verificación visual — sin cambios**

Con la app levantada: colapsar y expandir el panel de esquema, el de
referencias, y entrar/salir de modo foco. Las transiciones deben verse idénticas
a antes (220 ms, mismos anchos).

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/lib/components/EditorScreen.svelte
git commit -m "Editor: anchos de paneles como variables en .app"
```

---

### Task 5: Toolbar.svelte + i18n + acoplar las cuatro posiciones

El plato fuerte. Al terminar, la barra se mueve de verdad.

**Files:**
- Create: `apps/desktop/src/lib/components/Toolbar.svelte`
- Modify: `apps/desktop/messages/en.json`
- Modify: `apps/desktop/messages/es.json`
- Modify: `apps/desktop/src/lib/components/float-menu.css`
- Modify: `apps/desktop/src/lib/components/EditorScreen.svelte`

**Interfaces:**
- Consumes: `TOOLBAR_DOCKS`, `ToolbarDock` (Task 1); `uiLocale.dock`,
  `uiLocale.setDock` (Task 2); `.menu-pop` global (Task 3); `--outline-w`,
  `--refs-w`, `--header-h` (Task 4).
- Produces: componente `Toolbar` con props
  `{ dock: ToolbarDock; onDockChange: (dock: ToolbarDock) => void; children: Snippet }`.

- [ ] **Step 1: Agregar las cadenas en inglés**

En `apps/desktop/messages/en.json`, antes de la llave de cierre, agregar coma a
la última entrada existente y luego:

```json
  "toolbar_position": "Toolbar position",
  "toolbar_pos_bottom": "Bottom",
  "toolbar_pos_top": "Top",
  "toolbar_pos_left": "Left",
  "toolbar_pos_right": "Right"
```

- [ ] **Step 2: Agregar las cadenas en español**

En `apps/desktop/messages/es.json`, igual:

```json
  "toolbar_position": "Posición de la barra",
  "toolbar_pos_bottom": "Abajo",
  "toolbar_pos_top": "Arriba",
  "toolbar_pos_left": "Izquierda",
  "toolbar_pos_right": "Derecha"
```

- [ ] **Step 3: Crear Toolbar.svelte**

Crear `apps/desktop/src/lib/components/Toolbar.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";
  import { TOOLBAR_DOCKS, type ToolbarDock } from "$lib/state/toolbarDock";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    dock: ToolbarDock;
    onDockChange: (dock: ToolbarDock) => void;
    children: Snippet;
  }

  let { dock, onDockChange, children }: Props = $props();

  let open = $state(false);

  function label(option: ToolbarDock): string {
    if (option === "bottom") return m.toolbar_pos_bottom();
    if (option === "top") return m.toolbar_pos_top();
    if (option === "left") return m.toolbar_pos_left();
    return m.toolbar_pos_right();
  }

  function choose(next: ToolbarDock): void {
    open = false;
    onDockChange(next);
  }
</script>

<div class="float-menu" data-dock={dock}>
  {@render children()}
  <div class="fm-sep"></div>
  <div class="menu-wrap">
    <button
      class="fm-btn"
      data-tip={m.toolbar_position()}
      aria-label={m.toolbar_position()}
      aria-expanded={open}
      onclick={() => (open = !open)}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 16h18" />
      </svg>
      <span class="fm-label">{m.toolbar_position()}</span>
    </button>
    {#if open}
      <div class="menu-pop" role="menu">
        {#each TOOLBAR_DOCKS as option (option)}
          <button
            class="mi"
            class:active={dock === option}
            role="menuitem"
            onclick={() => choose(option)}
          >
            {label(option)}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  /*
   * .mi propio en lugar de reusar el de los otros menús: esos tres bloques no
   * son idénticos entre sí (HeadingMenu alinea por baseline para sus previews
   * de títulos), así que consolidarlos cambiaría su aspecto.
   */
  .mi {
    border: none;
    background: none;
    text-align: left;
    padding: 8px 10px;
    border-radius: var(--r-sm);
    cursor: pointer;
    color: var(--fg);
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .mi:hover {
    background: var(--hover);
  }

  .mi.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
</style>
```

- [ ] **Step 4: Agregar el posicionamiento por dock al CSS global**

Al final de `apps/desktop/src/lib/components/float-menu.css`:

```css
/*
 * Posición de la barra. Es position:fixed y no absolute: .canvas es
 * overflow-y:auto, así que un absolute adentro se iría con el scroll.
 * Los offsets laterales salen de las variables que .app mantiene en sincronía
 * con las columnas del grid, así la barra se desliza junto con los paneles.
 */
.float-menu {
  position: fixed;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  background: color-mix(in oklab, var(--surface), transparent 8%);
  backdrop-filter: blur(16px);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  box-shadow: var(--elev-raised);
  z-index: 40;
  transition: left 220ms var(--ease), right 220ms var(--ease);
}

.float-menu[data-dock="bottom"] {
  left: 50%;
  bottom: 40px;
  transform: translateX(-50%);
}

.float-menu[data-dock="top"] {
  left: 50%;
  top: calc(var(--header-h) + 16px);
  transform: translateX(-50%);
}

/*
 * Centrado vertical con top+bottom+margin-block:auto en vez de
 * top:50%/translateY(-50%): el .statusbar no tiene alto fijo (es padding más
 * tamaño de fuente), así que no hay un --footer-h confiable que restar. Así la
 * barra se centra en la banda bajo el header sin depender del footer, y si
 * fuera más alta que la banda crece hacia abajo en lugar de tapar el header.
 */
.float-menu[data-dock="left"],
.float-menu[data-dock="right"] {
  top: calc(var(--header-h) + 16px);
  bottom: 16px;
  margin-block: auto;
  height: max-content;
  flex-direction: column;
}

.float-menu[data-dock="left"] {
  left: calc(var(--outline-w) + 16px);
}

.float-menu[data-dock="right"] {
  right: calc(var(--refs-w) + 16px);
}

/* Volteo de los popovers según el borde donde esté la barra. */
.float-menu[data-dock="top"] .menu-pop {
  bottom: auto;
  top: calc(100% + 10px);
}

.float-menu[data-dock="left"] .menu-pop {
  bottom: auto;
  top: 0;
  left: calc(100% + 10px);
  transform: none;
}

.float-menu[data-dock="right"] .menu-pop {
  bottom: auto;
  top: 0;
  left: auto;
  right: calc(100% + 10px);
  transform: none;
}

/*
 * CitationPopover (.pop) sigue la misma regla, pero necesita las cuatro
 * variantes explícitas: su CSS propio es `top:100%; right:0` (abre hacia abajo
 * a la derecha), así que sin estas reglas quedaría mal en TODAS las posiciones.
 * Reemplaza al override `.fab-cite :global(.pop)` que vivía en EditorScreen.
 * Mide 340px de ancho, así que en los laterales importa especialmente que salga
 * hacia el canvas y no fuera de la ventana.
 */
.float-menu[data-dock="bottom"] .pop {
  top: auto;
  bottom: calc(100% + 12px);
  right: auto;
  left: 50%;
  transform: translateX(-50%);
}

.float-menu[data-dock="top"] .pop {
  top: calc(100% + 12px);
  bottom: auto;
  right: auto;
  left: 50%;
  transform: translateX(-50%);
}

.float-menu[data-dock="left"] .pop {
  top: 0;
  bottom: auto;
  right: auto;
  left: calc(100% + 12px);
  transform: none;
}

.float-menu[data-dock="right"] .pop {
  top: 0;
  bottom: auto;
  left: auto;
  right: calc(100% + 12px);
  transform: none;
}
```

- [ ] **Step 5: Quitar de EditorScreen lo que pasó al CSS global**

En `EditorScreen.svelte`, **borrar** dos bloques del `<style>`:

1. `.float-menu { … }` — pasó al CSS global en el paso anterior.
2. `.fab-cite :global(.pop) { … }` — lo reemplazan las cuatro variantes de
   `.pop` del paso anterior. Si se deja, su `transform: translateX(-50%)`
   compite con las variantes laterales.

**Conservar** `.fab-cite { position: relative; }` (es el ancla del popover),
`.fm-sep` y `.fm-count`.

- [ ] **Step 6: Importar Toolbar y usarlo**

En el `<script>` de `EditorScreen.svelte`, junto a los demás imports de
componentes:

```ts
  import Toolbar from "$lib/components/Toolbar.svelte";
```

Reemplazar la apertura `<div class="float-menu">` (línea ~762) por:

```svelte
    <Toolbar
      dock={uiLocale.dock}
      onDockChange={(next) => uiLocale.setDock(next)}
    >
```

y el `</div>` que la cierra (línea ~838, justo después del
`<span class="fm-count">`) por:

```svelte
    </Toolbar>
```

- [ ] **Step 7: Envolver las etiquetas de los botones propios de EditorScreen**

Para que el modo solo-ícono (Task 6) pueda ocultarlas, cada texto suelto dentro
de un `.fm-btn` de EditorScreen va en un `<span class="fm-label">`. Son cuatro:

```svelte
      <span class="fm-label">{m.editor_insert_citation()}</span>
```
```svelte
      <span class="fm-label">{m.fab_new_ref()}</span>
```
```svelte
      <span class="fm-label">{m.fab_figure()}</span>
```
```svelte
      <span class="fm-label">{m.fab_focus()}</span>
```
```svelte
      <span class="fm-label">{exporting ? m.editor_exporting() : m.editor_export()}</span>
```

Y agregar a cada uno de esos botones **`data-tip` y `aria-label`** con la misma
cadena. Ejemplo sobre el botón de figura:

```svelte
      <button
        class="fm-btn"
        onclick={() => figureInput?.click()}
        disabled={!editor}
        data-tip={m.fab_figure()}
        aria-label={m.fab_figure()}
      >
```

Dos notas, ambas obligatorias:

- El `title={m.fab_figure()}` que ya tenía se **quita** — lo reemplaza el
  tooltip propio, y dejar ambos mostraría dos tooltips superpuestos.
- El `aria-label` **no es opcional**. En los laterales la etiqueta se oculta con
  `display: none`, lo que la saca del árbol de accesibilidad, y `data-tip` es un
  atributo cualquiera que la tecnología asistiva no lee. Sin `aria-label` cada
  botón quedaría **sin nombre accesible** en modo solo-íconos: hoy el `title`
  cumple ese rol, así que quitarlo sin reemplazo sería una regresión.

- [ ] **Step 8: Agregar `data-tip` y `fm-label` a los triggers de los 4 menús**

En cada uno: cambiar `title={…}` por **`data-tip={…}` más `aria-label={…}`**
(misma cadena en los dos) y envolver el texto en `<span class="fm-label">`.

El `aria-label` es obligatorio por la misma razón que en el paso anterior: en
los laterales la etiqueta se oculta con `display: none` y sale del árbol de
accesibilidad, y `data-tip` no lo lee la tecnología asistiva. Hoy el `title`
provee el nombre accesible; quitarlo sin reemplazo sería una regresión.

`HeadingMenu.svelte` (línea ~37) — reemplazar `title={m.tb_headings()}` por
`data-tip={m.tb_headings()}`, y la línea suelta `{m.tb_headings()}` por:

```svelte
    <span class="fm-label">{m.tb_headings()}</span>
```

`ListMenu.svelte` (línea ~65) — `title={m.tb_lists()}` → `data-tip={m.tb_lists()}`,
y la línea suelta `{m.tb_lists()}` por:

```svelte
    <span class="fm-label">{m.tb_lists()}</span>
```

`TableMenu.svelte` (línea ~34) — `title={m.tb_table()}` → `data-tip={m.tb_table()}`,
y la línea suelta `{m.tb_table()}` por:

```svelte
    <span class="fm-label">{m.tb_table()}</span>
```

`FontMenu.svelte` (línea ~44) — **este es distinto**: no muestra una etiqueta
fija sino la familia tipográfica actual, en un span que ya existe. Cambiar
`title={m.tb_font()}` por `data-tip={m.tb_font()}` y agregarle la clase al span
que ya está (no crear uno nuevo):

```svelte
    <span class="fam fm-label">{APA_FONTS[current].family}</span>
```

El `data-tip` dice qué hace el botón (`m.tb_font()` = "Fuente"), no el valor
actual, que es lo que el ícono no puede comunicar por sí solo.

No se agregan claves a los JSON: las cuatro cadenas ya existen.

- [ ] **Step 9: Verificación**

```bash
deno task check && deno task test && deno fmt && deno lint
```

Esperado: `0 ERRORS 0 WARNINGS`, 304 tests pasando.

- [ ] **Step 10: Autofixer de Svelte**

Pasar `Toolbar.svelte`, `EditorScreen.svelte` y los 4 menús por el MCP
`svelte-autofixer`. Esperado: `issues: []`.

- [ ] **Step 11: Verificación visual — las cuatro posiciones**

Con la app levantada, usar el selector nuevo para recorrer las 4 posiciones. En
cada una, abrir los 5 desplegables (Headings, Lists, Table, Font, Insert
citation) y confirmar que se abren **hacia el canvas** y no se salen de la
ventana. Cerrar y reabrir la app: la posición elegida debe persistir.

- [ ] **Step 12: Commit**

```bash
git add apps/desktop/src/lib/components/Toolbar.svelte \
        apps/desktop/src/lib/components/float-menu.css \
        apps/desktop/src/lib/components/EditorScreen.svelte \
        apps/desktop/src/lib/components/HeadingMenu.svelte \
        apps/desktop/src/lib/components/ListMenu.svelte \
        apps/desktop/src/lib/components/TableMenu.svelte \
        apps/desktop/src/lib/components/FontMenu.svelte \
        apps/desktop/messages/en.json apps/desktop/messages/es.json
git commit -m "Barra: acoplable a los cuatro bordes con selector de posición"
```

---

### Task 6: Modo solo-íconos y tooltip

**Files:**
- Modify: `apps/desktop/src/lib/components/float-menu.css`

**Interfaces:**
- Consumes: `data-tip` y `.fm-label` puestos en Task 5.
- Produces: nada que consuman tareas posteriores.

- [ ] **Step 1: Agregar el modo compacto y el tooltip**

Al final de `apps/desktop/src/lib/components/float-menu.css`:

```css
/*
 * Laterales: solo íconos. El texto se oculta y lo reemplaza un tooltip propio
 * (no el title= nativo, que tarda ~1s, no se puede estilizar y no aparece al
 * navegar con teclado). Se dispara con :hover Y :focus-visible.
 */
.float-menu[data-dock="left"] .fm-label,
.float-menu[data-dock="right"] .fm-label,
.float-menu[data-dock="left"] .fm-count,
.float-menu[data-dock="right"] .fm-count,
/* El caret de los desplegables sobra junto a un ícono solo: agrega ancho y
   ya no apunta hacia donde el menú se abre. */
.float-menu[data-dock="left"] .caret,
.float-menu[data-dock="right"] .caret {
  display: none;
}

.float-menu[data-dock="left"] .fm-btn,
.float-menu[data-dock="right"] .fm-btn {
  width: 38px;
  padding: 0;
  justify-content: center;
  position: relative;
}

.float-menu[data-dock="left"] .fm-sep,
.float-menu[data-dock="right"] .fm-sep {
  width: 22px;
  height: 1px;
  margin: 3px 0;
}

.float-menu[data-dock="left"] .fm-btn::after,
.float-menu[data-dock="right"] .fm-btn::after {
  content: attr(data-tip);
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
  background: var(--surface);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  box-shadow: var(--elev-raised);
  padding: 4px 9px;
  font-size: 12px;
  font-weight: 500;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--fast) var(--ease);
  z-index: 70;
}

/* Sale hacia el canvas, nunca hacia afuera de la ventana. */
.float-menu[data-dock="left"] .fm-btn::after {
  left: calc(100% + 8px);
}

.float-menu[data-dock="right"] .fm-btn::after {
  right: calc(100% + 8px);
}

.float-menu[data-dock="left"] .fm-btn:hover::after,
.float-menu[data-dock="left"] .fm-btn:focus-visible::after,
.float-menu[data-dock="right"] .fm-btn:hover::after,
.float-menu[data-dock="right"] .fm-btn:focus-visible::after {
  opacity: 1;
}
```

- [ ] **Step 2: Verificación**

```bash
deno task check && deno task test && deno fmt && deno lint
```

Esperado: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 3: Verificación visual**

Con la barra a la izquierda y a la derecha: los textos desaparecen, los botones
quedan cuadrados, el contador de palabras se oculta (el statusbar lo sigue
mostrando) y los separadores son horizontales. Pasar el mouse sobre cada botón
muestra el tooltip hacia el lado del canvas. **Recorrer la barra con Tab**: el
tooltip debe aparecer también con foco de teclado.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/lib/components/float-menu.css
git commit -m "Barra: modo solo-íconos con tooltip en los laterales"
```

---

### Task 7: Fallback en ventanas angostas

**Files:**
- Modify: `apps/desktop/src/lib/components/float-menu.css`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada.

- [ ] **Step 1: Agregar el media query**

Al final de `apps/desktop/src/lib/components/float-menu.css`:

```css
/*
 * Con ambos paneles abiertos (248 + 312 = 560px) más el papel de 8.5in (816px)
 * más la barra lateral hacen falta ~1400px. Por debajo de 1280px la barra
 * vuelve abajo. La preferencia guardada NO se toca: al agrandar la ventana la
 * barra regresa sola a su lado.
 */
@media (max-width: 1280px) {
  .float-menu[data-dock="left"],
  .float-menu[data-dock="right"] {
    top: auto;
    right: auto;
    bottom: 40px;
    left: 50%;
    margin-block: 0;
    transform: translateX(-50%);
    flex-direction: row;
  }

  .float-menu[data-dock="left"] .fm-label,
  .float-menu[data-dock="right"] .fm-label,
  .float-menu[data-dock="left"] .fm-count,
  .float-menu[data-dock="right"] .fm-count {
    display: inline;
  }

  .float-menu[data-dock="left"] .caret,
  .float-menu[data-dock="right"] .caret {
    display: block;
  }

  .float-menu[data-dock="left"] .fm-btn,
  .float-menu[data-dock="right"] .fm-btn {
    width: auto;
    padding: 0 14px;
  }

  .float-menu[data-dock="left"] .fm-btn::after,
  .float-menu[data-dock="right"] .fm-btn::after {
    content: none;
  }

  .float-menu[data-dock="left"] .fm-sep,
  .float-menu[data-dock="right"] .fm-sep {
    width: 1px;
    height: 22px;
    margin: 0 3px;
  }

  .float-menu[data-dock="left"] .menu-pop,
  .float-menu[data-dock="right"] .menu-pop {
    top: auto;
    right: auto;
    bottom: calc(100% + 10px);
    left: 50%;
    transform: translateX(-50%);
  }

  .float-menu[data-dock="left"] .pop,
  .float-menu[data-dock="right"] .pop {
    top: auto;
    right: auto;
    bottom: calc(100% + 12px);
    left: 50%;
    transform: translateX(-50%);
  }
}
```

- [ ] **Step 2: Verificación**

```bash
deno task check && deno task test && deno fmt && deno lint
```

Esperado: `0 ERRORS 0 WARNINGS`, 304 tests pasando.

- [ ] **Step 3: Verificación visual final**

Matriz completa, dentro de Tauri (`deno task dev`), **no en el navegador** — la
app arrastra bugs conocidos de WKWebView con `backdrop-filter` y flex:

1. 4 posiciones × tema claro y oscuro.
2. En cada posición, abrir los 5 desplegables.
3. Achicar la ventana por debajo de 1280px con la barra en un lateral: debe
   saltar abajo con sus textos; al agrandar, vuelve al lateral.
4. Colapsar esquema y referencias, y modo foco, con la barra en cada lateral: la
   barra se desliza en sincronía con los paneles.
5. Reiniciar la app: la posición persiste.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/lib/components/float-menu.css
git commit -m "Barra: volver abajo en ventanas angostas"
```

---

## Notas de revisión

**Cobertura del spec.** Cada sección del spec tiene tarea: §1 estado → Tasks 1-2;
§2 componente → Task 5; §3 anclaje → Task 4 (variables) + Task 5 (posiciones);
§4 volteo → Task 3 (consolidación) + Task 5 (variantes); §5 modo ícono y tooltip
→ Task 6; §6 selector → Task 5; §7 i18n → Task 5; §Riesgos ventanas angostas →
Task 7.

**Desvío respecto del spec, deliberado.** El spec proponía testear
`setDock`/`load` sobre `UiSettingsStore`. No es viable: ese archivo usa runes y
vitest corre en node sin el plugin de Svelte, así que ni siquiera compila al
importarse. La intención (blindar la parte de la persistencia que puede romperse
en silencio) se conserva extrayendo las reglas a `toolbarDock.ts`, que se testea
sin mocks ni infraestructura nueva. `parseDock` además cubre un caso que el spec
no contemplaba: un `settings.json` corrupto o editado a mano.

**Fuera de alcance, detectado durante el planeamiento.** `.mi` está duplicado en
los 4 menús pero **no es idéntico** (HeadingMenu usa `align-items: baseline` y
padding distinto, a propósito). Consolidarlo cambiaría su aspecto, así que queda
afuera y `Toolbar.svelte` define el suyo.

**Descartado por YAGNI.** Una primera versión del módulo exportaba también
`isVerticalDock(dock)`. Ninguna tarea la consume —el CSS resuelve entero el modo
vertical vía `[data-dock]`— así que se quitó junto con su test en vez de dejar
código exportado y testeado que nadie llama.

**Asimetría a tener presente.** `FontMenu` es el único de los cuatro cuyo
trigger no muestra una etiqueta fija sino un valor (la familia tipográfica
actual). Por eso en Task 5 recibe la clase sobre el span que ya existe en lugar
de uno nuevo, y su `data-tip` es la acción (`m.tb_font()`), no el valor.

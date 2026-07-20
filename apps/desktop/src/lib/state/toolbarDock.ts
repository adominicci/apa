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

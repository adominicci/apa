import type { Attachment } from "svelte/attachments";

/**
 * Escape + click-outside dismissal, shared by every anchored popover in the
 * app. `Modal.svelte` implements the same two gestures for overlay dialogs;
 * this covers the anchored ones.
 *
 * Two very different callers use it, which is why the core is a plain DOM
 * function and the Svelte attachment is a thin wrapper over it:
 *
 * - The toolbar's Svelte dropdowns (Headings, Lists, Table, Font, the dock
 *   picker, the citation popover), via `dismissable` below.
 * - The APA table and figure node views in `editor/blocks.ts`, which build
 *   their pencil menus with imperative DOM and have no Svelte lifecycle to
 *   hang an attachment on.
 */

export interface DismissOptions {
  /**
   * Elements that count as "inside". A pointer press within any of them is
   * ignored. This is a **list**, not a single container, because the two
   * callers are shaped differently: a Svelte dropdown wraps its trigger and
   * popover in one element, whereas a node view's pencil button and menu are
   * siblings inside the table/figure — and there, pressing the table itself
   * *should* dismiss, so the common ancestor is not usable as the boundary.
   */
  inside: readonly HTMLElement[];
  onDismiss: () => void;
  /**
   * Focused after Escape. Dismissing with the keyboard must not strand focus
   * on `<body>`, which would drop a keyboard user back to the top of the
   * document. Pass the trigger that opened the popover.
   */
  focusOnEscape?: HTMLElement | null;
}

/**
 * Starts listening; returns the function that stops. Call it while the popover
 * is open and stop it when it closes — the listeners are global, so leaving
 * them attached would let a closed menu keep reacting.
 */
export function watchDismiss(options: DismissOptions): () => void {
  const { inside, onDismiss, focusOnEscape } = options;

  /**
   * `pointerdown`, not `click` or `mousedown`: it fires before the browser
   * moves focus, and a drag that starts inside the popover but ends outside it
   * (selecting the text of a menu item, say) never counts as an outside press.
   * Capture phase, so a handler that stops propagation can't hide the press.
   */
  function onPointerDown(event: PointerEvent) {
    const target = event.target;
    if (!(target instanceof Node)) return;
    for (const element of inside) {
      if (element.contains(target)) return;
    }
    onDismiss();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    onDismiss();
    focusOnEscape?.focus();
  }

  document.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("keydown", onKeyDown);

  return () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("keydown", onKeyDown);
  };
}

/**
 * Svelte wrapper around `watchDismiss` for anchored dropdowns.
 *
 * Attach it to the **wrapper** holding both the trigger and the popover
 * (`.menu-wrap`, `.fab-cite`) — not to the popover itself. Two things fall out
 * of that:
 *
 * 1. Pressing the trigger that opened the menu counts as inside, so the menu
 *    doesn't close and immediately reopen on its own button.
 * 2. Mutual exclusion comes for free: pressing a different menu's trigger is
 *    outside this wrapper, so this one closes on its own. No shared open-menu
 *    state, and no lifting `open` out of the components.
 *
 * Apply it only while the popover is open — a falsy value is treated as no
 * attachment:
 *
 * ```svelte
 * <div class="menu-wrap" {@attach open && dismissable(onClose)}>
 * ```
 */
export function dismissable(
  onDismiss: () => void,
): Attachment<HTMLElement> {
  return (node) =>
    watchDismiss({
      inside: [node],
      onDismiss,
      focusOnEscape: node.querySelector("button"),
    });
}

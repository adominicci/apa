import type { Attachment } from "svelte/attachments";

/**
 * Escape + click-outside dismissal for the editor's anchored dropdowns
 * (Headings, Lists, Table, Font, the toolbar's dock picker, and the citation
 * popover). `Modal.svelte` already implements the same two gestures for
 * overlay dialogs; this is the equivalent for popovers, in one place instead
 * of copied into each menu.
 *
 * Attach it to the **wrapper** that holds both the trigger and the popover
 * (`.menu-wrap`, `.fab-cite`) — not to the popover itself. Two things fall out
 * of that:
 *
 * 1. Clicking the trigger that opened the menu counts as *inside*, so the menu
 *    doesn't close and immediately reopen (or swallow the toggle) on its own
 *    button.
 * 2. Mutual exclusion comes for free: clicking a different menu's trigger is
 *    outside this wrapper, so this one closes on its own. No shared open-menu
 *    state and no lifting `open` out of the components.
 *
 * Apply it only while the popover is open:
 *
 * ```svelte
 * <div class="menu-wrap" {@attach open ? dismissable(onClose) : undefined}>
 * ```
 */
export function dismissable(
  onDismiss: () => void,
): Attachment<HTMLElement> {
  return (node) => {
    /**
     * `pointerdown`, not `click`: it fires before the browser moves focus, and
     * a drag that starts inside the popover but ends outside it (selecting the
     * text of a menu item, say) never counts as an outside click.
     */
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && node.contains(target)) return;
      onDismiss();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      /*
       * Return focus to the trigger before closing. Dismissing with the
       * keyboard must not strand focus on <body>, which would drop a keyboard
       * user back to the top of the document.
       */
      const trigger = node.querySelector("button");
      onDismiss();
      if (trigger instanceof HTMLElement) trigger.focus();
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  };
}

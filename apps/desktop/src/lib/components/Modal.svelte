<script module lang="ts">
  export type ModalSize = "sm" | "default" | "lg";
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Attachment } from "svelte/attachments";
  import { m } from "$lib/paraglide/messages";
  import "./modal.css";

  interface Props {
    title: string;
    subtitle?: string;
    /**
     * Width scale. "sm" (420px) is a confirmation — one sentence and two
     * buttons. "default" (520px) is every ordinary form. "lg" (564px) is a
     * long scrolling form with two-up field rows.
     */
    size?: ModalSize;
    /** Close on overlay click. Turn off for forms where a stray click
     * outside would silently discard in-progress edits. */
    dismissOnOverlay?: boolean;
    /** Close on Escape; follows dismissOnOverlay unless set, so protected
     * forms don't gain a silent-discard path through the keyboard. */
    dismissOnEscape?: boolean;
    onClose: () => void;
    children: Snippet;
    /** Optional right-aligned footer (buttons). */
    footer?: Snippet;
  }

  let {
    title,
    subtitle,
    size = "default",
    dismissOnOverlay = true,
    dismissOnEscape = dismissOnOverlay,
    onClose,
    children,
    footer,
  }: Props = $props();

  let dialogElement: HTMLDivElement | null = null;
  const focusableSelector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  interface BackgroundState {
    element: HTMLElement;
    hadInert: boolean;
    inert: string | null;
    hadAriaHidden: boolean;
    ariaHidden: string | null;
  }

  function inertBackground(modalOverlay: Element): () => void {
    const states: BackgroundState[] = [];
    let branch: Element = modalOverlay;
    let parent = branch.parentElement;

    while (parent) {
      for (const sibling of parent.children) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        states.push({
          element: sibling,
          hadInert: sibling.hasAttribute("inert"),
          inert: sibling.getAttribute("inert"),
          hadAriaHidden: sibling.hasAttribute("aria-hidden"),
          ariaHidden: sibling.getAttribute("aria-hidden"),
        });
        sibling.setAttribute("inert", "");
        sibling.setAttribute("aria-hidden", "true");
      }
      if (parent === document.body) break;
      branch = parent;
      parent = parent.parentElement;
    }

    return () => {
      for (const state of states.reverse()) {
        if (state.hadInert) {
          state.element.setAttribute("inert", state.inert ?? "");
        } else {
          state.element.removeAttribute("inert");
        }
        if (state.hadAriaHidden) {
          state.element.setAttribute("aria-hidden", state.ariaHidden ?? "");
        } else {
          state.element.removeAttribute("aria-hidden");
        }
      }
    };
  }

  function focusableElements(): HTMLElement[] {
    if (!dialogElement) return [];
    return Array.from(
      dialogElement.querySelectorAll<HTMLElement>(focusableSelector),
    ).filter((element) =>
      !element.hidden && element.getAttribute("aria-hidden") !== "true" &&
      !element.closest("[inert]")
    );
  }

  // Move focus into the dialog on open; give it back to the opener on close.
  const focusDialog: Attachment<HTMLDivElement> = (node) => {
    const opener = document.activeElement;
    dialogElement = node;
    const overlay = node.closest(".modal-overlay") ?? node;
    const restoreBackground = inertBackground(overlay);
    node.focus();
    return () => {
      dialogElement = null;
      restoreBackground();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  };

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && dismissOnEscape) {
      onClose();
      return;
    }
    if (e.key !== "Tab" || !dialogElement) return;

    e.preventDefault();
    const focusable = focusableElements();
    if (focusable.length === 0) {
      dialogElement.focus();
      return;
    }

    const current = document.activeElement;
    const index = current instanceof HTMLElement
      ? focusable.indexOf(current)
      : -1;
    const nextIndex = e.shiftKey
      ? (index <= 0 ? focusable.length - 1 : index - 1)
      : (index < 0 || index === focusable.length - 1 ? 0 : index + 1);
    focusable[nextIndex]?.focus({ preventScroll: true });
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div
  class="modal-overlay"
  role="presentation"
  onclick={(e) => {
    if (dismissOnOverlay && e.target === e.currentTarget) onClose();
  }}
>
  <div
    class="modal"
    class:modal-sm={size === "sm"}
    class:modal-lg={size === "lg"}
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
    {@attach focusDialog}
  >
    <header class="modal-head">
      <div>
        <h3>{title}</h3>
        {#if subtitle}<p class="sub">{subtitle}</p>{/if}
      </div>
      <button
        class="modal-close"
        onclick={onClose}
        aria-label={m.common_close()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </header>

    <div class="modal-body">
      {@render children()}
    </div>

    {#if footer}
      <footer class="modal-foot">{@render footer()}</footer>
    {/if}
  </div>
</div>

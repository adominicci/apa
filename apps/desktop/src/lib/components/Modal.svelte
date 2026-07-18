<script module lang="ts">
  export type ModalSize = "default" | "ref";
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Attachment } from "svelte/attachments";
  import { m } from "$lib/paraglide/messages";
  import "./modal.css";

  interface Props {
    title: string;
    subtitle?: string;
    /** "ref" is the wide, scroll-in-body variant (reference form). */
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

  // Move focus into the dialog on open; give it back to the opener on close.
  const focusDialog: Attachment<HTMLDivElement> = (node) => {
    const opener = document.activeElement;
    node.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  };

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && dismissOnEscape) onClose();
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
    class:modal-ref={size === "ref"}
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

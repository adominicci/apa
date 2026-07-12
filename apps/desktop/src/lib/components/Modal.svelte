<script module lang="ts">
  export type ModalSize = "default" | "ref";
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { m } from "$lib/paraglide/messages";
  import "./modal.css";

  interface Props {
    title: string;
    subtitle?: string;
    /** "ref" is the wide, scroll-in-body variant (reference form). */
    size?: ModalSize;
    onClose: () => void;
    children: Snippet;
    /** Optional right-aligned footer (buttons). */
    footer?: Snippet;
  }

  let { title, subtitle, size = "default", onClose, children, footer }: Props =
    $props();
</script>

<div
  class="modal-overlay"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) onClose();
  }}
>
  <div
    class="modal"
    class:modal-ref={size === "ref"}
    role="dialog"
    aria-modal="true"
    aria-label={title}
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

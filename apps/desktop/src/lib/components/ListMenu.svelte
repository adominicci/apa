<script lang="ts">
  import type { Editor } from "@tiptap/core";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    editor: Editor | undefined;
    /** List type at the cursor, or null when not in a list. */
    activeList: "bullet" | "ordered" | "lettered" | null;
    open: boolean;
    onToggle: () => void;
    onClose: () => void;
  }

  let { editor, activeList, open, onToggle, onClose }: Props = $props();

  function toggleBullet() {
    onClose();
    editor?.chain().focus().toggleBulletList().run();
  }

  /** Numbered = decimal ordered list; toggles off if already decimal. */
  function toggleNumbered() {
    onClose();
    const ed = editor;
    if (!ed) return;
    if (activeList === "ordered") {
      ed.chain().focus().toggleOrderedList().run();
      return;
    }
    if (!ed.isActive("orderedList")) {
      ed.chain().focus().toggleOrderedList().run();
    }
    ed.chain().focus().updateAttributes("orderedList", { listStyle: "decimal" })
      .run();
  }

  /** Lettered = ordered list with lower-alpha style; toggles off if active. */
  function toggleLettered() {
    onClose();
    const ed = editor;
    if (!ed) return;
    if (activeList === "lettered") {
      ed.chain().focus().toggleOrderedList().run();
      return;
    }
    if (!ed.isActive("orderedList")) {
      ed.chain().focus().toggleOrderedList().run();
    }
    ed.chain().focus().updateAttributes("orderedList", {
      listStyle: "lower-alpha",
    }).run();
  }

  function indent() {
    editor?.chain().focus().sinkListItem("listItem").run();
  }

  function outdent() {
    editor?.chain().focus().liftListItem("listItem").run();
  }
</script>

<div class="menu-wrap">
  <button
    class="fm-btn"
    class:on={open}
    onclick={onToggle}
    disabled={!editor}
    title={m.tb_lists()}
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <circle cx="5" cy="7" r="1" />
      <circle cx="5" cy="12" r="1" />
      <circle cx="5" cy="17" r="1" />
      <path d="M9 7h11M9 12h11M9 17h11" />
    </svg>
    {m.tb_lists()}
    <svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M6 15l6-6 6 6" />
    </svg>
  </button>

  {#if open}
    <div class="menu-pop" role="menu">
      <button
        class="mi"
        class:active={activeList === "bullet"}
        role="menuitem"
        onclick={toggleBullet}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="5" cy="7" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="5" cy="17" r="1" />
          <path d="M9 7h11M9 12h11M9 17h11" />
        </svg>
        {m.list_bulleted()}
      </button>
      <button
        class="mi"
        class:active={activeList === "ordered"}
        role="menuitem"
        onclick={toggleNumbered}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M10 7h10M10 12h10M10 17h10M4 6v3M4 9h1M3.5 6H4M3 13h2l-2 3h2" />
        </svg>
        {m.list_numbered()}
      </button>
      <button
        class="mi"
        class:active={activeList === "lettered"}
        role="menuitem"
        onclick={toggleLettered}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M10 7h10M10 12h10M10 17h10M3 10l1.4-4L6 10M3.3 9h2.2" />
        </svg>
        {m.list_lettered()}
      </button>
      <div class="mi-sep"></div>
      <button class="mi" role="menuitem" onclick={outdent}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M20 6H10M20 12H10M20 18H10M7 9l-3 3 3 3" />
        </svg>
        {m.list_outdent()}
      </button>
      <button class="mi" role="menuitem" onclick={indent}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M20 6H10M20 12H10M20 18H10M4 9l3 3-3 3" />
        </svg>
        {m.list_indent()}
      </button>
    </div>
  {/if}
</div>

<style>
  .menu-wrap {
    position: relative;
    --pop-min-w: 190px;
  }

  .caret {
    width: 12px;
    height: 12px;
    margin-left: -3px;
    opacity: 0.6;
  }

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

  .mi :global(svg) {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    color: var(--muted);
  }

  .mi:hover {
    background: var(--hover);
  }

  .mi.active {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .mi.active :global(svg) {
    color: var(--accent);
  }

  .mi-sep {
    height: 1px;
    background: var(--border);
    margin: 4px 2px;
  }
</style>

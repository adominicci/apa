<script lang="ts">
  import type { Editor } from "@tiptap/core";
  import { deleteWholeApaTable } from "$lib/editor/tableCommands.ts";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    editor: Editor | undefined;
    /** Whether the cursor is inside a table (shows row/column controls). */
    inTable: boolean;
    open: boolean;
    onToggle: () => void;
    onClose: () => void;
    /** Inserts a blank APA table (owned by the parent, uses insertApaTable). */
    onInsert: () => void;
  }

  let { editor, inTable, open, onToggle, onClose, onInsert }: Props = $props();

  function run(command: "addRowAfter" | "addColumnAfter" | "deleteRow" | "deleteColumn") {
    onClose();
    editor?.chain().focus()[command]().run();
  }

  /** Removes the whole apaTable (caption, grid, and note) — TipTap's
   * deleteTable() only targets the inner grid, which the wrapper forbids. */
  function deleteTable() {
    onClose();
    if (editor) deleteWholeApaTable(editor);
  }
</script>

<div class="menu-wrap">
  <button
    class="fm-btn"
    class:on={open}
    onclick={onToggle}
    disabled={!editor}
    title={m.tb_table()}
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <path d="M3 10h18M3 15h18M9 4v16M15 4v16" />
    </svg>
    {m.tb_table()}
    <svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M6 15l6-6 6 6" />
    </svg>
  </button>

  {#if open}
    <div class="menu-pop" role="menu">
      {#if !inTable}
        <button class="mi" role="menuitem" onclick={() => {
          onClose();
          onInsert();
        }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M3 10h18M9 4v16" /></svg>
          {m.table_insert()}
        </button>
      {:else}
        <button class="mi" role="menuitem" onclick={() => run("addRowAfter")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 8h16M4 14h7M17 17v-6M14 14h6" /></svg>
          {m.table_add_row()}
        </button>
        <button class="mi" role="menuitem" onclick={() => run("addColumnAfter")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 4v16M14 4v7M17 8v6M20 11h-6" /></svg>
          {m.table_add_col()}
        </button>
        <div class="mi-sep"></div>
        <button class="mi" role="menuitem" onclick={() => run("deleteRow")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 8h16M4 14h16M9 14v6M15 14v6" /></svg>
          {m.table_del_row()}
        </button>
        <button class="mi" role="menuitem" onclick={() => run("deleteColumn")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 4v16M14 4v16M14 9h6M14 15h6" /></svg>
          {m.table_del_col()}
        </button>
        <div class="mi-sep"></div>
        <button class="mi danger" role="menuitem" onclick={deleteTable}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M6 7l1 13h10l1-13M10 11v6M14 11v6M9 4h6" /></svg>
          {m.table_delete()}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .menu-wrap {
    position: relative;
  }

  .caret {
    width: 12px;
    height: 12px;
    margin-left: -3px;
    opacity: 0.6;
  }

  .menu-pop {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 50%;
    transform: translateX(-50%);
    min-width: 200px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    box-shadow: var(--elev-raised);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    z-index: 60;
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

  .mi.danger {
    color: var(--danger);
  }

  .mi.danger :global(svg) {
    color: var(--danger);
  }

  .mi-sep {
    height: 1px;
    background: var(--border);
    margin: 4px 2px;
  }
</style>

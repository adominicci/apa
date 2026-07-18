<script lang="ts">
  import Modal from "$lib/components/Modal.svelte";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    onInsert: (rows: number, cols: number, header: boolean) => void;
    onClose: () => void;
  }

  let { onInsert, onClose }: Props = $props();

  let rows = $state(3);
  let cols = $state(3);
  let header = $state(true);

  // A header row needs at least one body row, so the real minimum is 2 —
  // mirror insertApaTable's clamp here instead of silently exceeding the input.
  const minRows = $derived(header ? 2 : 1);

  function clamp(n: number, min = 1): number {
    if (Number.isNaN(n)) return min;
    return Math.min(20, Math.max(min, Math.round(n)));
  }

  function insert() {
    onInsert(clamp(rows, minRows), clamp(cols), header);
  }
</script>

<Modal title={m.table_insert()} {onClose}>
  <div class="field-row">
    <label class="field">
      <span>{m.table_rows()}</span>
      <input type="number" min={minRows} max="20" bind:value={rows} />
    </label>
    <label class="field">
      <span>{m.table_cols()}</span>
      <input type="number" min="1" max="20" bind:value={cols} />
    </label>
  </div>

  <label class="check">
    <input
      type="checkbox"
      bind:checked={header}
      onchange={() => {
        if (header && clamp(rows) < 2) rows = 2;
      }}
    />
    {m.table_header_row()}
  </label>

  <div class="grid-preview" aria-hidden="true">
    {#each Array(Math.min(6, clamp(rows, minRows))) as _, r (r)}
      <div class="pv-row">
        {#each Array(Math.min(8, clamp(cols))) as _, c (c)}
          <div class="pv-cell" class:hd={header && r === 0}></div>
        {/each}
      </div>
    {/each}
  </div>

  <p class="hint">{m.table_dialog_hint()}</p>

  {#snippet footer()}
    <button class="btn btn-ghost" onclick={onClose}>{m.common_close()}</button>
    <button class="btn btn-primary" onclick={insert}>{m.table_insert()}</button>
  {/snippet}
</Modal>

<style>
  .grid-preview {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--chrome);
  }

  .pv-row {
    display: flex;
    gap: 3px;
  }

  .pv-cell {
    flex: 1;
    height: 14px;
    border-radius: 2px;
    background: var(--hover);
  }

  .pv-cell.hd {
    background: var(--accent-soft);
  }
</style>

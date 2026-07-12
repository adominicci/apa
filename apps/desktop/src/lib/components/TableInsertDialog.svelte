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

  function clamp(n: number): number {
    if (Number.isNaN(n)) return 1;
    return Math.min(20, Math.max(1, Math.round(n)));
  }

  function insert() {
    onInsert(clamp(rows), clamp(cols), header);
  }
</script>

<Modal title={m.table_insert()} {onClose}>
  <div class="field-row">
    <label class="field">
      <span>{m.table_rows()}</span>
      <input type="number" min="1" max="20" bind:value={rows} />
    </label>
    <label class="field">
      <span>{m.table_cols()}</span>
      <input type="number" min="1" max="20" bind:value={cols} />
    </label>
  </div>

  <label class="check">
    <input type="checkbox" bind:checked={header} />
    {m.table_header_row()}
  </label>

  <div class="grid-preview" aria-hidden="true">
    {#each Array(Math.min(6, clamp(rows))) as _, r (r)}
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

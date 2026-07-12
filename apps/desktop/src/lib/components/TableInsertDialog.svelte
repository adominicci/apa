<script lang="ts">
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

<div class="overlay" role="presentation">
  <div class="modal" role="dialog" aria-label={m.table_insert()}>
    <div class="row head">
      <strong>{m.table_insert()}</strong>
      <button class="close" onclick={onClose} aria-label={m.common_close()}>×</button>
    </div>

    <div class="row">
      <label class="grow">
        {m.table_rows()}
        <input type="number" min="1" max="20" bind:value={rows} />
      </label>
      <label class="grow">
        {m.table_cols()}
        <input type="number" min="1" max="20" bind:value={cols} />
      </label>
    </div>

    <label class="checkline">
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

    <button class="save" onclick={insert}>{m.table_insert()}</button>
    <p class="hint">{m.table_dialog_hint()}</p>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: var(--overlay);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }

  .modal {
    width: min(380px, calc(100vw - 2rem));
    background: var(--surface);
    border-radius: 12px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-size: 0.82rem;
    color: var(--fg);
    box-shadow: var(--elev-raised);
  }

  .row {
    display: flex;
    gap: 12px;
    align-items: end;
  }

  .head {
    align-items: center;
    justify-content: space-between;
  }

  .close {
    border: none;
    background: transparent;
    font-size: 1rem;
    cursor: pointer;
    color: var(--muted);
  }

  .grow {
    flex: 1;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--fg-2);
  }

  .checkline {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }

  input[type="number"] {
    font: inherit;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    width: 100%;
    box-sizing: border-box;
    background: var(--surface);
    color: inherit;
  }

  .grid-preview {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 8px;
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

  .save {
    border: none;
    background: var(--accent);
    color: var(--accent-on);
    font: inherit;
    padding: 8px 10px;
    border-radius: 7px;
    cursor: pointer;
  }

  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 0.75rem;
  }
</style>

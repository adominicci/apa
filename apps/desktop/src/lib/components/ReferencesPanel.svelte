<script lang="ts">
  import {
    buildReferenceList,
    type DocLocale,
    getTerms,
    type Reference,
  } from "@tesina/engine";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    references: Reference[];
    citedCounts: Map<string, number>;
    documentLanguage: DocLocale;
    onCite: (refId: string) => void;
    onDelete: (refId: string) => void;
    onAdd: () => void;
  }

  let {
    references,
    citedCounts,
    documentLanguage,
    onCite,
    onDelete,
    onAdd,
  }: Props = $props();

  let includeUncited = $state(true);
  let confirmingDelete = $state<string | null>(null);

  const heading = $derived(getTerms(documentLanguage).headings.references);

  const shown = $derived(
    includeUncited
      ? references
      : references.filter((ref) => citedCounts.has(ref.id)),
  );

  const entries = $derived(
    buildReferenceList(shown, documentLanguage).entries,
  );

  // Cited in text only (APA 8.9); listed here so they stay manageable.
  const personalComms = $derived(
    shown.filter((ref) => ref.type === "personalCommunication"),
  );

  function commSummary(ref: Reference): string {
    const first = ref.authors[0];
    const name = first
      ? first.kind === "group" ? first.name : first.family
      : "";
    const year = ref.date.year !== undefined ? ` (${ref.date.year})` : "";
    return `${name}${year}`;
  }

  function citedLabel(refId: string): string {
    const count = citedCounts.get(refId) ?? 0;
    if (count === 0) return "";
    return count === 1 ? m.panel_cited_once() : m.panel_cited_many({ count });
  }

  function handleDelete(refId: string) {
    if (confirmingDelete !== refId) {
      confirmingDelete = refId;
      return;
    }
    confirmingDelete = null;
    onDelete(refId);
  }
</script>

<aside class="panel" aria-label={heading}>
  <div class="head">
    <strong>{heading}</strong>
    <button class="add" onclick={onAdd}>{m.panel_add()}</button>
  </div>

  <label class="toggle">
    <input type="checkbox" bind:checked={includeUncited} />
    {m.panel_include_uncited()}
  </label>

  <div class="list">
    {#if entries.length === 0 && personalComms.length === 0}
      <p class="empty">
        {references.length === 0
          ? m.panel_empty_library()
          : m.panel_empty_cited()}
      </p>
    {:else}
      {#each entries as entry (entry.refId)}
        <div class="entry" class:uncited={!citedCounts.has(entry.refId)}>
          <p class="runs">
            {#each entry.runs as run, i (i)}
              {#if run.italic}<em>{run.text}</em>{:else}{run.text}{/if}
            {/each}
          </p>
          <div class="meta">
            {#if citedCounts.has(entry.refId)}
              <span>{citedLabel(entry.refId)}</span>
            {:else}
              <span class="pill">{m.panel_uncited()}</span>
            {/if}
            <span class="actions">
              <button onclick={() => onCite(entry.refId)}>
                {m.panel_cite()}
              </button>
              <button
                class="danger"
                onclick={() => handleDelete(entry.refId)}
                onblur={() => (confirmingDelete = null)}
              >
                {confirmingDelete === entry.refId
                  ? m.panel_delete_confirm()
                  : m.panel_delete()}
              </button>
            </span>
          </div>
        </div>
      {/each}
      {#each personalComms as comm (comm.id)}
        <div class="entry">
          <p class="runs">{commSummary(comm)} — {comm.title}</p>
          <div class="meta">
            <span class="pill blue">{m.panel_in_text_only()}</span>
            {#if citedCounts.has(comm.id)}
              <span>{citedLabel(comm.id)}</span>
            {/if}
            <span class="actions">
              <button onclick={() => onCite(comm.id)}>{m.panel_cite()}</button>
              <button
                class="danger"
                onclick={() => handleDelete(comm.id)}
                onblur={() => (confirmingDelete = null)}
              >
                {confirmingDelete === comm.id
                  ? m.panel_delete_confirm()
                  : m.panel_delete()}
              </button>
            </span>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</aside>

<style>
  .panel {
    width: 300px;
    flex: none;
    border-left: 1px solid var(--border);
    background: var(--chrome);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-size: var(--t-body);
    color: var(--fg);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-2) var(--sp-3) var(--sp-15);
  }

  .head strong {
    font-size: var(--t-caption);
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .add {
    border: 1px solid var(--border);
    background: transparent;
    border-radius: 7px;
    font: inherit;
    font-size: var(--t-small);
    padding: var(--sp-05) var(--sp-2);
    cursor: pointer;
    color: var(--fg-2);
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: var(--sp-15);
    padding: 0 var(--sp-3) var(--sp-2);
    color: var(--muted);
    border-bottom: 1px solid var(--border);
  }

  .list {
    flex: 1;
    overflow-y: auto;
  }

  .entry {
    padding: var(--sp-2) var(--sp-3);
    border-bottom: 1px solid var(--border-soft);
  }

  .entry.uncited {
    opacity: 0.75;
  }

  .runs {
    margin: 0;
    font-family: var(--serif);
    font-size: var(--t-small);
    line-height: 1.5;
    padding-left: var(--sp-3);
    text-indent: -14px;
    overflow-wrap: anywhere;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    margin-top: var(--sp-1);
    color: var(--muted);
    font-size: var(--t-small);
  }

  .pill {
    background: var(--warn-soft);
    color: var(--warn-strong);
    border-radius: 999px;
    padding: 0 var(--sp-15);
  }

  .pill.blue {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .actions {
    margin-left: auto;
    display: flex;
    gap: var(--sp-15);
  }

  .actions button {
    border: none;
    background: transparent;
    font: inherit;
    font-size: var(--t-small);
    cursor: pointer;
    color: var(--accent);
    padding: var(--sp-05) var(--sp-1);
  }

  .actions .danger {
    color: var(--danger);
  }

  .empty {
    color: var(--muted);
    padding: var(--sp-3);
    margin: 0;
  }

  
</style>

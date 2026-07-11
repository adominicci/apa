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
    border-left: 1px solid #e0deda;
    background: #faf9f7;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-size: 0.8rem;
    color: #26251f;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px 6px;
  }

  .add {
    border: 1px solid #d7d4cf;
    background: transparent;
    border-radius: 7px;
    font: inherit;
    font-size: 0.75rem;
    padding: 3px 8px;
    cursor: pointer;
    color: #44433e;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px 8px;
    color: #6b6a64;
    border-bottom: 1px solid #e0deda;
  }

  .list {
    flex: 1;
    overflow-y: auto;
  }

  .entry {
    padding: 8px 12px;
    border-bottom: 1px solid #eceae6;
  }

  .entry.uncited {
    opacity: 0.75;
  }

  .runs {
    margin: 0;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 0.78rem;
    line-height: 1.5;
    padding-left: 14px;
    text-indent: -14px;
    overflow-wrap: anywhere;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
    color: #8a887f;
    font-size: 0.72rem;
  }

  .pill {
    background: #faeeda;
    color: #633806;
    border-radius: 999px;
    padding: 0 7px;
  }

  .pill.blue {
    background: #eaf1fe;
    color: #173a8c;
  }

  .actions {
    margin-left: auto;
    display: flex;
    gap: 6px;
  }

  .actions button {
    border: none;
    background: transparent;
    font: inherit;
    font-size: 0.72rem;
    cursor: pointer;
    color: #2158d6;
    padding: 2px 4px;
  }

  .actions .danger {
    color: #a32d2d;
  }

  .empty {
    color: #8a887f;
    padding: 12px;
    margin: 0;
  }

  @media (prefers-color-scheme: dark) {
    .panel {
      background: #232320;
      border-color: #373632;
      color: #e8e6e1;
    }

    .toggle,
    .meta,
    .empty {
      color: #a3a19a;
    }

    .toggle {
      border-color: #373632;
    }

    .entry {
      border-color: #2e2d2a;
    }

    .add {
      border-color: #45443f;
      color: #c9c7c0;
    }

    .actions button {
      color: #7ea4f5;
    }

    .actions .danger {
      color: #f09595;
    }

    .pill {
      background: #4b3a12;
      color: #fac775;
    }
  }
</style>

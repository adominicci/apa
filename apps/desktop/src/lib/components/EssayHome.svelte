<script lang="ts">
  import type { DocLocale } from "@tesina/engine";
  import type { EssaySummary } from "$lib/model/essay";
  import { essays } from "$lib/state/essays.svelte";

  interface Props {
    onOpen: (id: string) => void;
  }

  let { onOpen }: Props = $props();

  let creating = $state(false);
  let renamingId = $state<string | null>(null);
  let renameValue = $state("");
  let confirmingDelete = $state<string | null>(null);

  async function createEssay(language: DocLocale) {
    creating = false;
    const essay = await essays.create(language);
    onOpen(essay.id);
  }

  function startRename(summary: EssaySummary) {
    renamingId = summary.id;
    renameValue = summary.title;
  }

  async function commitRename() {
    if (renamingId) {
      await essays.rename(renamingId, renameValue);
    }
    renamingId = null;
  }

  async function handleDelete(id: string) {
    if (confirmingDelete !== id) {
      confirmingDelete = id;
      return;
    }
    confirmingDelete = null;
    await essays.remove(id);
  }

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }
</script>

<div class="home">
  <header>
    <h1>Tesina</h1>
    <p class="tag">Tus ensayos, siempre en formato APA 7.</p>
    <div class="new-wrap">
      <button class="new" onclick={() => (creating = !creating)}>
        + Nuevo ensayo
      </button>
      {#if creating}
        <div class="menu" role="menu">
          <button role="menuitem" onclick={() => createEssay("es")}>
            En español
          </button>
          <button role="menuitem" onclick={() => createEssay("en")}>
            In English
          </button>
        </div>
      {/if}
    </div>
  </header>

  {#if !essays.loaded}
    <p class="empty">Cargando…</p>
  {:else if essays.summaries.length === 0}
    <div class="empty">
      <p>Todavía no hay ensayos.</p>
      <p>Crea el primero y olvídate del formato para siempre.</p>
    </div>
  {:else}
    <div class="grid">
      {#each essays.summaries as summary (summary.id)}
        <article class="card">
          {#if renamingId === summary.id}
            <input
              class="rename"
              type="text"
              bind:value={renameValue}
              onblur={commitRename}
              onkeydown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") renamingId = null;
              }}
            />
          {:else}
            <button class="title" onclick={() => onOpen(summary.id)}>
              {summary.title}
            </button>
          {/if}
          <p class="meta">
            <span class="lang">{summary.language.toUpperCase()}</span>
            {formatDate(summary.updatedAt)}
          </p>
          <div class="actions">
            <button onclick={() => startRename(summary)}>Renombrar</button>
            <button onclick={() => essays.duplicate(summary.id)}>
              Duplicar
            </button>
            <button
              class="danger"
              onclick={() => handleDelete(summary.id)}
              onblur={() => (confirmingDelete = null)}
            >
              {confirmingDelete === summary.id ? "¿Seguro?" : "Eliminar"}
            </button>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</div>

<style>
  .home {
    max-width: 860px;
    margin: 0 auto;
    padding: 2.5rem 1.5rem;
    font-family: system-ui, sans-serif;
    color: #26251f;
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 14px;
    flex-wrap: wrap;
    margin-bottom: 1.5rem;
  }

  h1 {
    margin: 0;
    font-size: 1.4rem;
    color: #2158d6;
  }

  .tag {
    margin: 0;
    color: #6b6a64;
    font-size: 0.85rem;
    flex: 1;
  }

  .new-wrap {
    position: relative;
  }

  .new {
    border: none;
    background: #2158d6;
    color: #fff;
    font: inherit;
    font-size: 0.85rem;
    padding: 7px 14px;
    border-radius: 8px;
    cursor: pointer;
  }

  .menu {
    position: absolute;
    right: 0;
    top: 110%;
    background: #fff;
    border: 1px solid #d7d4cf;
    border-radius: 8px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
    display: flex;
    flex-direction: column;
    min-width: 150px;
    z-index: 10;
    overflow: hidden;
  }

  .menu button {
    border: none;
    background: transparent;
    font: inherit;
    font-size: 0.82rem;
    text-align: left;
    padding: 8px 12px;
    cursor: pointer;
  }

  .menu button:hover {
    background: #eaf1fe;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
  }

  .card {
    background: #fff;
    border: 1px solid #e0deda;
    border-radius: 10px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .title {
    border: none;
    background: transparent;
    font: inherit;
    font-weight: 600;
    font-size: 0.95rem;
    text-align: left;
    cursor: pointer;
    color: #26251f;
    padding: 0;
  }

  .title:hover {
    color: #2158d6;
  }

  .rename {
    font: inherit;
    font-weight: 600;
    padding: 2px 6px;
    border: 1px solid #a6c4fa;
    border-radius: 6px;
  }

  .meta {
    margin: 0;
    font-size: 0.75rem;
    color: #8a887f;
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .lang {
    background: #eaf1fe;
    color: #173a8c;
    border-radius: 999px;
    padding: 0 7px;
    font-size: 0.7rem;
  }

  .actions {
    display: flex;
    gap: 10px;
    margin-top: 2px;
  }

  .actions button {
    border: none;
    background: transparent;
    font: inherit;
    font-size: 0.75rem;
    cursor: pointer;
    color: #2158d6;
    padding: 0;
  }

  .actions .danger {
    color: #a32d2d;
  }

  .empty {
    color: #8a887f;
    text-align: center;
    margin-top: 3rem;
  }

  @media (prefers-color-scheme: dark) {
    .home {
      color: #e8e6e1;
    }

    .tag,
    .meta,
    .empty {
      color: #a3a19a;
    }

    .card,
    .menu {
      background: #232320;
      border-color: #373632;
    }

    .title {
      color: #e8e6e1;
    }

    .title:hover,
    .actions button {
      color: #7ea4f5;
    }

    .actions .danger {
      color: #f09595;
    }

    .menu button:hover {
      background: #1d2c50;
    }

    .lang {
      background: #1d2c50;
      color: #b7cdfa;
    }

    .rename {
      background: #1c1c1a;
      color: #e8e6e1;
      border-color: #45443f;
    }
  }
</style>

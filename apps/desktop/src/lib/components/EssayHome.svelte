<script lang="ts">
  import type { DocLocale } from "@tesina/engine";
  import type { EssaySummary } from "$lib/model/essay";
  import { essays } from "$lib/state/essays.svelte";
  import { uiLocale } from "$lib/state/uiLocale.svelte";
  import { m } from "$lib/paraglide/messages";

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
    <p class="tag">{m.home_tagline()}</p>
    <div class="seg" role="group" aria-label={m.home_ui_language_label()}>
      <button
        class:active={uiLocale.current === "es"}
        onclick={() => uiLocale.set("es")}
      >
        ES
      </button>
      <button
        class:active={uiLocale.current === "en"}
        onclick={() => uiLocale.set("en")}
      >
        EN
      </button>
    </div>
    <button
      class="theme"
      onclick={() => uiLocale.cycleTheme()}
      aria-label={m.common_theme()}
      title={m.common_theme()}
    >
      {uiLocale.theme === "light" ? "☀" : uiLocale.theme === "dark" ? "☾" : "◐"}
    </button>
    <div class="new-wrap">
      <button class="new" onclick={() => (creating = !creating)}>
        {m.home_new_essay()}
      </button>
      {#if creating}
        <div class="menu" role="menu">
          <button role="menuitem" onclick={() => createEssay("es")}>
            {m.home_new_in_spanish()}
          </button>
          <button role="menuitem" onclick={() => createEssay("en")}>
            {m.home_new_in_english()}
          </button>
        </div>
      {/if}
    </div>
  </header>

  {#if !essays.loaded}
    <p class="empty">{m.home_loading()}</p>
  {:else if essays.summaries.length === 0}
    <div class="empty">
      <p>{m.home_empty_title()}</p>
      <p>{m.home_empty_body()}</p>
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
            <button onclick={() => startRename(summary)}>
              {m.home_rename()}
            </button>
            <button onclick={() => essays.duplicate(summary.id)}>
              {m.home_duplicate()}
            </button>
            <button
              class="danger"
              onclick={() => handleDelete(summary.id)}
              onblur={() => (confirmingDelete = null)}
            >
              {confirmingDelete === summary.id
                ? m.home_delete_confirm()
                : m.home_delete()}
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
    font-family: var(--font);
    color: var(--fg);
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
    font-family: var(--serif);
    font-weight: 700;
    color: var(--accent);
  }

  .theme {
    width: 30px;
    height: 30px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--muted);
    font-size: 0.95rem;
    cursor: pointer;
    transition: background var(--fast) var(--ease);
  }

  .theme:hover {
    background: var(--hover);
    color: var(--fg);
  }

  .tag {
    margin: 0;
    color: var(--muted);
    font-size: 0.85rem;
    flex: 1;
  }

  .new-wrap {
    position: relative;
  }

  .seg {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 7px;
    overflow: hidden;
  }

  .seg button {
    border: none;
    background: transparent;
    font: inherit;
    font-size: 0.78rem;
    padding: 4px 10px;
    cursor: pointer;
    color: var(--muted);
  }

  .seg button.active {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }

  .new {
    border: none;
    background: var(--accent);
    color: var(--accent-on);
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
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--elev-raised);
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
    background: var(--accent-soft);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
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
    color: var(--fg);
    padding: 0;
  }

  .title:hover {
    color: var(--accent);
  }

  .rename {
    font: inherit;
    font-weight: 600;
    padding: 2px 6px;
    border: 1px solid color-mix(in oklab, var(--accent), transparent 50%);
    border-radius: 6px;
  }

  .meta {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted);
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .lang {
    background: var(--accent-soft);
    color: var(--accent);
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
    color: var(--accent);
    padding: 0;
  }

  .actions .danger {
    color: var(--danger);
  }

  .empty {
    color: var(--muted);
    text-align: center;
    margin-top: 3rem;
  }

  
</style>

<script lang="ts">
  import {
    buildReferenceList,
    type CitationAttrs,
    type CitationItem,
    type DocLocale,
    getTerms,
    plainText,
    type Reference,
  } from "@tesina/engine";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    references: Reference[];
    documentLanguage: DocLocale;
    onInsert: (attrs: CitationAttrs) => void;
    onClose: () => void;
  }

  let { references, documentLanguage, onInsert, onClose }: Props = $props();

  let query = $state("");
  let selectedIds = $state<string[]>([]);
  let mode = $state<CitationAttrs["mode"]>("parenthetical");
  let page = $state("");

  const formatted = $derived.by(() => {
    const listed = buildReferenceList(references, documentLanguage).entries
      .map((entry) => ({
        refId: entry.refId,
        text: plainText(entry.runs),
      }));
    // Personal communications are citable but never listed (APA 8.9); the
    // label follows the DOCUMENT language, so it comes from the engine.
    const pcTerm = getTerms(documentLanguage).personalCommunication;
    const comms = references
      .filter((ref) => ref.type === "personalCommunication")
      .map((ref) => {
        const first = ref.authors[0];
        const name = first
          ? first.kind === "group" ? first.name : first.family
          : "";
        const year = ref.date.year !== undefined ? `, ${ref.date.year}` : "";
        return {
          refId: ref.id,
          text: `${name} — ${pcTerm}${year}`,
        };
      });
    return [...listed, ...comms];
  });

  const visible = $derived(
    query.trim() === ""
      ? formatted
      : formatted.filter((entry) =>
        entry.text.toLowerCase().includes(query.trim().toLowerCase())
      ),
  );

  function toggle(refId: string) {
    selectedIds = selectedIds.includes(refId)
      ? selectedIds.filter((id) => id !== refId)
      : [...selectedIds, refId];
  }

  function insert() {
    if (selectedIds.length === 0) return;
    const trimmedPage = page.trim();
    const items: CitationItem[] = selectedIds.map((refId, index) => {
      const item: CitationItem = { refId };
      if (index === 0 && trimmedPage !== "") {
        item.locator = {
          type: trimmedPage.includes("–") || trimmedPage.includes("-")
            ? "pages"
            : "page",
          value: trimmedPage,
        };
      }
      return item;
    });
    onInsert({ items, mode });
  }
</script>

<div class="pop" role="dialog" aria-label={m.cite_title()}>
  <div class="row head">
    <strong>{m.cite_title()}</strong>
    <button class="close" onclick={onClose} aria-label={m.common_close()}>
      ×
    </button>
  </div>
  <input
    type="search"
    placeholder={m.cite_search_placeholder()}
    bind:value={query}
  />
  <div class="list">
    {#if formatted.length === 0}
      <div class="empty-state is-inline"><p>{m.cite_empty_library()}</p></div>
    {:else if visible.length === 0}
      <div class="empty-state is-inline"><p>{m.cite_no_results({ query })}</p></div>
    {:else}
      {#each visible as entry (entry.refId)}
        <label class="item">
          <input
            type="checkbox"
            checked={selectedIds.includes(entry.refId)}
            onchange={() => toggle(entry.refId)}
          />
          <span>{entry.text}</span>
        </label>
      {/each}
    {/if}
  </div>
  <div class="row">
    <div class="seg" role="group" aria-label={m.cite_title()}>
      <button
        class:active={mode === "parenthetical"}
        onclick={() => (mode = "parenthetical")}
      >
        {m.cite_parenthetical()}
      </button>
      <button
        class:active={mode === "narrative"}
        onclick={() => (mode = "narrative")}
        disabled={selectedIds.length > 1}
      >
        {m.cite_narrative()}
      </button>
    </div>
    <label class="page">
      {m.cite_pages_label()}
      <input
        type="text"
        bind:value={page}
        placeholder={m.cite_pages_placeholder()}
      />
    </label>
  </div>
  <button
    class="insert"
    onclick={insert}
    disabled={selectedIds.length === 0}
  >
    {selectedIds.length > 1
      ? m.cite_insert_many({ count: selectedIds.length })
      : m.cite_insert_one()}
  </button>
</div>

<style>
  .pop {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 30;
    width: 340px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: var(--sp-2);
    box-shadow: var(--elev-raised);
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    font-size: var(--t-body);
    color: var(--fg);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .head {
    justify-content: space-between;
  }

  .close {
    border: none;
    background: transparent;
    font-size: var(--t-h3);
    cursor: pointer;
    color: var(--muted);
  }

  input[type="search"],
  input[type="text"] {
    font: inherit;
    padding: var(--sp-1) var(--sp-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    width: 100%;
    box-sizing: border-box;
  }

  .list {
    max-height: 180px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--sp-05);
  }

  .item {
    display: flex;
    gap: var(--sp-2);
    align-items: flex-start;
    padding: var(--sp-1) var(--sp-15);
    border-radius: 6px;
    cursor: pointer;
  }

  .item:hover {
    background: var(--hover);
  }

  .item span {
    font-family: var(--serif);
    line-height: 1.4;
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
    font-size: var(--t-small);
    padding: var(--sp-1) var(--sp-2);
    cursor: pointer;
    color: var(--muted);
  }

  .seg button.active {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }

  .seg button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .page {
    display: flex;
    align-items: center;
    gap: var(--sp-15);
    flex: 1;
    color: var(--muted);
  }

  .insert {
    border: none;
    background: var(--accent);
    color: var(--accent-on);
    font: inherit;
    font-size: var(--t-body);
    padding: var(--sp-15) var(--sp-2);
    border-radius: 7px;
    cursor: pointer;
  }

  .insert:disabled {
    opacity: 0.5;
    cursor: default;
  }

  
</style>

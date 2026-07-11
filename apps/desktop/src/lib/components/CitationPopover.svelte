<script lang="ts">
  import {
    buildReferenceList,
    type CitationAttrs,
    type CitationItem,
    type DocLocale,
    plainText,
    type Reference,
  } from "@tesina/engine";

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
    // Personal communications are citable but never listed (APA 8.9).
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
          text: `${name} — comunicación personal${year}`,
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

<div class="pop" role="dialog" aria-label="Insertar cita">
  <div class="row head">
    <strong>Insertar cita</strong>
    <button class="close" onclick={onClose} aria-label="Cerrar">×</button>
  </div>
  <input
    type="search"
    placeholder="Buscar en la biblioteca…"
    bind:value={query}
  />
  <div class="list">
    {#if formatted.length === 0}
      <p class="empty">
        La biblioteca está vacía. Usa "Añadir referencia" para crear la
        primera.
      </p>
    {:else if visible.length === 0}
      <p class="empty">Sin resultados para "{query}".</p>
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
    <div class="seg" role="group" aria-label="Tipo de cita">
      <button
        class:active={mode === "parenthetical"}
        onclick={() => (mode = "parenthetical")}
      >
        Parentética
      </button>
      <button
        class:active={mode === "narrative"}
        onclick={() => (mode = "narrative")}
        disabled={selectedIds.length > 1}
      >
        Narrativa
      </button>
    </div>
    <label class="page">
      Página(s)
      <input type="text" bind:value={page} placeholder="12 o 12–14" />
    </label>
  </div>
  <button
    class="insert"
    onclick={insert}
    disabled={selectedIds.length === 0}
  >
    Insertar {selectedIds.length > 1 ? `${selectedIds.length} obras` : "cita"}
  </button>
</div>

<style>
  .pop {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 30;
    width: 340px;
    background: #fff;
    border: 1px solid #d7d4cf;
    border-radius: 10px;
    padding: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 0.82rem;
    color: #26251f;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .head {
    justify-content: space-between;
  }

  .close {
    border: none;
    background: transparent;
    font-size: 1rem;
    cursor: pointer;
    color: #6b6a64;
  }

  input[type="search"],
  input[type="text"] {
    font: inherit;
    padding: 5px 8px;
    border: 1px solid #d7d4cf;
    border-radius: 6px;
    width: 100%;
    box-sizing: border-box;
  }

  .list {
    max-height: 180px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .item {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 5px 6px;
    border-radius: 6px;
    cursor: pointer;
  }

  .item:hover {
    background: #f4f3f0;
  }

  .item span {
    font-family: Georgia, serif;
    line-height: 1.4;
  }

  .empty {
    color: #6b6a64;
    margin: 4px 2px;
  }

  .seg {
    display: flex;
    border: 1px solid #d7d4cf;
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
    color: #6b6a64;
  }

  .seg button.active {
    background: #eaf1fe;
    color: #173a8c;
    font-weight: 600;
  }

  .seg button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .page {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    color: #6b6a64;
  }

  .insert {
    border: none;
    background: #2158d6;
    color: #fff;
    font: inherit;
    font-size: 0.82rem;
    padding: 7px 10px;
    border-radius: 7px;
    cursor: pointer;
  }

  .insert:disabled {
    opacity: 0.5;
    cursor: default;
  }

  @media (prefers-color-scheme: dark) {
    .pop {
      background: #232320;
      border-color: #45443f;
      color: #e8e6e1;
    }

    input[type="search"],
    input[type="text"],
    .seg {
      border-color: #45443f;
      background: #1c1c1a;
      color: #e8e6e1;
    }

    .item:hover {
      background: #2b2b28;
    }

    .empty,
    .close,
    .page,
    .seg button {
      color: #a3a19a;
    }

    .seg button.active {
      background: #1d2c50;
      color: #b7cdfa;
    }
  }
</style>

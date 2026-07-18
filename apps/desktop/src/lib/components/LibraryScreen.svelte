<script lang="ts">
  import {
    buildReferenceList,
    getTerms,
    type Reference,
  } from "@tesina/engine";
  import { essays } from "$lib/state/essays.svelte";
  import { library } from "$lib/state/library.svelte";
  import { uiLocale } from "$lib/state/uiLocale.svelte";
  import RefEntry from "$lib/components/RefEntry.svelte";
  import ReferenceQuickForm from "$lib/components/ReferenceQuickForm.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import BibImportModal from "$lib/components/BibImportModal.svelte";
  import { m } from "$lib/paraglide/messages";

  /** Largest .bib we'll read into memory (huge for a bibliography). */
  const MAX_BIB_BYTES = 5_000_000;

  interface Props {
    /** Return to whatever opened the manager (Home or the editor). */
    onBack: () => void;
  }

  let { onBack }: Props = $props();

  // ── Reference list ──────────────────────────────────────────────
  let search = $state("");
  let activeCollection = $state<string | null>(null);

  // Every reference, in APA list order, with a personal-communication label
  // and a searchable string. Personal communications are absent from the
  // engine list (APA 8.9) but must stay manageable here, so we append them.
  const items = $derived.by(() => {
    const terms = getTerms(uiLocale.current);
    const byId = new Map(library.references.map((r) => [r.id, r]));
    const ordered: Reference[] = [];
    const seen = new Set<string>();
    for (
      const e of buildReferenceList(library.references, uiLocale.current)
        .entries
    ) {
      const ref = byId.get(e.refId);
      if (ref) {
        ordered.push(ref);
        seen.add(ref.id);
      }
    }
    for (const ref of library.references) {
      if (!seen.has(ref.id)) ordered.push(ref);
    }
    return ordered.map((ref) => {
      const personal = ref.type === "personalCommunication";
      let label = "";
      if (personal) {
        const first = ref.authors[0];
        const name = first
          ? first.kind === "group" ? first.name : first.family
          : "";
        label = `${name} — ${terms.personalCommunication}`;
      }
      return { ref, personal, label, search: JSON.stringify(ref).toLowerCase() };
    });
  });

  const visible = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const active = activeCollection
      ? library.collections.find((c) => c.id === activeCollection)
      : null;
    const members = active ? new Set(active.refIds) : null;
    return items.filter((it) => {
      if (members && !members.has(it.ref.id)) return false;
      if (q !== "" && !it.search.includes(q)) return false;
      return true;
    });
  });

  const countLabel = $derived(
    visible.length === 1
      ? m.libm_count_one()
      : m.libm_count_many({ count: visible.length }),
  );

  // ── Edit pane ───────────────────────────────────────────────────
  let selected = $state<Reference | undefined>(undefined);
  let addNonce = $state(0);
  // Remount the form on selection change; a fresh nonce clears it for a new ref.
  const formKey = $derived(selected ? selected.id : `new-${addNonce}`);

  function selectRef(ref: Reference) {
    selected = ref;
  }

  function newReference() {
    selected = undefined;
    addNonce += 1;
  }

  function handleSave(ref: Reference) {
    if (selected) {
      library.update(ref);
      selected = ref;
    } else {
      library.add(ref);
      addNonce += 1;
    }
  }

  // ── BibTeX import ───────────────────────────────────────────────
  let bibInput = $state<HTMLInputElement | undefined>(undefined);
  let bibText = $state<string | null>(null);
  let bibError = $state<string | null>(null);

  async function handleBibFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    bibError = null;
    if (!file) return;
    if (file.size > MAX_BIB_BYTES) {
      bibError = m.bib_file_too_big();
      return;
    }
    try {
      bibText = await file.text();
    } catch (err) {
      console.error("No se pudo leer el archivo .bib:", err);
      bibError = m.bib_read_error();
    }
  }

  // ── Safe delete (scan essays first) ─────────────────────────────
  let deleteTarget = $state<
    { ref: Reference; citing: { id: string; title: string }[] } | null
  >(null);
  let scanning = $state(false);

  async function askDelete(ref: Reference) {
    scanning = true;
    try {
      const citing = await essays.essaysCiting(ref.id);
      deleteTarget = { ref, citing };
    } finally {
      scanning = false;
    }
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.ref.id;
    library.remove(id);
    if (selected?.id === id) newReference();
    deleteTarget = null;
  }

  // ── Collections CRUD ────────────────────────────────────────────
  let addingCollection = $state(false);
  let newCollectionName = $state("");
  let renamingCollection = $state<string | null>(null);
  let renameValue = $state("");
  let confirmingCollectionDelete = $state<string | null>(null);

  function startAddCollection() {
    addingCollection = true;
    newCollectionName = "";
  }

  function commitAddCollection() {
    const name = newCollectionName.trim();
    // Clear first: Enter hides the input, and a follow-up blur must not
    // re-run this and create a duplicate.
    newCollectionName = "";
    addingCollection = false;
    if (name !== "") library.createCollection(name);
  }

  function startRenameCollection(id: string, name: string) {
    renamingCollection = id;
    renameValue = name;
  }

  function commitRenameCollection() {
    if (renamingCollection && renameValue.trim() !== "") {
      library.renameCollection(renamingCollection, renameValue);
    }
    renamingCollection = null;
  }

  function deleteCollection(id: string) {
    if (confirmingCollectionDelete !== id) {
      confirmingCollectionDelete = id;
      return;
    }
    confirmingCollectionDelete = null;
    if (activeCollection === id) activeCollection = null;
    library.deleteCollection(id);
  }
</script>

<div class="app">
  <header class="titlebar" data-tauri-drag-region>
    <div class="tb-left">
      <div class="traffic-space"></div>
      <button class="back" onclick={onBack}>{m.libm_back()}</button>
    </div>
    <div class="titlebar-title" data-tauri-drag-region>
      <span class="mark">T</span>
      {m.libm_title()}
    </div>
    <div class="tb-right">
      <button
        class="icon-btn"
        onclick={() => uiLocale.cycleTheme()}
        aria-label={m.common_theme()}
        title={m.common_theme()}
      >
        {uiLocale.theme === "light"
          ? "☀"
          : uiLocale.theme === "dark"
          ? "☾"
          : "◐"}
      </button>
    </div>
  </header>

  <section class="cols">
    <!-- Collections -->
    <aside class="collections">
      <div class="col-head">{m.libm_collections()}</div>
      <button
        class="coll"
        class:active={activeCollection === null}
        onclick={() => (activeCollection = null)}
      >
        <span class="coll-name">{m.libm_all()}</span>
        <span class="count">{library.references.length}</span>
      </button>

      {#each library.collections as c (c.id)}
        {#if renamingCollection === c.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="coll-input"
            type="text"
            bind:value={renameValue}
            autofocus
            onblur={commitRenameCollection}
            onkeydown={(e) => {
              if (e.key === "Enter") commitRenameCollection();
              if (e.key === "Escape") renamingCollection = null;
            }}
          />
        {:else}
          <div class="coll-row">
            <button
              class="coll"
              class:active={activeCollection === c.id}
              onclick={() => (activeCollection = c.id)}
            >
              <span class="coll-name">{c.name}</span>
              <span class="count">{c.refIds.length}</span>
            </button>
            <div class="coll-actions">
              <button
                class="mini"
                title={m.libm_rename()}
                aria-label={m.libm_rename()}
                onclick={() => startRenameCollection(c.id, c.name)}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.7"
                ><path d="M4 20h4L18 10l-4-4L4 16z" /><path
                    d="M13.5 6.5l4 4"
                  /></svg>
              </button>
              <button
                class="mini del"
                onclick={() => deleteCollection(c.id)}
                onblur={() => (confirmingCollectionDelete = null)}
              >
                {confirmingCollectionDelete === c.id
                  ? m.libm_delete_short_confirm()
                  : m.libm_delete()}
              </button>
            </div>
          </div>
        {/if}
      {/each}

      {#if addingCollection}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="coll-input"
          type="text"
          placeholder={m.libm_collection_name_ph()}
          bind:value={newCollectionName}
          autofocus
          onblur={commitAddCollection}
          onkeydown={(e) => {
            if (e.key === "Enter") commitAddCollection();
            if (e.key === "Escape") addingCollection = false;
          }}
        />
      {:else}
        <button class="add-coll" onclick={startAddCollection}>
          + {m.libm_new_collection()}
        </button>
      {/if}
    </aside>

    <!-- Reference list -->
    <div class="list-col">
      <div class="list-head">
        <div class="search">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
          ><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input
            type="text"
            placeholder={m.libm_search()}
            bind:value={search}
            aria-label={m.libm_search()}
          />
        </div>
        <button class="btn btn-secondary" onclick={() => bibInput?.click()}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          ><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" /></svg>
          {m.libm_import_bibtex()}
        </button>
        <input
          bind:this={bibInput}
          type="file"
          accept=".bib"
          class="hidden-file"
          onchange={handleBibFile}
        />
        <button class="btn btn-primary" onclick={newReference}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          ><path d="M12 5v14M5 12h14" /></svg>
          {m.libm_new_ref()}
        </button>
      </div>
      {#if bibError}
        <p class="bib-error" role="alert">{bibError}</p>
      {/if}
      <div class="list-count">{countLabel}</div>

      <div class="list-scroll">
        {#if library.references.length === 0}
          <p class="empty">{m.libm_empty_library()}</p>
        {:else if visible.length === 0}
          <p class="empty">
            {search.trim() !== ""
              ? m.libm_no_results()
              : m.libm_empty_collection()}
          </p>
        {:else}
          {#each visible as item (item.ref.id)}
            <div
              class="ref-card"
              class:selected={selected?.id === item.ref.id}
              role="button"
              tabindex="0"
              onclick={() => selectRef(item.ref)}
              onkeydown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectRef(item.ref);
                }
              }}
            >
              {#if item.personal}
                <p class="pc-entry">{item.label}</p>
              {:else}
                <RefEntry reference={item.ref} language={uiLocale.current} />
              {/if}
              {#if library.collections.length > 0}
                <div class="chips">
                  {#each library.collections as c (c.id)}
                    <button
                      class="chip"
                      class:on={c.refIds.includes(item.ref.id)}
                      onclick={(e) => {
                        e.stopPropagation();
                        library.toggleMembership(c.id, item.ref.id);
                      }}
                    >
                      {c.name}
                    </button>
                  {/each}
                </div>
              {/if}
              <div class="card-foot">
                <button
                  class="del"
                  disabled={scanning}
                  onclick={(e) => {
                    e.stopPropagation();
                    askDelete(item.ref);
                  }}
                >
                  {m.libm_delete()}
                </button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <!-- Edit pane -->
    <div class="edit-col">
      {#key formKey}
        <ReferenceQuickForm
          inline
          language={uiLocale.current}
          initial={selected}
          onSave={handleSave}
          onImportBibtex={() => bibInput?.click()}
          onClose={newReference}
        />
      {/key}
    </div>
  </section>
</div>

{#if deleteTarget}
  <Modal title={m.libm_delete_title()} onClose={() => (deleteTarget = null)}>
    {#if deleteTarget.citing.length === 0}
      <p class="del-body">{m.libm_delete_uncited()}</p>
    {:else}
      <p class="del-body">
        {deleteTarget.citing.length === 1
          ? m.libm_delete_cited_one()
          : m.libm_delete_cited_many({ count: deleteTarget.citing.length })}
      </p>
      <ul class="cited-list">
        {#each deleteTarget.citing as e (e.id)}
          <li>{e.title}</li>
        {/each}
      </ul>
      <p class="del-note">{m.libm_delete_cited_note()}</p>
    {/if}
    {#snippet footer()}
      <button class="btn btn-ghost" onclick={() => (deleteTarget = null)}>
        {m.common_close()}
      </button>
      <button class="btn btn-danger" onclick={confirmDelete}>
        {m.libm_delete_confirm()}
      </button>
    {/snippet}
  </Modal>
{/if}

{#if bibText !== null}
  <BibImportModal
    {bibText}
    onDone={() => (bibText = null)}
    onClose={() => (bibText = null)}
  />
{/if}

<style>
  .app {
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--canvas);
  }

  .titlebar {
    height: 40px;
    flex: 0 0 40px;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    padding: 0 12px;
    background: var(--chrome);
    border-bottom: 1px solid var(--border);
    user-select: none;
    -webkit-user-select: none;
  }

  .tb-left {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .traffic-space {
    width: 70px;
  }

  .back {
    border: none;
    background: none;
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    color: var(--fg-2);
    padding: 6px 10px;
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: background var(--fast) var(--ease), color var(--fast) var(--ease);
  }

  .back:hover {
    background: var(--hover);
    color: var(--fg);
  }

  .titlebar-title {
    justify-self: center;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--fg-2);
  }

  .mark {
    width: 16px;
    height: 16px;
    border-radius: 5px;
    background: var(--accent);
    color: var(--accent-on);
    display: grid;
    place-items: center;
    font-size: 10px;
    font-weight: 700;
    font-family: var(--serif);
  }

  .tb-right {
    justify-self: end;
    display: flex;
    gap: 6px;
  }

  .icon-btn {
    width: 30px;
    height: 30px;
    border: none;
    background: none;
    border-radius: var(--r-sm);
    display: grid;
    place-items: center;
    color: var(--muted);
    cursor: pointer;
    transition: background var(--fast) var(--ease), color var(--fast) var(--ease);
  }

  .icon-btn:hover {
    background: var(--hover);
    color: var(--fg);
  }

  .cols {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr) 440px;
  }

  /* ── Collections column ── */
  .collections {
    background: var(--chrome);
    border-right: 1px solid var(--border);
    padding: 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    overflow-y: auto;
  }

  .col-head {
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    padding: 4px 8px 8px;
    font-weight: 600;
  }

  .coll-row {
    display: flex;
    align-items: center;
  }

  .coll {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: none;
    background: none;
    border-radius: var(--r-sm);
    color: var(--fg-2);
    font-size: 13.5px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    min-width: 0;
    transition: background var(--fast) var(--ease), color var(--fast) var(--ease);
  }

  .coll-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .coll:hover {
    background: var(--hover);
  }

  .coll.active {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .count {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
    background: var(--hover);
    padding: 1px 7px;
    border-radius: var(--r-pill);
    flex: 0 0 auto;
  }

  .coll-actions {
    display: none;
    align-items: center;
    gap: 2px;
  }

  .coll-row:hover .coll-actions,
  .coll-row:focus-within .coll-actions {
    display: flex;
  }

  .mini {
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 6px;
    font: inherit;
    font-size: 11.5px;
    display: grid;
    place-items: center;
  }

  .mini :global(svg) {
    width: 15px;
    height: 15px;
  }

  .mini:hover {
    background: var(--hover);
    color: var(--fg);
  }

  .mini.del:hover {
    background: color-mix(in oklab, var(--danger), transparent 90%);
    color: var(--danger);
  }

  .coll-input {
    font: inherit;
    font-size: 13.5px;
    padding: 7px 9px;
    border: 1px solid var(--accent);
    border-radius: var(--r-sm);
    background: var(--surface);
    color: var(--fg);
    box-shadow: var(--focus-ring);
    outline: none;
    margin: 1px 0;
  }

  .add-coll {
    margin-top: 6px;
    border: 1px dashed var(--border);
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    padding: 8px 10px;
    border-radius: var(--r-sm);
    cursor: pointer;
    text-align: left;
    transition: color var(--fast) var(--ease), border-color var(--fast) var(--ease);
  }

  .add-coll:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  /* ── Reference list column ── */
  .list-col {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .list-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 20px 8px;
  }

  .search {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    padding: 0 10px;
    height: 38px;
    min-width: 0;
    transition: border-color var(--fast) var(--ease);
  }

  .search:focus-within {
    border-color: var(--accent);
    box-shadow: var(--focus-ring);
  }

  .search :global(svg) {
    width: 15px;
    height: 15px;
    color: var(--muted);
    flex: 0 0 auto;
  }

  .search input {
    border: 0;
    background: none;
    outline: none;
    width: 100%;
    font: inherit;
    font-size: 13.5px;
    color: var(--fg);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 16px;
    border-radius: var(--r-sm);
    font: inherit;
    font-size: 13.5px;
    font-weight: 600;
    border: 1px solid transparent;
    cursor: pointer;
    white-space: nowrap;
    transition: background var(--fast) var(--ease);
  }

  .btn :global(svg) {
    width: 16px;
    height: 16px;
  }

  .btn-primary {
    background: var(--accent);
    color: var(--accent-on);
  }

  .btn-primary:hover {
    background: var(--accent-hover);
  }

  .btn-secondary {
    background: transparent;
    color: var(--fg);
    border-color: var(--border);
  }

  .btn-secondary:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
  }

  .hidden-file {
    display: none;
  }

  .bib-error {
    margin: 0;
    padding: 6px 20px 0;
    color: var(--warn-strong);
    font-size: 13px;
  }

  .list-count {
    padding: 0 20px 8px;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
  }

  .list-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 20px 24px;
  }

  .ref-card {
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--surface);
    margin-bottom: 10px;
    cursor: pointer;
    text-align: left;
    transition: border-color var(--fast) var(--ease), box-shadow var(--fast) var(--ease);
  }

  .ref-card:hover {
    border-color: color-mix(in oklab, var(--accent), var(--border) 55%);
  }

  .ref-card.selected {
    border-color: var(--accent);
    box-shadow: var(--focus-ring);
  }

  .pc-entry {
    margin: 0;
    font-family: var(--serif);
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--fg-2);
    overflow-wrap: anywhere;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .chip {
    font: inherit;
    font-size: 11.5px;
    padding: 3px 9px;
    border-radius: var(--r-pill);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
    transition: all var(--fast) var(--ease);
  }

  .chip:hover {
    border-color: var(--muted);
    color: var(--fg);
  }

  .chip.on {
    background: var(--accent-soft);
    border-color: color-mix(in oklab, var(--accent), transparent 40%);
    color: var(--accent);
    font-weight: 600;
  }

  .card-foot {
    display: flex;
    justify-content: flex-end;
    margin-top: 8px;
  }

  .card-foot .del {
    font: inherit;
    font-size: 12px;
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
    padding: 3px 8px;
    border-radius: 6px;
  }

  .card-foot .del:hover:enabled {
    background: color-mix(in oklab, var(--danger), transparent 90%);
    color: var(--danger);
  }

  .card-foot .del:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .empty {
    color: var(--muted);
    text-align: center;
    margin-top: 3rem;
  }

  /* ── Edit pane column ── */
  .edit-col {
    display: grid;
    min-height: 0;
    border-left: 1px solid var(--border);
    background: var(--surface);
    overflow: hidden;
  }

  /* ── Delete modal ── */
  .del-body {
    margin: 0;
    color: var(--fg-2);
  }

  .cited-list {
    margin: 10px 0 0;
    padding-left: 20px;
    color: var(--fg-2);
    font-size: 13px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .del-note {
    margin: 12px 0 0;
    color: var(--muted);
    font-size: 12.5px;
  }

  .btn-danger {
    background: var(--danger);
    color: #fff;
  }

  .btn-danger:hover {
    background: color-mix(in oklab, var(--danger), #000 12%);
  }
</style>

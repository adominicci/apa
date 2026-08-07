<script lang="ts">
  import type { DocLocale } from "@tesina/engine";
  import type { EssaySummary } from "$lib/model/essay";
  import { essays } from "$lib/state/essays.svelte";
  import { uiLocale } from "$lib/state/uiLocale.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    onCreate: (language: DocLocale) => void;
    onOpen: (id: string) => void;
    onOpenLibrary: () => void;
  }

  let { onCreate, onOpen, onOpenLibrary }: Props = $props();

  type View = "all" | "recent" | "drafts" | "templates";
  type Chip = "all" | "es" | "en" | "unfinished";

  let view = $state<View>("all");
  let chip = $state<Chip>("all");
  let search = $state("");
  let creating = $state(false);
  let settingsOpen = $state(false);
  let renamingId = $state<string | null>(null);
  let renameValue = $state("");
  let confirmingDelete = $state<string | null>(null);

  const filtered = $derived.by(() => {
    let list = essays.summaries;
    if (view === "recent") list = list.slice(0, 5);
    if (view === "drafts") list = list.filter((s) => s.words === 0);
    if (chip === "es") list = list.filter((s) => s.language === "es");
    if (chip === "en") list = list.filter((s) => s.language === "en");
    if (chip === "unfinished") list = list.filter((s) => s.words === 0);
    const q = search.trim().toLowerCase();
    if (q !== "") list = list.filter((s) => s.title.toLowerCase().includes(q));
    return list;
  });

  function createEssay(language: DocLocale) {
    creating = false;
    onCreate(language);
  }

  function startRename(summary: EssaySummary) {
    renamingId = summary.id;
    renameValue = summary.title;
  }

  async function commitRename() {
    if (renamingId) await essays.rename(renamingId, renameValue);
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
      const date = new Date(iso);
      const tag = uiLocale.current === "es" ? "es" : "en";
      const day = new Intl.DateTimeFormat(tag, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date);
      const time = new Intl.DateTimeFormat(tag, {
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
      return `${day.replaceAll(".", "")}, ${time}`;
    } catch {
      return iso;
    }
  }
</script>

<div class="app">
  <header class="titlebar" data-tauri-drag-region>
    <div class="traffic-space"></div>
    <div class="titlebar-title" data-tauri-drag-region>
      <span class="mark">T</span> Tesina
    </div>
    <div class="titlebar-actions">
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

  <section class="view-home">
    <aside class="sidebar">
      <div class="brand"><span class="logo">T</span><b>Tesina</b></div>

      <div class="nav-label">{m.side_library()}</div>
      <button class="nav-item" class:active={view === "all"} onclick={() => (view = "all")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 5h16M4 12h16M4 19h10" /></svg>
        {m.side_all()} <span class="count">{essays.summaries.length}</span>
      </button>
      <button class="nav-item" class:active={view === "recent"} onclick={() => (view = "recent")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>
        {m.side_recent()}
      </button>
      <button class="nav-item" class:active={view === "drafts"} onclick={() => (view = "drafts")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M15 4l5 5-11 11H4v-5z" /></svg>
        {m.side_drafts()}
      </button>

      <div class="nav-label">{m.side_resources()}</div>
      <button class="nav-item" onclick={onOpenLibrary}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 4h11a2 2 0 0 1 2 2v14l-4-2-4 2V6H6z" /><path d="M6 4v16" /></svg>
        {m.side_global_refs()}
      </button>
      <button class="nav-item" class:active={view === "templates"} onclick={() => (view = "templates")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>
        {m.side_templates()}
      </button>

      <div class="spacer"></div>
      <button class="nav-item" onclick={() => (settingsOpen = true)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1l2.1-2.1M17 7l2.1-2.1" /></svg>
        {m.side_settings()}
      </button>
      <div class="foot">{m.side_version()}</div>
    </aside>

    <div class="home-main">
      {#if view === "templates"}
        <header class="home-head">
          <div>
            <h1>{m.templates_title()}</h1>
            <p>{m.templates_sub()}</p>
          </div>
        </header>
        <div class="lib">
          <div class="grid">
            {#each [
              { lang: "es" as DocLocale, name: m.template_student(), sub: m.template_in_spanish() },
              { lang: "en" as DocLocale, name: m.template_student(), sub: m.template_in_english() },
            ] as tpl (tpl.name + tpl.sub)}
              <button class="essay tpl" onclick={() => createEssay(tpl.lang)}>
                <div class="essay-thumb">
                  <div class="ln title"></div>
                  <div class="ln"></div>
                  <div class="ln short"></div>
                </div>
                <div class="essay-top">
                  <h3>{tpl.name}</h3>
                  <span class="badge">{tpl.lang.toUpperCase()}</span>
                </div>
                <div class="meta">{tpl.sub}</div>
                <div class="essay-actions">
                  <span class="use">{m.template_use()}</span>
                </div>
              </button>
            {/each}
          </div>
        </div>
      {:else}
        <header class="home-head">
          <div>
            <h1>{m.home_title()}</h1>
            <p>{m.home_tagline2()}</p>
          </div>
          <div class="head-tools">
            <div class="search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input
                type="text"
                placeholder={m.home_search()}
                bind:value={search}
                aria-label={m.home_search()}
              />
            </div>
            <div class="segmented" role="group" aria-label={m.home_ui_language_label()}>
              <button class:active={uiLocale.current === "es"} onclick={() => uiLocale.set("es")}>ES</button>
              <button class:active={uiLocale.current === "en"} onclick={() => uiLocale.set("en")}>EN</button>
            </div>
            <div class="new-wrap">
              <button class="btn btn-primary" onclick={() => (creating = !creating)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" /></svg>
                {m.home_new_card_title()}
              </button>
              {#if creating}
                <div class="menu" role="menu">
                  <button role="menuitem" onclick={() => createEssay("es")}>{m.home_new_in_spanish()}</button>
                  <button role="menuitem" onclick={() => createEssay("en")}>{m.home_new_in_english()}</button>
                </div>
              {/if}
            </div>
          </div>
        </header>

        <div class="lib">
          <div class="lib-filters">
            <button class="chip" class:active={chip === "all"} onclick={() => (chip = "all")}>{m.chip_all()}</button>
            <button class="chip" class:active={chip === "es"} onclick={() => (chip = "es")}>{m.chip_spanish()}</button>
            <button class="chip" class:active={chip === "en"} onclick={() => (chip = "en")}>{m.chip_english()}</button>
            <button class="chip" class:active={chip === "unfinished"} onclick={() => (chip = "unfinished")}>{m.chip_unfinished()}</button>
            <span class="lib-count">
              {filtered.length === 1
                ? m.lib_count_one()
                : m.lib_count_many({ count: filtered.length })}
            </span>
          </div>

          {#if !essays.loaded}
            <p class="empty">{m.home_loading()}</p>
          {:else}
            <div class="grid">
              {#each filtered as summary (summary.id)}
                <div
                  class="essay"
                  role="button"
                  tabindex="0"
                  onclick={() => {
                    if (renamingId !== summary.id) onOpen(summary.id);
                  }}
                  onkeydown={(e) => {
                    if (e.key === "Enter") onOpen(summary.id);
                  }}
                >
                  <div class="essay-thumb">
                    {#if summary.preview}
                      <p class="thumb-text">{summary.preview}</p>
                    {:else}
                      <p class="thumb-empty">{m.home_blank_doc()}</p>
                    {/if}
                  </div>
                  <div class="essay-top">
                    {#if renamingId === summary.id}
                      <input
                        class="rename"
                        type="text"
                        bind:value={renameValue}
                        onclick={(e) => e.stopPropagation()}
                        onblur={commitRename}
                        onkeydown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") renamingId = null;
                        }}
                      />
                    {:else}
                      <h3>{summary.title}</h3>
                    {/if}
                    <span class="badge">{summary.language.toUpperCase()}</span>
                  </div>
                  {#if summary.course || summary.instructor}
                    <p class="course-line">
                      {[summary.course, summary.instructor].filter(Boolean).join(
                        " · ",
                      )}
                    </p>
                  {/if}
                  <div class="meta">
                    <span>{formatDate(summary.updatedAt)}</span>
                    <span>{m.home_words_meta({ count: summary.words })}</span>
                  </div>
                  <div class="essay-actions">
                    <button onclick={(e) => { e.stopPropagation(); startRename(summary); }}>
                      {m.home_rename()}
                    </button>
                    <button onclick={(e) => { e.stopPropagation(); essays.duplicate(summary.id); }}>
                      {m.home_duplicate()}
                    </button>
                    <span class="grow"></span>
                    <button
                      class="del"
                      onclick={(e) => { e.stopPropagation(); handleDelete(summary.id); }}
                      onblur={() => (confirmingDelete = null)}
                    >
                      {confirmingDelete === summary.id
                        ? m.home_delete_confirm()
                        : m.home_delete()}
                    </button>
                  </div>
                </div>
              {/each}
              <button class="essay new" onclick={() => createEssay(uiLocale.current)}>
                <span class="plus">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M12 5v14M5 12h14" /></svg>
                </span>
                <b>{m.home_new_card_title()}</b>
                <span class="sub">{m.home_new_card_sub()}</span>
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </section>
</div>

{#if settingsOpen}
  <Modal title={m.settings_title()} onClose={() => (settingsOpen = false)}>
    <div class="field">
      <span>{m.settings_ui_language()}</span>
      <div class="seg">
        <button class:active={uiLocale.current === "es"} onclick={() => uiLocale.set("es")}>ES</button>
        <button class:active={uiLocale.current === "en"} onclick={() => uiLocale.set("en")}>EN</button>
      </div>
    </div>
    <div class="field">
      <span>{m.settings_theme()}</span>
      <div class="seg">
        <button class:active={uiLocale.theme === "light"} onclick={() => uiLocale.setTheme("light")}>{m.theme_light()}</button>
        <button class:active={uiLocale.theme === "dark"} onclick={() => uiLocale.setTheme("dark")}>{m.theme_dark()}</button>
        <button class:active={uiLocale.theme === "system"} onclick={() => uiLocale.setTheme("system")}>{m.theme_system()}</button>
      </div>
    </div>
  </Modal>
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

  .traffic-space {
    width: 70px;
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

  .titlebar-actions {
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

  .view-home {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: 232px 1fr;
  }

  .sidebar {
    background: var(--chrome);
    border-right: 1px solid var(--border);
    padding: 18px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px 16px;
  }

  .brand .logo {
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: var(--accent);
    color: var(--accent-on);
    display: grid;
    place-items: center;
    font-family: var(--serif);
    font-weight: 700;
    font-size: 17px;
  }

  .brand b {
    font-size: 16px;
    letter-spacing: -0.02em;
  }

  .nav-label {
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    padding: 14px 8px 6px;
    font-weight: 600;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: none;
    background: none;
    border-radius: var(--r-sm);
    color: var(--fg-2);
    font-size: 13.5px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: background var(--fast) var(--ease), color var(--fast) var(--ease);
  }

  .nav-item :global(svg) {
    width: 17px;
    height: 17px;
    color: var(--muted);
    flex: 0 0 auto;
  }

  .nav-item:hover {
    background: var(--hover);
  }

  .nav-item.active {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .nav-item.active :global(svg) {
    color: var(--accent);
  }

  .count {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
    background: var(--hover);
    padding: 1px 7px;
    border-radius: var(--r-pill);
  }

  .sidebar .spacer {
    flex: 1 1 auto;
  }

  .foot {
    padding: 8px;
    color: var(--muted);
    font-size: 11.5px;
    font-family: var(--mono);
  }

  .home-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow-y: auto;
  }

  .home-head {
    padding: 30px clamp(20px, 4vw, 48px) 18px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
  }

  .home-head h1 {
    margin: 0 0 4px;
    font-size: clamp(24px, 3vw, 30px);
    letter-spacing: -0.025em;
    font-weight: 600;
  }

  .home-head p {
    margin: 0;
    color: var(--muted);
    font-size: 14px;
  }

  .head-tools {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    padding: 0 10px;
    height: 38px;
    min-width: 200px;
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
    font-size: 13.5px;
    color: var(--fg);
  }

  .segmented {
    display: inline-flex;
    background: var(--hover);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    padding: 3px;
  }

  .segmented button {
    padding: 6px 12px;
    border: none;
    background: none;
    border-radius: 6px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
    cursor: pointer;
    letter-spacing: 0.01em;
    transition: background var(--fast) var(--ease), color var(--fast) var(--ease);
  }

  .segmented button.active {
    background: var(--surface);
    color: var(--fg);
    box-shadow: var(--elev-raised);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 16px;
    border-radius: var(--r-sm);
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

  .new-wrap {
    position: relative;
  }

  .menu {
    position: absolute;
    right: 0;
    top: 110%;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    box-shadow: var(--elev-raised);
    display: flex;
    flex-direction: column;
    min-width: 150px;
    z-index: 10;
    overflow: hidden;
  }

  .menu button {
    border: none;
    background: none;
    font-size: 13px;
    text-align: left;
    padding: 8px 12px;
    cursor: pointer;
    color: var(--fg);
  }

  .menu button:hover {
    background: var(--hover);
  }

  .lib {
    padding: 8px clamp(20px, 4vw, 48px) 48px;
  }

  .lib-filters {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 18px;
    flex-wrap: wrap;
  }

  .chip {
    padding: 5px 12px;
    border-radius: var(--r-pill);
    font-size: 12.5px;
    font-weight: 500;
    border: 1px solid var(--border);
    color: var(--muted);
    background: var(--surface);
    cursor: pointer;
    transition: all var(--fast) var(--ease);
  }

  .chip:hover {
    color: var(--fg);
    border-color: var(--muted);
  }

  .chip.active {
    background: var(--fg);
    color: var(--bg);
    border-color: var(--fg);
  }

  .lib-count {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 16px;
  }

  .essay {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    padding: 18px 18px 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    cursor: pointer;
    position: relative;
    text-align: left;
    font: inherit;
    color: var(--fg);
    transition: border-color var(--fast) var(--ease), box-shadow var(--fast) var(--ease), transform var(--fast) var(--ease);
  }

  .essay:hover {
    border-color: color-mix(in oklab, var(--accent), var(--border) 55%);
    box-shadow: var(--elev-raised);
    transform: translateY(-2px);
  }

  .essay-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }

  .essay-thumb {
    height: 74px;
    border-radius: var(--r-sm);
    background: linear-gradient(180deg, var(--paper), color-mix(in oklab, var(--paper), var(--fg) 4%));
    border: 1px solid var(--border-soft);
    padding: 12px 14px;
    overflow: hidden;
  }

  .ln {
    height: 4px;
    border-radius: 2px;
    background: color-mix(in oklab, var(--fg), transparent 86%);
    margin-bottom: 6px;
  }

  .ln.title {
    width: 60%;
    background: color-mix(in oklab, var(--fg), transparent 70%);
    height: 6px;
    margin-bottom: 9px;
  }

  .ln.short {
    width: 40%;
  }

  /* Real first-lines preview of the document (essay cards). */
  .thumb-text {
    margin: 0;
    font-family: var(--serif);
    font-size: 11px;
    line-height: 1.45;
    color: var(--fg-2);
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .thumb-empty {
    margin: 0;
    font-size: 11px;
    color: var(--muted);
    font-style: italic;
  }

  .course-line {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .badge {
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 2px 7px;
    border-radius: 5px;
    background: var(--accent-soft);
    color: var(--accent);
    flex: 0 0 auto;
  }

  .essay h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.3;
  }

  .meta {
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--muted);
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .essay-actions {
    display: flex;
    gap: 2px;
    border-top: 1px solid var(--border-soft);
    padding-top: 10px;
    margin-top: 2px;
    align-items: center;
  }

  .essay-actions button,
  .essay-actions .use {
    font-size: 12px;
    font-weight: 500;
    border: none;
    background: none;
    color: var(--muted);
    padding: 5px 8px;
    border-radius: 6px;
    cursor: pointer;
    transition: background var(--fast) var(--ease), color var(--fast) var(--ease);
  }

  .essay-actions button:hover {
    background: var(--hover);
    color: var(--fg);
  }

  .essay-actions .del:hover {
    background: color-mix(in oklab, var(--danger), transparent 90%);
    color: var(--danger);
  }

  .essay-actions .grow {
    flex: 1;
  }

  .essay-actions .use {
    color: var(--accent);
  }

  .essay.new {
    align-items: center;
    justify-content: center;
    text-align: center;
    border-style: dashed;
    color: var(--muted);
    gap: 8px;
    min-height: 190px;
  }

  .essay.new:hover {
    color: var(--accent);
    border-color: var(--accent);
    box-shadow: none;
  }

  .essay.new .plus {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--hover);
    color: var(--accent);
  }

  .essay.new .sub {
    font-size: 12.5px;
  }

  .rename {
    font: inherit;
    font-weight: 600;
    font-size: 15px;
    padding: 2px 6px;
    width: 100%;
    border: 1px solid color-mix(in oklab, var(--accent), transparent 50%);
    border-radius: 6px;
    background: var(--surface);
    color: var(--fg);
  }

  .empty {
    color: var(--muted);
    text-align: center;
    margin-top: 3rem;
  }

</style>

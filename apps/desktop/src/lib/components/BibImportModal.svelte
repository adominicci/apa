<script lang="ts">
  import { onMount } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import type { Reference, ReferenceType } from "@tesina/engine";
  import { library } from "$lib/state/library.svelte";
  import { uiLocale } from "$lib/state/uiLocale.svelte";
  import type { BibWarning } from "$lib/bibtex/map";
  import { buildImportPlan, type ImportPlan, parseBib } from "$lib/bibtex/plan";
  import RefEntry from "$lib/components/RefEntry.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    /** Raw contents of the chosen .bib file. */
    bibText: string;
    /** Called after a successful import with how many references landed. */
    onDone: (count: number) => void;
    onClose: () => void;
  }

  let { bibText, onDone, onClose }: Props = $props();

  let loading = $state(true);
  let plan = $state<ImportPlan | null>(null);
  const checked = new SvelteSet<string>();
  let collectionId = $state("");

  /** A row starts checked unless it's a duplicate or has no title. */
  function defaultChecked(row: ImportPlan["rows"][number]): boolean {
    return !row.duplicate && !row.warnings.some((w) => w.code === "noTitle");
  }

  onMount(() => {
    // Defer the (synchronous) parse so the "Reading…" state paints first.
    const timer = setTimeout(() => {
      try {
        const built = buildImportPlan(parseBib(bibText), library.references);
        plan = built;
        for (const row of built.rows) {
          if (defaultChecked(row)) checked.add(row.ref.id);
        }
      } catch (err) {
        console.error("No se pudo importar el BibTeX:", err);
        plan = { rows: [], errors: [] };
      } finally {
        loading = false;
      }
    }, 0);
    return () => clearTimeout(timer);
  });

  function typeLabel(type: ReferenceType): string {
    switch (type) {
      case "journalArticle":
        return m.form_type_journalArticle();
      case "book":
        return m.form_type_book();
      case "bookChapter":
        return m.form_type_bookChapter();
      case "website":
        return m.form_type_website();
      case "report":
        return m.form_type_report();
      case "thesis":
        return m.form_type_thesis();
      case "conferencePaper":
        return m.form_type_conferencePaper();
      case "newspaperArticle":
        return m.form_type_newspaperArticle();
      case "referenceEntry":
        return m.form_type_referenceEntry();
      case "video":
        return m.form_type_video();
      case "podcastEpisode":
        return m.form_type_podcastEpisode();
      case "socialMedia":
        return m.form_type_socialMedia();
      case "software":
        return m.form_type_software();
      case "film":
        return m.form_type_film();
      case "unpublishedWork":
        return m.form_type_unpublishedWork();
      case "artwork":
        return m.form_type_artwork();
      case "music":
        return m.form_type_music();
      case "tvEpisode":
        return m.form_type_tvEpisode();
      case "preprint":
        return m.form_type_preprint();
      case "personalCommunication":
        return m.form_type_personalCommunication();
      default:
        return type;
    }
  }

  function warnLabel(w: BibWarning, ref: Reference): string {
    switch (w.code) {
      case "mappedAs":
        return m.bib_warn_mapped_as({ from: w.from, to: typeLabel(ref.type) });
      case "noTitle":
        return m.bib_warn_no_title();
      case "noAuthors":
        return m.bib_warn_no_authors();
      case "noYear":
        return m.bib_warn_no_year();
      case "badDate":
        return m.bib_warn_bad_date({ raw: w.raw });
    }
  }

  function toggle(id: string) {
    if (checked.has(id)) checked.delete(id);
    else checked.add(id);
  }

  function selectAll() {
    if (!plan) return;
    for (const row of plan.rows) checked.add(row.ref.id);
  }

  function selectNone() {
    checked.clear();
  }

  function doImport() {
    if (!plan) return;
    const refs = plan.rows
      .filter((r) => checked.has(r.ref.id))
      .map((r) => r.ref);
    if (refs.length === 0) return;
    library.addMany(refs, collectionId || undefined);
    onDone(refs.length);
  }

  const errorsLabel = $derived(
    plan && plan.errors.length === 1
      ? m.bib_parse_errors_one()
      : m.bib_parse_errors_many({ count: plan?.errors.length ?? 0 }),
  );
</script>

<Modal
  title={m.bib_modal_title()}
  subtitle={m.bib_modal_subtitle()}
  size="ref"
  dismissOnOverlay={false}
  {onClose}
>
  {#if loading}
    <p class="bib-status">{m.bib_reading()}</p>
  {:else if !plan || plan.rows.length === 0}
    <p class="bib-status">{m.bib_empty()}</p>
    {#if plan && plan.errors.length > 0}
      <p class="bib-errbanner">{errorsLabel}</p>
    {/if}
  {:else}
    {#if plan.errors.length > 0}
      <p class="bib-errbanner">{errorsLabel}</p>
    {/if}

    <div class="bib-toolbar">
      <div class="bib-selectors">
        <button class="linkbtn" onclick={selectAll}>{m.bib_select_all()}</button>
        <span class="sep">·</span>
        <button class="linkbtn" onclick={selectNone}>{m.bib_select_none()}</button>
      </div>
      <span class="bib-count">
        {m.bib_selected_count({ selected: checked.size, total: plan.rows.length })}
      </span>
    </div>

    <label class="bib-collection">
      {m.bib_collection_label()}
      <select bind:value={collectionId}>
        <option value="">{m.bib_collection_none()}</option>
        {#each library.collections as c (c.id)}
          <option value={c.id}>{c.name}</option>
        {/each}
      </select>
    </label>

    <ul class="bib-list">
      {#each plan.rows as row (row.ref.id)}
        <li>
          <label class="bib-row" class:dup={!!row.duplicate}>
            <input
              type="checkbox"
              checked={checked.has(row.ref.id)}
              onchange={() => toggle(row.ref.id)}
            />
            <div class="bib-main">
              <div class="bib-top">
                <span class="pill">{typeLabel(row.ref.type)}</span>
                {#if row.duplicate}
                  <span class="pill warn">{m.bib_duplicate_pill()}</span>
                {/if}
                <code class="bibkey">{row.key}</code>
              </div>
              <RefEntry reference={row.ref} language={uiLocale.current} />
              {#if row.duplicate}
                <p class="bib-note">
                  {row.duplicate.of === "library"
                    ? m.bib_dup_of_library({ title: row.duplicate.label })
                    : m.bib_dup_in_batch()}
                </p>
              {/if}
              {#each row.warnings as w, i (i)}
                <p class="bib-warn">{warnLabel(w, row.ref)}</p>
              {/each}
            </div>
          </label>
        </li>
      {/each}
    </ul>
  {/if}

  {#snippet footer()}
    <button class="btn btn-ghost" onclick={onClose}>{m.common_close()}</button>
    <button
      class="btn btn-primary"
      disabled={loading || checked.size === 0}
      onclick={doImport}
    >
      {checked.size === 1
        ? m.bib_import_confirm_one()
        : m.bib_import_confirm_many({ count: checked.size })}
    </button>
  {/snippet}
</Modal>

<style>
  .bib-status {
    margin: 8px 0;
    color: var(--fg-2);
    font-size: 14px;
  }

  .bib-errbanner {
    margin: 0 0 12px;
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--warn-soft);
    color: var(--warn-strong);
    font-size: 13px;
  }

  .bib-toolbar {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }

  .bib-selectors {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .linkbtn {
    border: none;
    background: none;
    padding: 0;
    color: var(--accent);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .linkbtn:hover {
    text-decoration: underline;
  }

  .bib-selectors .sep {
    color: var(--border);
  }

  .bib-count {
    color: var(--fg-2);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }

  .bib-collection {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
    font-size: 13px;
    color: var(--fg-2);
  }

  .bib-collection select {
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 13px;
  }

  .bib-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .bib-row {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--border-soft);
    border-radius: 9px;
    cursor: pointer;
  }

  .bib-row:hover {
    border-color: var(--border);
  }

  .bib-row.dup {
    opacity: 0.7;
  }

  .bib-row input[type="checkbox"] {
    margin-top: 3px;
    flex: none;
  }

  .bib-main {
    min-width: 0;
    flex: 1;
  }

  .bib-top {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 5px;
  }

  .pill {
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
  }

  .pill.warn {
    background: var(--warn-soft);
    color: var(--warn-strong);
  }

  .bibkey {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--fg-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bib-note,
  .bib-warn {
    margin: 4px 0 0;
    font-size: 12px;
  }

  .bib-note {
    color: var(--fg-2);
  }

  .bib-warn {
    color: var(--warn-strong);
  }
</style>

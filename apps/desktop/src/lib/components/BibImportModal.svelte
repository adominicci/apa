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
  import Select, { type SelectGroup } from "$lib/components/Select.svelte";
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

  // Derived, not const: the library's collections can change while the dialog
  // is open.
  const collectionGroups = $derived<SelectGroup[]>([{
    label: "",
    options: [
      { value: "", label: m.bib_collection_none() },
      ...library.collections.map((c) => ({ value: c.id, label: c.name })),
    ],
  }]);

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

    <div class="bib-collection">
      <span>{m.bib_collection_label()}</span>
      <Select
        compact
        groups={collectionGroups}
        value={collectionId}
        onChange={(next) => (collectionId = next)}
        ariaLabel={m.bib_collection_label()}
      />
    </div>

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
    margin: var(--sp-2) 0;
    color: var(--fg-2);
    font-size: var(--t-ui);
  }

  .bib-errbanner {
    margin: 0 0 var(--sp-3);
    padding: var(--sp-2) var(--sp-3);
    border-radius: 8px;
    background: var(--warn-soft);
    color: var(--warn-strong);
    font-size: var(--t-body);
  }

  .bib-toolbar {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sp-3);
    margin-bottom: var(--sp-2);
  }

  .bib-selectors {
    display: flex;
    align-items: baseline;
    gap: var(--sp-2);
  }

  .linkbtn {
    border: none;
    background: none;
    padding: 0;
    color: var(--accent);
    font: inherit;
    font-size: var(--t-body);
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
    font-size: var(--t-body);
    font-variant-numeric: tabular-nums;
  }

  .bib-collection {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    margin-bottom: var(--sp-3);
    font-size: var(--t-body);
    color: var(--fg-2);
  }


  .bib-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sp-15);
  }

  .bib-row {
    display: flex;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-3);
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
    margin-top: var(--sp-05);
    flex: none;
  }

  .bib-main {
    min-width: 0;
    flex: 1;
  }

  .bib-top {
    display: flex;
    align-items: center;
    gap: var(--sp-15);
    margin-bottom: var(--sp-1);
  }

  .pill {
    padding: 1px var(--sp-2);
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--t-caption);
    font-weight: 600;
    white-space: nowrap;
  }

  .pill.warn {
    background: var(--warn-soft);
    color: var(--warn-strong);
  }

  .bibkey {
    font-family: var(--mono);
    font-size: var(--t-caption);
    color: var(--fg-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bib-note,
  .bib-warn {
    margin: var(--sp-1) 0 0;
    font-size: var(--t-small);
  }

  .bib-note {
    color: var(--fg-2);
  }

  .bib-warn {
    color: var(--warn-strong);
  }
</style>

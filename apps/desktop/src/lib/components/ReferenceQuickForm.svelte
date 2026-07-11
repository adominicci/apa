<script lang="ts">
  import type {
    APADate,
    Contributor,
    Reference,
    ReferenceType,
  } from "@tesina/engine";
  import { detectInput } from "$lib/autofill/detect";
  import {
    type AutofillError,
    lookupDoi,
    lookupIsbn,
  } from "$lib/autofill/client";
  import {
    emptyQuickFields,
    type QuickFields,
    refToQuickFields,
  } from "$lib/autofill/fill";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    onSave: (ref: Reference) => void;
    onClose: () => void;
  }

  let { onSave, onClose }: Props = $props();

  const TYPE_OPTIONS: { value: ReferenceType; label: string }[] = [
    { value: "journalArticle", label: m.form_type_journalArticle() },
    { value: "book", label: m.form_type_book() },
    { value: "bookChapter", label: m.form_type_bookChapter() },
    { value: "website", label: m.form_type_website() },
    { value: "report", label: m.form_type_report() },
    { value: "thesis", label: m.form_type_thesis() },
    { value: "conferencePaper", label: m.form_type_conferencePaper() },
    { value: "newspaperArticle", label: m.form_type_newspaperArticle() },
    { value: "referenceEntry", label: m.form_type_referenceEntry() },
    { value: "video", label: m.form_type_video() },
    { value: "podcastEpisode", label: m.form_type_podcastEpisode() },
    { value: "socialMedia", label: m.form_type_socialMedia() },
    { value: "software", label: m.form_type_software() },
    {
      value: "personalCommunication",
      label: m.form_type_personalCommunication(),
    },
  ];

  let f = $state<QuickFields>(emptyQuickFields());
  let lookupText = $state("");
  let looking = $state(false);
  let lookupError = $state("");
  let autofilled = $state(false);

  const ERROR_MESSAGES: Record<AutofillError | "unknown-input", () => string> =
    {
      offline: m.form_err_offline,
      "not-found": m.form_err_not_found,
      unsupported: m.form_err_unsupported,
      parse: m.form_err_parse,
      "unknown-input": m.form_err_unknown_input,
    };

  const canSave = $derived.by(() => {
    if (f.type === "personalCommunication") {
      return f.authorsText.trim() !== "" && (f.noDate || f.year.trim() !== "");
    }
    if (f.title.trim() === "") return false;
    if (!f.noDate && f.year.trim() === "") return false;
    switch (f.type) {
      case "journalArticle":
        return f.journal.trim() !== "";
      case "bookChapter":
        return f.bookTitle.trim() !== "";
      case "thesis":
        return f.institution.trim() !== "";
      case "conferencePaper":
        return f.conferenceName.trim() !== "";
      case "newspaperArticle":
        return f.publication.trim() !== "";
      case "referenceEntry":
        return f.workTitle.trim() !== "";
      case "video":
        return f.platform.trim() !== "";
      case "podcastEpisode":
        return f.showTitle.trim() !== "";
      case "socialMedia":
        return f.platform.trim() !== "" && f.contentType.trim() !== "";
      default:
        return true;
    }
  });

  async function lookup() {
    lookupError = "";
    autofilled = false;
    const detected = detectInput(lookupText);
    if (detected.kind !== "doi" && detected.kind !== "isbn") {
      lookupError = ERROR_MESSAGES["unknown-input"]();
      return;
    }
    looking = true;
    try {
      const result = detected.kind === "doi"
        ? await lookupDoi(detected.value)
        : await lookupIsbn(detected.value);
      if (!result.ok) {
        lookupError = ERROR_MESSAGES[result.error]();
        return;
      }
      f = refToQuickFields(result.ref);
      autofilled = true;
    } finally {
      looking = false;
    }
  }

  /** One contributor per line: "Apellido, Nombre" or a group name. */
  function parseContributors(text: string): Contributor[] {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .map((line): Contributor => {
        const comma = line.indexOf(",");
        if (comma === -1) return { kind: "group", name: line };
        const family = line.slice(0, comma).trim();
        const given = line.slice(comma + 1).trim();
        return given === ""
          ? { kind: "person", family }
          : { kind: "person", family, given };
      });
  }

  function buildDate(): APADate {
    if (f.noDate) return { noDate: true };
    const date: APADate = { year: Number.parseInt(f.year, 10) };
    const month = Number.parseInt(f.month, 10);
    const day = Number.parseInt(f.day, 10);
    if (month >= 1 && month <= 12) {
      date.month = month;
      if (day >= 1 && day <= 31) date.day = day;
    }
    return date;
  }

  function opt(value: string): string | undefined {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }

  function splitPages(): { pageStart?: string; pageEnd?: string } {
    const [start, end] = f.pages.split(/[–-]/).map((p) => p.trim());
    return {
      ...(start ? { pageStart: start } : {}),
      ...(end ? { pageEnd: end } : {}),
    };
  }

  function save() {
    if (!canSave) return;
    const base = {
      id: crypto.randomUUID(),
      authors: parseContributors(f.authorsText),
      date: buildDate(),
      title: f.title.trim() ||
        (f.type === "personalCommunication" ? "Comunicación personal" : ""),
      ...(opt(f.doi) ? { doi: opt(f.doi)! } : {}),
      ...(opt(f.url) ? { url: opt(f.url)! } : {}),
    };

    let ref: Reference;
    switch (f.type) {
      case "journalArticle":
        ref = {
          ...base,
          type: "journalArticle",
          journal: f.journal.trim(),
          ...(opt(f.volume) ? { volume: opt(f.volume)! } : {}),
          ...(opt(f.issue) ? { issue: opt(f.issue)! } : {}),
          ...splitPages(),
        };
        break;
      case "book":
        ref = {
          ...base,
          type: "book",
          ...(opt(f.publisher) ? { publisher: opt(f.publisher)! } : {}),
          ...(opt(f.edition) ? { edition: opt(f.edition)! } : {}),
        };
        break;
      case "bookChapter":
        ref = {
          ...base,
          type: "bookChapter",
          editors: parseContributors(f.editorsText),
          bookTitle: f.bookTitle.trim(),
          ...(opt(f.edition) ? { edition: opt(f.edition)! } : {}),
          ...splitPages(),
          ...(opt(f.publisher) ? { publisher: opt(f.publisher)! } : {}),
        };
        break;
      case "website":
        ref = {
          ...base,
          type: "website",
          ...(opt(f.siteName) ? { siteName: opt(f.siteName)! } : {}),
        };
        break;
      case "report":
        ref = {
          ...base,
          type: "report",
          ...(opt(f.institution) ? { institution: opt(f.institution)! } : {}),
          ...(opt(f.reportNumber)
            ? { reportNumber: opt(f.reportNumber)! }
            : {}),
        };
        break;
      case "thesis":
        ref = {
          ...base,
          type: "thesis",
          thesisType: f.thesisType,
          institution: f.institution.trim(),
          ...(f.unpublished ? { unpublished: true } : {}),
          ...(!f.unpublished && opt(f.archive)
            ? { archive: opt(f.archive)! }
            : {}),
        };
        break;
      case "conferencePaper": {
        const dayEnd = Number.parseInt(f.dayEnd, 10);
        ref = {
          ...base,
          type: "conferencePaper",
          conferenceName: f.conferenceName.trim(),
          ...(opt(f.location) ? { location: opt(f.location)! } : {}),
          ...(dayEnd >= 1 && dayEnd <= 31 ? { dayEnd } : {}),
        };
        break;
      }
      case "newspaperArticle":
        ref = {
          ...base,
          type: "newspaperArticle",
          publication: f.publication.trim(),
          ...(opt(f.volume) ? { volume: opt(f.volume)! } : {}),
          ...(opt(f.issue) ? { issue: opt(f.issue)! } : {}),
          ...splitPages(),
        };
        break;
      case "referenceEntry":
        ref = {
          ...base,
          type: "referenceEntry",
          workTitle: f.workTitle.trim(),
          ...(opt(f.edition) ? { edition: opt(f.edition)! } : {}),
          ...(opt(f.publisher) ? { publisher: opt(f.publisher)! } : {}),
        };
        break;
      case "video":
        ref = {
          ...base,
          type: "video",
          ...(opt(f.username) ? { username: opt(f.username)! } : {}),
          platform: f.platform.trim(),
        };
        break;
      case "podcastEpisode":
        ref = {
          ...base,
          type: "podcastEpisode",
          ...(opt(f.episodeNumber)
            ? { episodeNumber: opt(f.episodeNumber)! }
            : {}),
          showTitle: f.showTitle.trim(),
          ...(opt(f.platform) ? { platform: opt(f.platform)! } : {}),
        };
        break;
      case "socialMedia":
        ref = {
          ...base,
          type: "socialMedia",
          ...(opt(f.username) ? { username: opt(f.username)! } : {}),
          platform: f.platform.trim(),
          contentType: f.contentType.trim(),
        };
        break;
      case "software":
        ref = {
          ...base,
          type: "software",
          kind: f.softwareKind,
          ...(opt(f.version) ? { version: opt(f.version)! } : {}),
          ...(opt(f.publisher) ? { publisher: opt(f.publisher)! } : {}),
        };
        break;
      case "personalCommunication":
        ref = { ...base, type: "personalCommunication" };
        break;
    }
    onSave(ref);
  }
</script>

<div class="overlay" role="presentation">
  <div class="modal" role="dialog" aria-label={m.form_title()}>
    <div class="row head">
      <strong>{m.form_title()}</strong>
      <button class="close" onclick={onClose} aria-label={m.common_close()}>×</button>
    </div>

    <div class="lookup" class:filled={autofilled}>
      <div class="row">
        <input
          type="text"
          bind:value={lookupText}
          placeholder={m.form_lookup_placeholder()}
          onkeydown={(e) => {
            if (e.key === "Enter") lookup();
          }}
        />
        <button
          class="find"
          onclick={lookup}
          disabled={looking || lookupText.trim() === ""}
        >
          {looking ? m.form_lookup_busy() : m.form_lookup_button()}
        </button>
      </div>
      {#if lookupError}
        <p class="lookup-error">{lookupError}</p>
      {:else if autofilled}
        <p class="lookup-ok">
          {m.form_lookup_ok()}
        </p>
      {/if}
    </div>

    <label>
      {m.form_type_label()}
      <select bind:value={f.type}>
        {#each TYPE_OPTIONS as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </label>

    {#if f.type === "personalCommunication"}
      <p class="notice">
        {m.form_pc_notice()}
      </p>
    {/if}

    <label>
      {m.form_authors_label()}
      <textarea rows="3" bind:value={f.authorsText} placeholder="Salgado, Nora"
      ></textarea>
    </label>

    <div class="row">
      <label class="grow">
        {m.form_year()}
        <input type="text" bind:value={f.year} disabled={f.noDate} />
      </label>
      <label class="grow">
        {m.form_month()}
        <input type="text" bind:value={f.month} disabled={f.noDate} />
      </label>
      <label class="grow">
        {m.form_day()}
        <input type="text" bind:value={f.day} disabled={f.noDate} />
      </label>
      <label class="checkline">
        <input type="checkbox" bind:checked={f.noDate} /> {m.form_no_date()}
      </label>
    </div>

    {#if f.type !== "personalCommunication"}
      <label>
        {m.form_field_title()}
        <input type="text" bind:value={f.title} />
      </label>
    {/if}

    {#if f.type === "journalArticle"}
      <label>
        {m.form_journal()}
        <input type="text" bind:value={f.journal} />
      </label>
      <div class="row">
        <label class="grow">
          {m.form_volume()}
          <input type="text" bind:value={f.volume} />
        </label>
        <label class="grow">
          {m.form_issue()}
          <input type="text" bind:value={f.issue} />
        </label>
        <label class="grow">
          {m.form_pages()}
          <input type="text" bind:value={f.pages} placeholder="45–67" />
        </label>
      </div>
    {:else if f.type === "book"}
      <div class="row">
        <label class="grow">
          {m.form_publisher()}
          <input type="text" bind:value={f.publisher} />
        </label>
        <label class="grow">
          {m.form_edition()}
          <input type="text" bind:value={f.edition} placeholder="2" />
        </label>
      </div>
    {:else if f.type === "bookChapter"}
      <label>
        {m.form_editors()}
        <textarea rows="2" bind:value={f.editorsText}></textarea>
      </label>
      <label>
        {m.form_book_title()}
        <input type="text" bind:value={f.bookTitle} />
      </label>
      <div class="row">
        <label class="grow">
          {m.form_edition()}
          <input type="text" bind:value={f.edition} />
        </label>
        <label class="grow">
          {m.form_pages()}
          <input type="text" bind:value={f.pages} placeholder="85–104" />
        </label>
        <label class="grow">
          {m.form_publisher()}
          <input type="text" bind:value={f.publisher} />
        </label>
      </div>
    {:else if f.type === "website"}
      <label>
        {m.form_site_name()}
        <input type="text" bind:value={f.siteName} />
      </label>
    {:else if f.type === "report"}
      <div class="row">
        <label class="grow">
          {m.form_institution()}
          <input type="text" bind:value={f.institution} />
        </label>
        <label class="grow">
          {m.form_report_number()}
          <input type="text" bind:value={f.reportNumber} />
        </label>
      </div>
    {:else if f.type === "thesis"}
      <div class="seg" role="group" aria-label={m.form_thesis_aria()}>
        <button
          class:active={f.thesisType === "doctoral"}
          onclick={() => (f.thesisType = "doctoral")}
        >
          {m.form_thesis_doctoral()}
        </button>
        <button
          class:active={f.thesisType === "masters"}
          onclick={() => (f.thesisType = "masters")}
        >
          {m.form_thesis_masters()}
        </button>
      </div>
      <label>
        {m.form_thesis_institution()}
        <input type="text" bind:value={f.institution} />
      </label>
      <label class="checkline">
        <input type="checkbox" bind:checked={f.unpublished} /> {m.form_unpublished()}
      </label>
      {#if !f.unpublished}
        <label>
          {m.form_archive()}
          <input type="text" bind:value={f.archive} />
        </label>
      {/if}
    {:else if f.type === "conferencePaper"}
      <label>
        {m.form_conference()}
        <input type="text" bind:value={f.conferenceName} />
      </label>
      <div class="row">
        <label class="grow">
          {m.form_location()}
          <input type="text" bind:value={f.location} />
        </label>
        <label class="grow">
          {m.form_day_end()}
          <input type="text" bind:value={f.dayEnd} placeholder="8" />
        </label>
      </div>
    {:else if f.type === "newspaperArticle"}
      <label>
        {m.form_publication()}
        <input type="text" bind:value={f.publication} />
      </label>
      <div class="row">
        <label class="grow">
          {m.form_volume()}
          <input type="text" bind:value={f.volume} />
        </label>
        <label class="grow">
          {m.form_issue()}
          <input type="text" bind:value={f.issue} />
        </label>
        <label class="grow">
          {m.form_pages()}
          <input type="text" bind:value={f.pages} />
        </label>
      </div>
    {:else if f.type === "referenceEntry"}
      <label>
        {m.form_work_title()}
        <input type="text" bind:value={f.workTitle} />
      </label>
      <div class="row">
        <label class="grow">
          {m.form_edition()}
          <input type="text" bind:value={f.edition} />
        </label>
        <label class="grow">
          {m.form_publisher()}
          <input type="text" bind:value={f.publisher} />
        </label>
      </div>
    {:else if f.type === "video"}
      <div class="row">
        <label class="grow">
          {m.form_username()}
          <input type="text" bind:value={f.username} />
        </label>
        <label class="grow">
          {m.form_platform()}
          <input type="text" bind:value={f.platform} placeholder="YouTube" />
        </label>
      </div>
    {:else if f.type === "podcastEpisode"}
      <div class="row">
        <label class="grow">
          {m.form_episode_number()}
          <input type="text" bind:value={f.episodeNumber} />
        </label>
        <label class="grow">
          {m.form_show_title()}
          <input type="text" bind:value={f.showTitle} />
        </label>
        <label class="grow">
          {m.form_platform()}
          <input type="text" bind:value={f.platform} />
        </label>
      </div>
    {:else if f.type === "socialMedia"}
      <div class="row">
        <label class="grow">
          {m.form_handle()}
          <input type="text" bind:value={f.username} />
        </label>
        <label class="grow">
          {m.form_content_type()}
          <input type="text" bind:value={f.contentType} placeholder={m.form_content_type_ph()} />
        </label>
        <label class="grow">
          {m.form_platform()}
          <input type="text" bind:value={f.platform} placeholder="X" />
        </label>
      </div>
    {:else if f.type === "software"}
      <div class="seg" role="group" aria-label={m.form_software_kind_aria()}>
        <button
          class:active={f.softwareKind === "software"}
          onclick={() => (f.softwareKind = "software")}
        >
          {m.form_software()}
        </button>
        <button
          class:active={f.softwareKind === "dataset"}
          onclick={() => (f.softwareKind = "dataset")}
        >
          {m.form_dataset()}
        </button>
      </div>
      <div class="row">
        <label class="grow">
          {m.form_version()}
          <input type="text" bind:value={f.version} placeholder="2.1" />
        </label>
        <label class="grow">
          {m.form_distributor()}
          <input type="text" bind:value={f.publisher} />
        </label>
      </div>
    {/if}

    {#if f.type !== "personalCommunication"}
      <div class="row">
        <label class="grow">
          DOI
          <input type="text" bind:value={f.doi} placeholder="10.1234/abcd" />
        </label>
        <label class="grow">
          URL
          <input type="text" bind:value={f.url} placeholder="https://…" />
        </label>
      </div>
    {/if}

    <button class="save" onclick={save} disabled={!canSave}>
      {m.form_save()}
    </button>
    <p class="hint">
      {m.form_hint()}
    </p>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: var(--overlay);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }

  .modal {
    width: min(500px, calc(100vw - 2rem));
    max-height: calc(100vh - 4rem);
    overflow-y: auto;
    background: var(--surface);
    border-radius: 12px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 0.82rem;
    color: var(--fg);
    box-shadow: var(--elev-raised);
  }

  .row {
    display: flex;
    gap: 10px;
    align-items: end;
  }

  .head {
    align-items: center;
    justify-content: space-between;
  }

  .close {
    border: none;
    background: transparent;
    font-size: 1rem;
    cursor: pointer;
    color: var(--muted);
  }

  .grow {
    flex: 1;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--fg-2);
  }

  .checkline {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    padding-bottom: 7px;
    white-space: nowrap;
  }

  input[type="text"],
  textarea,
  select {
    font: inherit;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    background: var(--surface);
    color: inherit;
  }

  input:disabled {
    opacity: 0.5;
  }

  .lookup {
    border: 1px dashed color-mix(in oklab, var(--accent), transparent 50%);
    border-radius: 8px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .lookup.filled {
    border-style: solid;
    background: var(--accent-soft);
  }

  .lookup .row {
    align-items: center;
  }

  .find {
    border: none;
    background: var(--accent);
    color: var(--accent-on);
    font: inherit;
    font-size: 0.78rem;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
  }

  .find:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .lookup-error {
    margin: 0;
    color: var(--danger);
    font-size: 0.75rem;
  }

  .lookup-ok {
    margin: 0;
    color: var(--accent);
    font-size: 0.75rem;
  }

  .notice {
    margin: 0;
    padding: 8px;
    border-radius: 8px;
    background: var(--warn-soft);
    color: var(--warn-strong);
    font-size: 0.78rem;
  }

  .seg {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 7px;
    overflow: hidden;
    align-self: start;
  }

  .seg button {
    border: none;
    background: transparent;
    font: inherit;
    font-size: 0.78rem;
    padding: 5px 12px;
    cursor: pointer;
    color: var(--muted);
  }

  .seg button.active {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }

  .save {
    border: none;
    background: var(--accent);
    color: var(--accent-on);
    font: inherit;
    padding: 8px 10px;
    border-radius: 7px;
    cursor: pointer;
  }

  .save:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 0.75rem;
  }

  
</style>

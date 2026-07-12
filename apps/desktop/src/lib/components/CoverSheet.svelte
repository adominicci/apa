<script module lang="ts">
  import type { PaperVariant, TitlePage } from "$lib/model/essay";

  /** Patch shape covering both the title-page form data and the two settings
   * fields the cover can change (variant, running head). */
  export type CoverPatch =
    & Partial<TitlePage>
    & { variant?: PaperVariant; runningHead?: string };
</script>

<script lang="ts">
  import type { DocLocale } from "@tesina/engine";
  import type { EssaySettings } from "$lib/model/essay";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    titlePage: TitlePage;
    settings: EssaySettings;
    language: DocLocale;
    onChange: (patch: CoverPatch) => void;
    /** Opens the structured modal (all fields, variant switch). */
    onOpenForm: () => void;
  }

  let { titlePage, settings, language, onChange, onOpenForm }: Props = $props();

  const professional = $derived(settings.variant === "professional");

  function lines(text: string): string[] {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  }
</script>

<div class="apa-editor cover-sheet" data-doclang={language}>
  <article class="paper-sheet cover">
    <button
      class="cover-form-btn"
      onclick={onOpenForm}
      title={m.cover_open_form()}
      aria-label={m.cover_open_form()}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
    </button>

    {#if professional}
      <input
        class="cf running-head"
        value={settings.runningHead ?? ""}
        placeholder={m.cover_running_head_ph()}
        oninput={(e) => onChange({ runningHead: e.currentTarget.value })}
      />
    {/if}

    <div class="cover-spacer"></div>

    <input
      class="cf title"
      value={titlePage.title}
      placeholder={m.cover_title_ph()}
      oninput={(e) => onChange({ title: e.currentTarget.value })}
    />

    <div class="gap"></div>

    <textarea
      class="cf people"
      rows="1"
      value={titlePage.authors.join("\n")}
      placeholder={m.cover_authors_ph()}
      oninput={(e) => onChange({ authors: lines(e.currentTarget.value) })}
    ></textarea>
    <textarea
      class="cf people"
      rows="1"
      value={titlePage.affiliations.join("\n")}
      placeholder={m.cover_affil_ph()}
      oninput={(e) => onChange({ affiliations: lines(e.currentTarget.value) })}
    ></textarea>

    {#if !professional}
      <input
        class="cf line"
        value={titlePage.course ?? ""}
        placeholder={m.cover_course_ph()}
        oninput={(e) =>
        onChange({ course: e.currentTarget.value.trim() || undefined })}
      />
      <input
        class="cf line"
        value={titlePage.instructor ?? ""}
        placeholder={m.cover_instructor_ph()}
        oninput={(e) =>
        onChange({ instructor: e.currentTarget.value.trim() || undefined })}
      />
      <input
        class="cf line date"
        type="date"
        value={titlePage.dueDate ?? ""}
        oninput={(e) =>
        onChange({ dueDate: e.currentTarget.value || undefined })}
      />
    {/if}

    {#if professional}
      <div class="gap-lg"></div>
      <p class="note-label">{m.cover_author_note()}</p>
      <textarea
        class="cf note"
        rows="2"
        value={titlePage.authorNote ?? ""}
        placeholder={m.cover_author_note_ph()}
        oninput={(e) =>
        onChange({ authorNote: e.currentTarget.value.trim() || undefined })}
      ></textarea>
    {/if}
  </article>
</div>

<style>
  .cover-sheet {
    padding: 0;
  }

  .paper-sheet.cover {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .cover-form-btn {
    position: absolute;
    top: 14px;
    right: 14px;
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
  }

  .cover-form-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .cover-form-btn :global(svg) {
    width: 15px;
    height: 15px;
  }

  /* Proportional to the preview's title-page spacer so the title sits in the
     same upper-third position in edit and preview modes. */
  .cover-spacer {
    height: 0.81in;
  }

  .gap {
    height: 24px;
  }

  .gap-lg {
    flex: 1;
    min-height: 1in;
  }

  /* Editable fields blend into the serif page; APA double-spaced and centered. */
  .cf {
    font-family: var(--serif);
    font-size: 12pt;
    line-height: 2;
    color: var(--fg);
    background: transparent;
    border: none;
    outline: none;
    text-align: center;
    width: 100%;
    padding: 0;
    margin: 0;
    resize: none;
  }

  .cf::placeholder {
    color: var(--muted);
    opacity: 0.55;
  }

  .cf:focus {
    background: var(--accent-soft);
    border-radius: 3px;
  }

  .cf.title {
    font-weight: 700;
  }

  .cf.people,
  .cf.note {
    field-sizing: content;
    overflow: hidden;
  }

  .running-head {
    position: absolute;
    top: 14px;
    left: 0;
    text-align: left;
    font-size: 11pt;
    letter-spacing: 0.04em;
    color: var(--muted);
    width: auto;
    max-width: 60%;
  }

  .date {
    width: auto;
  }

  .note-label {
    font-weight: 700;
    margin: 0;
    font-family: var(--serif);
    font-size: 12pt;
  }
</style>

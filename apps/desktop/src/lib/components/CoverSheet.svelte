<script module lang="ts">
  import type { TitlePage } from "$lib/model/essay";

  export type CoverPatch = Partial<TitlePage>;
</script>

<script lang="ts">
  import { buildStudentTitlePage, type DocLocale } from "@tesina/engine";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    titlePage: TitlePage;
    language: DocLocale;
    onChange: (patch: CoverPatch) => void;
    /** Opens the structured modal for all student title-page fields. */
    onOpenForm: () => void;
  }

  let { titlePage, language, onChange, onOpenForm }: Props = $props();

  const studentTitlePage = $derived(
    buildStudentTitlePage({
      locale: language,
      title: titlePage.title,
      authors: titlePage.authors,
      affiliations: titlePage.affiliations,
      course: titlePage.course ?? "",
      instructor: titlePage.instructor ?? "",
      dueDate: titlePage.dueDate ?? "",
    }),
  );
</script>

<div class="apa-editor cover-sheet" data-doclang={language}>
  <article class="paper-sheet cover">
    <button
      class="cover-form-btn"
      onclick={onOpenForm}
      title={m.cover_open_form(undefined, { locale: language })}
      aria-label={m.cover_open_form(undefined, { locale: language })}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
    </button>

    <div class="cover-spacer"></div>

    <input
      class="cf title"
      value={titlePage.title}
      placeholder={m.cover_title_ph(undefined, { locale: language })}
      oninput={(e) => onChange({ title: e.currentTarget.value })}
    />

    <div class="gap"></div>

    <button
      type="button"
      class="cf people byline-field"
      onclick={onOpenForm}
      aria-label={m.cover_open_form(undefined, { locale: language })}
    >
      {#if studentTitlePage.byline.authorLine.length > 0}
        {#each studentTitlePage.byline.authorLine as token, index (`${index}:${token.kind}:${token.text}`)}
          {#if token.kind === "superscript"}
            <sup>{token.text}</sup>
          {:else}
            {token.text}
          {/if}
        {/each}
      {:else}
        <span class="placeholder">
          {m.cover_authors_ph(undefined, { locale: language })}
        </span>
      {/if}
    </button>
    <button
      type="button"
      class="cf people byline-field affiliations-field"
      onclick={onOpenForm}
      aria-label={m.cover_open_form(undefined, { locale: language })}
    >
      {#if studentTitlePage.byline.affiliations.length > 0}
        {#each studentTitlePage.byline.affiliations as affiliation (affiliation.name)}
          <span class="affiliation-line">
            {#if affiliation.number !== undefined}
              <sup>{affiliation.number}</sup>
            {/if}
            {affiliation.name}
          </span>
        {/each}
      {:else}
        <span class="placeholder">
          {m.cover_affil_ph(undefined, { locale: language })}
        </span>
      {/if}
    </button>

    <input
      class="cf line"
      value={titlePage.course ?? ""}
      placeholder={m.cover_course_ph(undefined, { locale: language })}
      oninput={(e) =>
      onChange({ course: e.currentTarget.value.trim() || undefined })}
    />
    <input
      class="cf line"
      value={titlePage.instructor ?? ""}
      placeholder={m.cover_instructor_ph(undefined, { locale: language })}
      oninput={(e) =>
      onChange({ instructor: e.currentTarget.value.trim() || undefined })}
    />
    <input
      class="cf line date"
      type="date"
      value={titlePage.dueDate ?? ""}
      oninput={(e) => onChange({ dueDate: e.currentTarget.value || undefined })}
    />
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

  /* Matches the preview's title-page spacer (1in margin + ~1in) so the title
     sits in the same upper-third position in edit and preview modes. */
  .cover-spacer {
    height: 1in;
  }

  .gap {
    height: 24px;
  }

  /* Editable fields blend into the page in the chosen APA font, double-spaced. */
  .cf {
    font-family: var(--doc-font, var(--serif));
    font-size: var(--doc-font-size, 12pt);
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

  .cf.people {
    field-sizing: content;
    overflow: hidden;
  }

  .byline-field {
    cursor: pointer;
  }

  .byline-field sup {
    font-size: 0.7em;
    line-height: 0;
    vertical-align: super;
  }

  .affiliation-line {
    display: block;
  }

  .placeholder {
    color: var(--muted);
    opacity: 0.55;
  }

  .date {
    width: auto;
  }

</style>

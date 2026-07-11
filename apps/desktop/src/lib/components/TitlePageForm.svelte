<script lang="ts">
  import { untrack } from "svelte";
  import { m } from "$lib/paraglide/messages";
  import type {
    EssaySettings,
    PaperVariant,
    TitlePage,
  } from "$lib/model/essay";

  interface Props {
    titlePage: TitlePage;
    settings: EssaySettings;
    onSave: (titlePage: TitlePage, settings: EssaySettings) => void;
    onClose: () => void;
  }

  let { titlePage, settings, onSave, onClose }: Props = $props();

  // Editing works on local copies; nothing touches the essay until Guardar.
  let title = $state(untrack(() => titlePage.title));
  let authorsText = $state(untrack(() => titlePage.authors.join("\n")));
  let affiliationsText = $state(
    untrack(() => titlePage.affiliations.join("\n")),
  );
  let course = $state(untrack(() => titlePage.course ?? ""));
  let instructor = $state(untrack(() => titlePage.instructor ?? ""));
  let dueDate = $state(untrack(() => titlePage.dueDate ?? ""));
  let variant = $state<PaperVariant>(untrack(() => settings.variant));
  let runningHead = $state(untrack(() => settings.runningHead ?? ""));
  let authorNote = $state(untrack(() => titlePage.authorNote ?? ""));

  function lines(text: string): string[] {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  }

  function save() {
    const nextTitle: TitlePage = {
      title: title.trim() || titlePage.title,
      authors: lines(authorsText),
      affiliations: lines(affiliationsText),
      ...(course.trim() !== "" ? { course: course.trim() } : {}),
      ...(instructor.trim() !== "" ? { instructor: instructor.trim() } : {}),
      ...(dueDate.trim() !== "" ? { dueDate: dueDate.trim() } : {}),
      ...(variant === "professional" && authorNote.trim() !== ""
        ? { authorNote: authorNote.trim() }
        : {}),
    };
    const nextSettings: EssaySettings = {
      ...settings,
      variant,
      ...(variant === "professional" && runningHead.trim() !== ""
        ? { runningHead: runningHead.trim().toUpperCase().slice(0, 50) }
        : {}),
    };
    if (variant === "student") delete nextSettings.runningHead;
    onSave(nextTitle, nextSettings);
  }
</script>

<div class="overlay" role="presentation">
  <div class="modal" role="dialog" aria-label={m.titlepage_title()}>
    <div class="row head">
      <strong>{m.titlepage_title()}</strong>
      <button class="close" onclick={onClose} aria-label={m.common_close()}>×</button>
    </div>

    <div class="seg" role="group" aria-label={m.titlepage_variant_aria()}>
      <button
        class:active={variant === "student"}
        onclick={() => (variant = "student")}
      >
        {m.titlepage_student()}
      </button>
      <button
        class:active={variant === "professional"}
        onclick={() => (variant = "professional")}
      >
        {m.titlepage_professional()}
      </button>
    </div>

    <label>
      {m.titlepage_essay_title()}
      <input type="text" bind:value={title} />
    </label>

    <label>
      {m.titlepage_authors()}
      <textarea rows="2" bind:value={authorsText} placeholder="Ana María Ruiz"
      ></textarea>
    </label>

    <label>
      {m.titlepage_affiliations()}
      <textarea
        rows="2"
        bind:value={affiliationsText}
        placeholder="Departamento de Educación, Universidad del Valle"
      ></textarea>
    </label>

    <div class="row">
      <label class="grow">
        {m.titlepage_course()}
        <input type="text" bind:value={course} placeholder="EDU 301" />
      </label>
      <label class="grow">
        {m.titlepage_instructor()}
        <input type="text" bind:value={instructor} />
      </label>
    </div>

    <label>
      {m.titlepage_due_date()}
      <input type="date" bind:value={dueDate} />
    </label>

    {#if variant === "professional"}
      <label>
        {m.titlepage_running_head()}
        <input type="text" bind:value={runningHead} maxlength="50" />
      </label>
      <label>
        {m.titlepage_author_note()}
        <textarea rows="2" bind:value={authorNote}></textarea>
      </label>
    {/if}

    <button class="save" onclick={save}>{m.titlepage_save()}</button>
    <p class="hint">
      {m.titlepage_hint()}
    </p>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(20, 20, 18, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }

  .modal {
    width: min(460px, calc(100vw - 2rem));
    max-height: calc(100vh - 4rem);
    overflow-y: auto;
    background: #fff;
    border-radius: 12px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 0.82rem;
    color: #26251f;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
  }

  .row {
    display: flex;
    gap: 10px;
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
    color: #6b6a64;
  }

  .grow {
    flex: 1;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: #44433e;
  }

  input,
  textarea {
    font: inherit;
    padding: 6px 8px;
    border: 1px solid #d7d4cf;
    border-radius: 6px;
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
  }

  .seg {
    display: flex;
    border: 1px solid #d7d4cf;
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
    color: #6b6a64;
  }

  .seg button.active {
    background: #eaf1fe;
    color: #173a8c;
    font-weight: 600;
  }

  .save {
    border: none;
    background: #2158d6;
    color: #fff;
    font: inherit;
    padding: 8px 10px;
    border-radius: 7px;
    cursor: pointer;
  }

  .hint {
    margin: 0;
    color: #8a887f;
    font-size: 0.75rem;
  }

  @media (prefers-color-scheme: dark) {
    .modal {
      background: #232320;
      color: #e8e6e1;
    }

    label {
      color: #c9c7c0;
    }

    input,
    textarea,
    .seg {
      border-color: #45443f;
      background: #1c1c1a;
      color: #e8e6e1;
    }

    .seg button {
      color: #a3a19a;
    }

    .seg button.active {
      background: #1d2c50;
      color: #b7cdfa;
    }

    .close,
    .hint {
      color: #8a887f;
    }
  }
</style>

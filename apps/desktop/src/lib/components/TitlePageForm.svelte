<script lang="ts">
  import { untrack } from "svelte";
  import { m } from "$lib/paraglide/messages";
  import Modal from "$lib/components/Modal.svelte";
  import type {
    EssaySettings,
    FontChoice,
    PaperVariant,
    TitlePage,
  } from "$lib/model/essay";
  import { APA_FONTS, APA_FONT_ORDER } from "$lib/model/fonts";

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
  let font = $state<FontChoice>(untrack(() => settings.font));
  let runningHead = $state(untrack(() => settings.runningHead ?? ""));
  let authorNote = $state(untrack(() => titlePage.authorNote ?? ""));

  const serifFonts = APA_FONT_ORDER.filter((f) => APA_FONTS[f].kind === "serif");
  const sansFonts = APA_FONT_ORDER.filter((f) => APA_FONTS[f].kind === "sans");

  function fontLabel(f: FontChoice): string {
    return `${APA_FONTS[f].family}, ${APA_FONTS[f].sizePt} pt`;
  }

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
      font,
      ...(variant === "professional" && runningHead.trim() !== ""
        ? { runningHead: runningHead.trim().toUpperCase().slice(0, 50) }
        : {}),
    };
    if (variant === "student") delete nextSettings.runningHead;
    onSave(nextTitle, nextSettings);
  }
</script>

<Modal title={m.titlepage_title()} {onClose}>
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

  <label class="field">
    <span>{m.titlepage_font()}</span>
    <select bind:value={font}>
      <optgroup label={m.font_group_serif()}>
        {#each serifFonts as f (f)}
          <option value={f}>{fontLabel(f)}</option>
        {/each}
      </optgroup>
      <optgroup label={m.font_group_sans()}>
        {#each sansFonts as f (f)}
          <option value={f}>{fontLabel(f)}</option>
        {/each}
      </optgroup>
    </select>
  </label>

  <label class="field">
    <span>{m.titlepage_essay_title()}</span>
    <input type="text" bind:value={title} />
  </label>

  <label class="field">
    <span>{m.titlepage_authors()}</span>
    <textarea rows="2" bind:value={authorsText} placeholder="Ana María Ruiz"
    ></textarea>
  </label>

  <label class="field">
    <span>{m.titlepage_affiliations()}</span>
    <textarea
      rows="2"
      bind:value={affiliationsText}
      placeholder="Departamento de Educación, Universidad del Valle"
    ></textarea>
  </label>

  <div class="field-row">
    <label class="field">
      <span>{m.titlepage_course()}</span>
      <input type="text" bind:value={course} placeholder="EDU 301" />
    </label>
    <label class="field">
      <span>{m.titlepage_instructor()}</span>
      <input type="text" bind:value={instructor} />
    </label>
  </div>

  <label class="field">
    <span>{m.titlepage_due_date()}</span>
    <input type="date" bind:value={dueDate} />
  </label>

  {#if variant === "professional"}
    <label class="field">
      <span>{m.titlepage_running_head()}</span>
      <input type="text" bind:value={runningHead} maxlength="50" />
    </label>
    <label class="field">
      <span>{m.titlepage_author_note()}</span>
      <textarea rows="2" bind:value={authorNote}></textarea>
    </label>
  {/if}

  <p class="hint">{m.titlepage_hint()}</p>

  {#snippet footer()}
    <button class="btn btn-ghost" onclick={onClose}>{m.common_close()}</button>
    <button class="btn btn-primary" onclick={save}>{m.titlepage_save()}</button>
  {/snippet}
</Modal>

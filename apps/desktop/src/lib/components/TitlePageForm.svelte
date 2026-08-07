<script lang="ts">
  import { untrack } from "svelte";
  import { m } from "$lib/paraglide/messages";
  import Modal from "$lib/components/Modal.svelte";
  import type {
    EssaySettings,
    FontChoice,
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
  let font = $state<FontChoice>(untrack(() => settings.font));

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
      ...titlePage,
      title: title.trim() || titlePage.title,
      authors: lines(authorsText),
      affiliations: lines(affiliationsText),
    };
    if (course.trim()) nextTitle.course = course.trim();
    else delete nextTitle.course;
    if (instructor.trim()) nextTitle.instructor = instructor.trim();
    else delete nextTitle.instructor;
    if (dueDate.trim()) nextTitle.dueDate = dueDate.trim();
    else delete nextTitle.dueDate;

    const nextSettings: EssaySettings = {
      ...settings,
      variant: "student",
      font,
    };
    onSave(nextTitle, nextSettings);
  }
</script>

<Modal title={m.titlepage_title()} {onClose} dismissOnOverlay={false}>
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
    <textarea
      rows="2"
      bind:value={authorsText}
      placeholder={m.titlepage_authors_placeholder()}
    ></textarea>
  </label>

  <label class="field">
    <span>{m.titlepage_affiliations()}</span>
    <textarea
      rows="2"
      bind:value={affiliationsText}
      placeholder={m.titlepage_affiliations_placeholder()}
    ></textarea>
  </label>

  <div class="field-row">
    <label class="field">
      <span>{m.titlepage_course()}</span>
      <input
        type="text"
        bind:value={course}
        placeholder={m.titlepage_course_placeholder()}
      />
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

  <p class="hint">{m.titlepage_hint()}</p>

  {#snippet footer()}
    <button class="btn btn-ghost" onclick={onClose}>{m.common_close()}</button>
    <button class="btn btn-primary" onclick={save}>{m.titlepage_save()}</button>
  {/snippet}
</Modal>

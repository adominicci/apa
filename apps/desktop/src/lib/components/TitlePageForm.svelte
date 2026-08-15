<script lang="ts">
  import { untrack } from "svelte";
  import { m } from "$lib/paraglide/messages";
  import Modal from "$lib/components/Modal.svelte";
  import Select, {
    type SelectGroup,
    type SelectOption,
  } from "$lib/components/Select.svelte";
  import { localizeTitlePageValidation } from "$lib/components/titlePageValidationMessages";
  import type {
    EssaySettings,
    FontChoice,
    TitlePage,
  } from "$lib/model/essay";
  import { APA_FONTS, APA_FONT_ORDER } from "$lib/model/fonts";
  import { firstStudentTitlePageBlockingIssue } from "$lib/model/titlePageValidation";

  interface Props {
    titlePage: TitlePage;
    settings: EssaySettings;
    validationMessage?: string;
    onSave: (titlePage: TitlePage, settings: EssaySettings) => void;
    onClose: () => void;
  }

  let {
    titlePage,
    settings,
    validationMessage = "",
    onSave,
    onClose,
  }: Props = $props();

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

  /* Each family previews itself in the list, mirroring how the sheet will
     render it — the same affordance the toolbar's FontMenu offers. */
  function fontOptions(kind: "serif" | "sans"): SelectOption[] {
    return APA_FONT_ORDER.filter((f) => APA_FONTS[f].kind === kind).map((f) => ({
      value: f,
      label: APA_FONTS[f].family,
      hint: `${APA_FONTS[f].sizePt} pt`,
      preview: APA_FONTS[f].stack,
    }));
  }

  const fontGroups: SelectGroup[] = [
    { label: m.font_group_serif(), options: fontOptions("serif") },
    { label: m.font_group_sans(), options: fontOptions("sans") },
  ];

  function lines(text: string): string[] {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  }

  function buildDraft(): TitlePage {
    const draft: TitlePage = {
      ...titlePage,
      title: title.trim() || titlePage.title,
      authors: lines(authorsText),
      affiliations: lines(affiliationsText),
    };
    if (course.trim()) draft.course = course.trim();
    else delete draft.course;
    if (instructor.trim()) draft.instructor = instructor.trim();
    else delete draft.instructor;
    if (dueDate.trim()) draft.dueDate = dueDate.trim();
    else delete draft.dueDate;
    return draft;
  }

  /* When export was blocked, re-validate the draft as the user types so the
     error visibly clears once the fields are export-ready. */
  const liveValidationError = $derived.by(() => {
    if (!validationMessage) return "";
    const issue = firstStudentTitlePageBlockingIssue(
      buildDraft(),
      settings.documentLanguage,
    );
    return issue ? localizeTitlePageValidation(issue.messageKey) : "";
  });

  function save() {
    const nextSettings: EssaySettings = {
      ...settings,
      variant: "student",
      font,
    };
    onSave(buildDraft(), nextSettings);
  }
</script>

<Modal title={m.titlepage_title()} {onClose} dismissOnOverlay={false}>
  <div class="field">
    <span id="titlepage-font-label">{m.titlepage_font()}</span>
    <Select
      groups={fontGroups}
      value={font}
      onChange={(next) => (font = next as FontChoice)}
      ariaLabel={m.titlepage_font()}
    />
  </div>

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

  <!-- Full width, not a two-up row: the course placeholder is a real course
       code plus title ("EDU 301: Fundamentos de la educación") and gets
       clipped mid-word at half the dialog's width. -->
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

  <label class="field">
    <span>{m.titlepage_due_date()}</span>
    <input type="date" bind:value={dueDate} />
  </label>

  <p class="hint">{m.titlepage_hint()}</p>
  {#if liveValidationError}
    <p class="hint validation-error" role="alert">{liveValidationError}</p>
  {/if}

  {#snippet footer()}
    <button class="btn btn-ghost" onclick={onClose}>{m.common_close()}</button>
    <button class="btn btn-primary" onclick={save}>{m.titlepage_save()}</button>
  {/snippet}
</Modal>

<style>
  /* p + two classes outranks modal.css's `.modal .hint` muted color. */
  p.validation-error {
    color: var(--danger);
    font-weight: 600;
  }
</style>

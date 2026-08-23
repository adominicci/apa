<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import type { Editor } from "@tiptap/core";
  import type { DocLocale } from "@tesina/engine";
  import type { Essay } from "$lib/model/essay";
  import type { EditorAddonProps } from "$lib/editor/editorAddon";
  import { uiLocale } from "$lib/state/uiLocale.svelte";
  import { m } from "$lib/paraglide/messages";
  import { createSpellingService, createTauriSpellingClient } from "./service";
  import type { SpellingService } from "./types";
  import {
    createSpellingController,
    type ExperienceSpellingIssue,
    type SpellingExperienceState,
    spellingIssueIdentity,
  } from "./controller";
  import {
    attachSpellingEditorAdapter,
    refreshSpellingDecorations,
  } from "./editorAdapter";
  import { addDocumentIgnore, effectiveDocumentIgnores } from "./persistence";
  import {
    applyDurableIssueAction,
    replaceBodyIssue,
    replaceTitleIssue,
  } from "./actions";
  import SpellingCorrectionMenu, {
    type SpellingMenuAction,
  } from "./SpellingCorrectionMenu.svelte";

  interface Props extends EditorAddonProps {
    essay: Essay;
    service?: SpellingService;
  }

  let {
    essay,
    editor,
    titleInput,
    title,
    doc,
    documentLanguage,
    onTitleChange,
    onEssayMutation,
    onOpenTitleForm,
    service = createSpellingService(createTauriSpellingClient()),
  }: Props = $props();

  let menuIssue = $state<ExperienceSpellingIssue>();
  let menuPoint = $state({ x: 24, y: 90 });
  let spellingState = $state<SpellingExperienceState>({ status: "idle", issues: [] });
  let undoUnavailable = $state(false);
  let enDraft = $state("");
  let esDraft = $state("");
  const dictionaryLanguages: readonly DocLocale[] = ["en", "es"];

  const controller = createSpellingController({
    service: untrack(() => service),
    read: () => ({
      essayId: essay.id,
      title: titleInput?.value ?? title,
      doc,
      documentLanguage,
      documentIgnores: effectiveDocumentIgnores(essay, documentLanguage),
      personalDictionary: uiLocale.personalDictionaries[documentLanguage],
    }),
    onChange(next) {
      spellingState = next;
      if (
        menuIssue && !next.issues.some((issue) =>
          spellingIssueIdentity(issue) === spellingIssueIdentity(menuIssue!)
        )
      ) menuIssue = undefined;
      if (editor && !editor.isDestroyed) refreshSpellingDecorations(editor);
    },
  });

  const labels = $derived({
    menu: m.spelling_menu_label(),
    noSuggestions: m.spelling_no_suggestions(),
    ignoreOnce: m.spelling_ignore_once(),
    ignoreDocument: m.spelling_ignore_document(),
    addPersonal: m.spelling_add_personal(),
    next: m.spelling_next_issue(),
  });

  function invalidate(source: "body" | "paper-title" | "essay" | "disabled") {
    controller.invalidate(source);
    if (uiLocale.spellingEnabled) controller.schedule();
  }

  async function openIssue(issue: ExperienceSpellingIssue | undefined) {
    if (!issue) return;
    menuIssue = issue;
    await tick();
    if (issue.source === "paper-title") {
      titleInput?.focus();
      titleInput?.setSelectionRange(issue.from, issue.to);
    } else {
      editor?.chain().focus().setTextSelection({ from: issue.from, to: issue.to }).run();
    }
  }

  function closeMenu(direction: "restore" | "forward" | "backward") {
    const issue = menuIssue;
    menuIssue = undefined;
    if (!issue) return;
    const source = issue.source === "paper-title" ? titleInput : editor?.view.dom;
    if (direction !== "restore" && source) {
      queueMicrotask(() => {
        const root = source.closest<HTMLElement>(".app");
        const focusable = root
          ? [...root.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
          )]
          : [];
        const index = focusable.indexOf(source);
        focusable[index + (direction === "forward" ? 1 : -1)]?.focus();
      });
    } else if (issue.source === "paper-title") {
      titleInput?.focus();
      titleInput?.setSelectionRange(issue.from, issue.to);
    } else editor?.chain().focus().setTextSelection({ from: issue.from, to: issue.to }).run();
  }

  function completeDurableAction(issue: ExperienceSpellingIssue, mutate: () => boolean | void) {
    const completed = applyDurableIssueAction({
      issue,
      generation: controller.generation,
      language: documentLanguage,
      titleInput,
      editor,
      mutate,
    });
    if (completed) invalidate(issue.source);
    return completed;
  }

  function handleAction(action: SpellingMenuAction) {
    const issue = menuIssue;
    if (!issue) return;
    if (action.type === "replace") {
      if (issue.source === "body" && editor) {
        if (replaceBodyIssue(editor, issue, controller.generation, action.suggestion, documentLanguage)) invalidate("body");
      } else if (titleInput) {
        const result = replaceTitleIssue({
          input: titleInput,
          issue,
          generation: controller.generation,
          language: documentLanguage,
          suggestion: action.suggestion,
          onTitleChange,
        });
        if (result === "undo-unavailable") undoUnavailable = true;
        if (result === "replaced") invalidate("paper-title");
      }
      return;
    }
    if (action.type === "ignore-once") {
      applyDurableIssueAction({
        issue,
        generation: controller.generation,
        language: documentLanguage,
        titleInput,
        editor,
        mutate: () => controller.ignoreOnce(issue),
      });
    } else if (action.type === "ignore-document") {
      completeDurableAction(issue, () => {
        const result = addDocumentIgnore(essay, issue.word, documentLanguage);
        if (result.status === "invalid" || result.status === "overflow") return false;
        onEssayMutation();
      });
    } else if (action.type === "add-personal") {
      completeDurableAction(issue, () => {
        const status = uiLocale.addPersonalDictionaryTerm(issue.word, documentLanguage);
        return status !== "invalid" && status !== "overflow";
      });
    } else void openIssue(controller.nextIssue(issue));
  }

  function statusText() {
    const language = documentLanguage === "en" ? m.spelling_language_en() : m.spelling_language_es();
    if (spellingState.status === "issues") return m.spelling_issues({ count: spellingState.issues.length });
    if (spellingState.status === "issue-free") return m.spelling_issue_free();
    if (spellingState.status === "busy") return m.spelling_busy();
    if (spellingState.status === "missing-dictionary") return m.spelling_missing_dictionary({ language });
    if (spellingState.status === "unavailable") return m.spelling_unavailable();
    if (spellingState.status === "failed") return m.spelling_failed();
    return "";
  }

  function saveDictionary(language: DocLocale, draft: string) {
    const terms = draft.split("\n").map((term) => term.trim()).filter(Boolean);
    if (!uiLocale.setPersonalDictionary(language, terms)) return;
    if (language === documentLanguage) invalidate("essay");
  }

  function clearDictionary(language: DocLocale) {
    uiLocale.clearPersonalDictionary(language);
    if (language === documentLanguage) invalidate("essay");
  }

  $effect(() => {
    const currentEditor = editor;
    if (!currentEditor || currentEditor.isDestroyed) return;
    return attachSpellingEditorAdapter(currentEditor, {
      getIssues: () => spellingState.issues,
      onBodyMutation: () => invalidate("body"),
      onAltF7: () => void openIssue(controller.nextIssue(menuIssue)),
      onIssueContextMenu: (issue, event) => {
        event.preventDefault();
        menuPoint = { x: event.clientX, y: event.clientY };
        void openIssue(issue);
        return true;
      },
    });
  });

  $effect(() => {
    const input = titleInput;
    if (!input) return;
    const onInput = () => invalidate("paper-title");
    const onContextMenu = (event: MouseEvent) => {
      const position = input.selectionStart ?? -1;
      const issue = spellingState.issues.find((candidate) =>
        candidate.source === "paper-title" && position >= candidate.from && position < candidate.to
      );
      if (!issue) return;
      event.preventDefault();
      menuPoint = { x: event.clientX, y: event.clientY };
      void openIssue(issue);
    };
    input.addEventListener("input", onInput);
    input.addEventListener("contextmenu", onContextMenu);
    return () => {
      input.removeEventListener("input", onInput);
      input.removeEventListener("contextmenu", onContextMenu);
    };
  });

  let priorTitle = untrack(() => title);
  let priorLanguage = untrack(() => documentLanguage);
  $effect(() => {
    const nextTitle = title;
    const nextLanguage = documentLanguage;
    if (nextTitle !== priorTitle || nextLanguage !== priorLanguage) {
      priorTitle = nextTitle;
      priorLanguage = nextLanguage;
      invalidate("essay");
    }
  });

  onMount(() => {
    enDraft = uiLocale.personalDictionaries.en.join("\n");
    esDraft = uiLocale.personalDictionaries.es.join("\n");
    if (uiLocale.spellingEnabled) controller.schedule();
  });
  onDestroy(() => controller.destroy());
</script>

<svelte:window onkeydown={(event) => {
  if (event.altKey && event.key === "F7" && document.activeElement === titleInput) {
    event.preventDefault();
    void openIssue(controller.nextIssue(menuIssue));
  }
}} />

<aside class="spelling-proof" data-spelling-experience-proof>
  <div class="spelling-proof-row">
    <label><input
      type="checkbox"
      checked={uiLocale.spellingEnabled}
      onchange={(event) => {
        uiLocale.setSpellingEnabled(event.currentTarget.checked);
        controller.invalidate("disabled");
        if (event.currentTarget.checked) controller.schedule();
      }}
    /> {m.spelling_enable()}</label>
    <button type="button" onclick={onOpenTitleForm}>{m.titlepage_title()}</button>
    <span data-spelling-status>{statusText()}</span>
  </div>
  <details>
    <summary>{m.spelling_personal_dictionaries()}</summary>
    {#each dictionaryLanguages as language (language)}
      <label>
        {language === "en" ? m.spelling_language_en() : m.spelling_language_es()}
        <textarea
          data-spelling-dictionary={language}
          value={language === "en" ? enDraft : esDraft}
          oninput={(event) => {
            if (language === "en") enDraft = event.currentTarget.value;
            else esDraft = event.currentTarget.value;
          }}
        ></textarea>
      </label>
      <button
        type="button"
        data-spelling-save={language}
        onclick={() => saveDictionary(language, language === "en" ? enDraft : esDraft)}
      >{m.spelling_dictionary_save()}</button>
      <button
        type="button"
        data-spelling-clear={language}
        onclick={() => clearDictionary(language)}
      >{m.spelling_dictionary_clear()}</button>
    {/each}
  </details>
  {#if undoUnavailable}<p role="alert">{m.spelling_failed()}</p>{/if}
  {#if menuIssue}
    <div class="menu-anchor" style:left={`${menuPoint.x}px`} style:top={`${menuPoint.y}px`}>
      <SpellingCorrectionMenu
        issue={menuIssue}
        {labels}
        canAddDictionary={true}
        canNext={spellingState.issues.length > 1}
        onAction={handleAction}
        onClose={closeMenu}
      />
    </div>
  {/if}
</aside>

<style>
  .spelling-proof { position: fixed; right: 1rem; bottom: 3rem; z-index: 900; max-width: 24rem; padding: 0.75rem; border: 1px solid #777; border-radius: 0.5rem; background: white; color: #222; font: 0.82rem system-ui; }
  .spelling-proof-row { display: flex; align-items: center; gap: 0.75rem; }
  details { margin-top: 0.6rem; }
  details label { display: grid; gap: 0.25rem; margin-top: 0.5rem; }
  textarea { min-height: 3rem; }
  .menu-anchor { position: fixed; z-index: 1000; }
  :global(.tesina-spelling-issue) { text-decoration: underline wavy #8b1e1e 1.5px; text-decoration-skip-ink: none; }
</style>

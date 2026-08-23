<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import type { Attachment } from "svelte/attachments";
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
  import { addCanonicalTerm } from "./canonicalTerms";
  import {
    applyDurableIssueAction,
    replaceBodyIssue,
    replaceTitleIssue,
  } from "./actions";
  import { titleOffsetAtPointer } from "./titlePointer";
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
    titleFormOpen,
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
  let requestedTitleIssue: Pick<
    ExperienceSpellingIssue,
    "source" | "from" | "to" | "termKey"
  > | undefined;
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
      if (requestedTitleIssue && next.status === "issues") {
        const requested = requestedTitleIssue;
        requestedTitleIssue = undefined;
        const titleIssue = next.issues.find((issue) =>
          issue.source === requested.source && issue.from === requested.from &&
          issue.to === requested.to && issue.termKey === requested.termKey
        );
        if (titleIssue) queueMicrotask(() => void openIssue(titleIssue));
      } else if (
        requestedTitleIssue &&
        ["issue-free", "missing-dictionary", "unavailable", "failed"]
          .includes(next.status)
      ) {
        requestedTitleIssue = undefined;
      }
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

  function invalidate(
    source: "body" | "paper-title" | "essay" | "disabled",
    retainRequestedTitleIssue = false,
  ) {
    menuIssue = undefined;
    if (!retainRequestedTitleIssue) requestedTitleIssue = undefined;
    controller.invalidate(source);
    if (uiLocale.spellingEnabled) controller.schedule();
  }

  async function openIssue(
    issue: ExperienceSpellingIssue | undefined,
    navigate = false,
  ) {
    if (!issue) return;
    if (issue.source === "paper-title") {
      if (navigate && !titleFormOpen) {
        requestedTitleIssue = {
          source: issue.source,
          from: issue.from,
          to: issue.to,
          termKey: issue.termKey,
        };
        onOpenTitleForm();
        await tick();
        return;
      }
      titleInput?.focus();
      titleInput?.setSelectionRange(issue.from, issue.to);
    } else {
      editor?.chain().focus().setTextSelection({ from: issue.from, to: issue.to }).run();
    }
    menuIssue = issue;
    await tick();
  }

  const portal: Attachment<HTMLElement> = (node) => {
    document.body.append(node);
    return () => node.remove();
  };

  function closeMenu(direction: "restore" | "forward" | "backward") {
    const issue = menuIssue;
    menuIssue = undefined;
    if (!issue) return;
    const source = issue.source === "paper-title" ? titleInput : editor?.view.dom;
    queueMicrotask(() => {
      if (issue.source === "paper-title") {
        titleInput?.focus();
        titleInput?.setSelectionRange(issue.from, issue.to);
      } else {
        editor?.chain().focus().setTextSelection({
          from: issue.from,
          to: issue.to,
        }).run();
        editor?.view.focus();
      }
      if (direction === "restore" || !source) return;
      const owner = source.closest<HTMLElement>('[role="dialog"]') ??
        source.closest<HTMLElement>(".app");
      const focusable = owner
        ? [...owner.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
        )]
        : [];
      const index = focusable.indexOf(source);
      focusable[index + (direction === "forward" ? 1 : -1)]?.focus();
    });
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
    else closeMenu("restore");
    return completed;
  }

  function handleAction(action: SpellingMenuAction) {
    const issue = menuIssue;
    if (!issue) return;
    if (action.type === "replace") {
      undoUnavailable = false;
      if (issue.source === "body" && editor) {
        if (replaceBodyIssue(editor, issue, controller.generation, action.suggestion, documentLanguage)) {
          invalidate("body");
        } else closeMenu("restore");
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
        else if (result === "stale") closeMenu("restore");
      }
      return;
    }
    if (action.type === "ignore-once") {
      const completed = applyDurableIssueAction({
        issue,
        generation: controller.generation,
        language: documentLanguage,
        titleInput,
        editor,
        mutate: () => controller.ignoreOnce(issue),
      });
      if (!completed) closeMenu("restore");
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
    } else {
      const current = applyDurableIssueAction({
        issue,
        generation: controller.generation,
        language: documentLanguage,
        titleInput,
        editor,
        mutate: () => true,
      });
      if (current) void openIssue(controller.nextIssue(issue), true);
      else closeMenu("restore");
    }
  }

  function statusText() {
    const language = documentLanguage === "en" ? m.spelling_language_en() : m.spelling_language_es();
    if (spellingState.status === "issues") {
      return spellingState.issues.length === 1
        ? m.spelling_issue_one()
        : m.spelling_issues({ count: spellingState.issues.length });
    }
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
    if (language === "en") enDraft = "";
    else esDraft = "";
    if (language === documentLanguage) invalidate("essay");
  }

  function canAddPersonalDictionary(issue: ExperienceSpellingIssue): boolean {
    const status = addCanonicalTerm(
      uiLocale.personalDictionaries[documentLanguage],
      issue.word,
      documentLanguage,
    ).status;
    return status === "added" || status === "duplicate";
  }

  $effect(() => {
    const currentEditor = editor;
    if (!currentEditor || currentEditor.isDestroyed) return;
    return attachSpellingEditorAdapter(currentEditor, {
      getIssues: () => spellingState.issues,
      onBodyMutation: () => invalidate("body"),
      onAltF7: () => void openIssue(controller.nextIssue(menuIssue), true),
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
      const position = titleOffsetAtPointer(input, event) ?? -1;
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

  $effect(() => {
    const input = titleInput;
    if (!input) return;
    const hasIssue = spellingState.issues.some((issue) =>
      issue.source === "paper-title"
    );
    const priorInvalid = input.getAttribute("aria-invalid");
    const priorIndicator = input.getAttribute("data-spelling-indicator");
    const hadClass = input.classList.contains("tesina-spelling-title-issue");
    if (hasIssue) {
      input.classList.add("tesina-spelling-title-issue");
      input.setAttribute("aria-invalid", "spelling");
      input.setAttribute("data-spelling-indicator", "misspelled");
    }
    return () => {
      if (!hadClass) input.classList.remove("tesina-spelling-title-issue");
      if (priorInvalid === null) input.removeAttribute("aria-invalid");
      else input.setAttribute("aria-invalid", priorInvalid);
      if (priorIndicator === null) input.removeAttribute("data-spelling-indicator");
      else input.setAttribute("data-spelling-indicator", priorIndicator);
    };
  });

  let priorTitle = untrack(() => title);
  let priorLanguage = untrack(() => documentLanguage);
  let priorTitleInput = untrack(() => titleInput);
  $effect(() => {
    const nextTitleInput = titleInput;
    if (nextTitleInput === priorTitleInput) return;
    priorTitleInput = nextTitleInput;
    menuIssue = undefined;
    invalidate("paper-title", requestedTitleIssue !== undefined);
  });

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
    void openIssue(controller.nextIssue(menuIssue), true);
  }
}} />

<aside class="spelling-proof" data-spelling-experience-proof>
  <div class="spelling-proof-row">
    <label><input
      type="checkbox"
      checked={uiLocale.spellingEnabled}
      onchange={(event) => {
        uiLocale.setSpellingEnabled(event.currentTarget.checked);
        requestedTitleIssue = undefined;
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
</aside>

{#if menuIssue}
  <div {@attach portal} class="menu-anchor" style:left={`${menuPoint.x}px`} style:top={`${menuPoint.y}px`}>
    <SpellingCorrectionMenu
      issue={menuIssue}
      {labels}
      canAddDictionary={canAddPersonalDictionary(menuIssue)}
      canNext={spellingState.issues.length > 1}
      onAction={handleAction}
      onClose={closeMenu}
    />
  </div>
{/if}

<style>
  .spelling-proof { position: fixed; right: 1rem; bottom: 3rem; z-index: 900; max-width: 24rem; padding: 0.75rem; border: 1px solid #777; border-radius: 0.5rem; background: white; color: #222; font: 0.82rem system-ui; }
  .spelling-proof-row { display: flex; align-items: center; gap: 0.75rem; }
  details { margin-top: 0.6rem; }
  details label { display: grid; gap: 0.25rem; margin-top: 0.5rem; }
  textarea { min-height: 3rem; }
  .menu-anchor { position: fixed; z-index: 1000; }
  :global(.tesina-spelling-issue) { text-decoration: underline wavy #8b1e1e 1.5px; text-decoration-skip-ink: none; }
  :global(input.tesina-spelling-title-issue) { outline: 2px dashed currentColor; outline-offset: 2px; }
</style>

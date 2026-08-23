<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import type { Editor as TiptapEditor } from "@tiptap/core";
  import Editor from "$lib/components/Editor.svelte";
  import { createEmptyEssay } from "$lib/model/essay";
  import { uiLocale } from "$lib/state/uiLocale.svelte";
  import { m } from "$lib/paraglide/messages";
  import { createSpellingService, createTauriSpellingClient } from "./service";
  import type { SpellingService } from "./types";
  import {
    createSpellingController,
    type ExperienceSpellingIssue,
    type SpellingExperienceState,
  } from "./controller";
  import {
    attachSpellingEditorAdapter,
    refreshSpellingDecorations,
  } from "./editorAdapter";
  import { addDocumentIgnore, effectiveDocumentIgnores } from "./persistence";
  import { replaceBodyIssue, replaceTitleIssue } from "./actions";
  import SpellingCorrectionMenu, {
    type SpellingMenuAction,
  } from "./SpellingCorrectionMenu.svelte";
  import "$lib/editor/apa.css";

  interface Props {
    service?: SpellingService;
  }
  let { service = createSpellingService(createTauriSpellingClient()) }: Props = $props();

  const essay = createEmptyEssay("en", "2026-08-22T00:00:00.000Z");
  essay.titlePage.title = "Wrng paper title";
  essay.content = {
    type: "doc",
    content: [{
      type: "sectionBody",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "This sentnce demonstrates the spelling proof." }],
      }],
    }],
  };
  let title = $state(essay.titlePage.title);
  let documentLanguage = $state<"en" | "es">("en");
  let lastDoc = $state(essay.content);
  let editor = $state<TiptapEditor>();
  let titleInput = $state<HTMLInputElement>();
  let menuIssue = $state<ExperienceSpellingIssue>();
  let menuPoint = $state({ x: 24, y: 90 });
  let spellingState = $state<SpellingExperienceState>({ status: "idle", issues: [] });
  let detachEditor: (() => void) | undefined;
  let undoUnavailable = $state(false);

  const controller = createSpellingController({
    service: untrack(() => service),
    read: () => ({
      essayId: essay.id,
      title,
      doc: lastDoc,
      documentLanguage,
      documentIgnores: effectiveDocumentIgnores(
        essay,
        documentLanguage,
      ),
      personalDictionary: uiLocale.personalDictionaries[documentLanguage],
    }),
    onChange(next) {
      spellingState = next;
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
  const titleHasIssue = $derived(
    spellingState.issues.some((issue) => issue.source === "paper-title"),
  );

  function invalidate(source: "body" | "paper-title") {
    controller.invalidate(source);
    controller.schedule();
  }

  function handleReady(instance: TiptapEditor) {
    editor = instance;
    detachEditor = attachSpellingEditorAdapter(instance, {
      getIssues: () => spellingState.issues,
      onBodyMutation: () => {
        lastDoc = instance.getJSON();
        invalidate("body");
      },
      onAltF7: () => openIssue(controller.nextIssue(menuIssue)),
      onIssueContextMenu: (issue, event) => {
        event.preventDefault();
        menuPoint = { x: event.clientX, y: event.clientY };
        openIssue(issue);
        return true;
      },
    });
    controller.schedule();
  }

  async function openIssue(issue: ExperienceSpellingIssue | undefined) {
    if (!issue) return;
    menuIssue = issue;
    if (issue.source === "paper-title") {
      await tick();
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
        const shell = source.closest<HTMLElement>("[data-spelling-experience-proof]");
        const focusable = shell
          ? [...shell.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
          )]
          : [];
        const index = focusable.indexOf(source);
        const next = focusable[index + (direction === "forward" ? 1 : -1)];
        next?.focus();
      });
      return;
    }
    if (issue.source === "paper-title") {
      titleInput?.focus();
      titleInput?.setSelectionRange(issue.from, issue.to);
    } else editor?.chain().focus().setTextSelection({ from: issue.from, to: issue.to }).run();
  }

  function mutateAndRecheck(source: "body" | "paper-title") {
    menuIssue = undefined;
    invalidate(source);
  }

  function handleAction(action: SpellingMenuAction) {
    const issue = menuIssue;
    if (!issue) return;
    if (action.type === "replace") {
      if (issue.source === "body" && editor) {
        if (replaceBodyIssue(editor, issue, controller.generation, action.suggestion, documentLanguage)) {
          mutateAndRecheck("body");
        }
      } else if (titleInput) {
        const result = replaceTitleIssue({
          input: titleInput,
          issue,
          generation: controller.generation,
          language: documentLanguage,
          suggestion: action.suggestion,
          onTitleChange(value) {
            title = value;
            essay.titlePage.title = value;
          },
        });
        if (result === "undo-unavailable") undoUnavailable = true;
        if (result === "replaced") mutateAndRecheck("paper-title");
      }
      return;
    }
    if (action.type === "ignore-once") {
      controller.ignoreOnce(issue);
      menuIssue = undefined;
    } else if (action.type === "ignore-document") {
      addDocumentIgnore(essay, issue.word, documentLanguage);
      mutateAndRecheck(issue.source);
    } else if (action.type === "add-personal") {
      uiLocale.addPersonalDictionaryTerm(issue.word, documentLanguage);
      mutateAndRecheck(issue.source);
    } else openIssue(controller.nextIssue(issue));
  }

  function statusText() {
    const language = documentLanguage === "en"
      ? m.spelling_language_en()
      : m.spelling_language_es();
    if (spellingState.status === "issues") return m.spelling_issues({ count: spellingState.issues.length });
    if (spellingState.status === "issue-free") return m.spelling_issue_free();
    if (spellingState.status === "busy") return m.spelling_busy();
    if (spellingState.status === "missing-dictionary") return m.spelling_missing_dictionary({ language });
    if (spellingState.status === "unavailable") return m.spelling_unavailable();
    if (spellingState.status === "failed") return m.spelling_failed();
    return "";
  }

  onMount(() => controller.schedule());
  onDestroy(() => {
    detachEditor?.();
    controller.destroy();
  });
</script>

<svelte:window onkeydown={(event) => {
  if (event.altKey && event.key === "F7" && document.activeElement === titleInput) {
    event.preventDefault();
    void openIssue(controller.nextIssue(menuIssue));
  }
}} />

<main class="proof-shell" data-spelling-experience-proof>
  <header>
    <h1>{m.spelling_proof_title()}</h1>
    <label>
      {m.editor_doc_language_aria()}
      <select
        aria-label={m.editor_doc_language_aria()}
        bind:value={documentLanguage}
        onchange={() => {
          essay.settings.documentLanguage = documentLanguage;
          controller.invalidate("essay");
          controller.schedule();
        }}
      >
        <option value="en">{m.spelling_language_en()}</option>
        <option value="es">{m.spelling_language_es()}</option>
      </select>
    </label>
    <label><input
      type="checkbox"
      checked={uiLocale.spellingEnabled}
      onchange={(event) => {
        uiLocale.setSpellingEnabled(event.currentTarget.checked);
        controller.invalidate("disabled");
        if (event.currentTarget.checked) controller.schedule();
      }}
    /> {m.spelling_enable()}</label>
  </header>
  <section class="paper" aria-label={m.spelling_proof_title()}>
    <label class="title-label" class:has-issue={titleHasIssue}>
      <span>Paper title {#if titleHasIssue}<span aria-hidden="true">⚠</span>{/if}</span>
      <input
        bind:this={titleInput}
        bind:value={title}
        aria-invalid={titleHasIssue}
        oninput={() => {
          essay.titlePage.title = title;
          invalidate("paper-title");
        }}
        oncontextmenu={(event) => {
          const position = event.currentTarget.selectionStart ?? -1;
          const issue = spellingState.issues.find((candidate) =>
            candidate.source === "paper-title" && position >= candidate.from && position <= candidate.to
          );
          if (issue) {
            event.preventDefault();
            menuPoint = { x: event.clientX, y: event.clientY };
            void openIssue(issue);
          }
        }}
      />
    </label>
    <Editor
      initialDoc={lastDoc}
      newlyCreated={true}
      {documentLanguage}
      citationEnv={{ refsById: new Map(), locale: "en" }}
      referenceEnv={{ references: [], locale: "en", emptyLabel: "No references" }}
      paginationEnv={null}
      onReady={handleReady}
    />
  </section>
  <p class="status" data-spelling-status>{statusText()}</p>
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
</main>

<style>
  .proof-shell { min-height: 100vh; padding: 2rem; background: #f3f0e8; color: #25221e; }
  header { display: flex; align-items: center; justify-content: space-between; max-width: 52rem; margin: 0 auto 1rem; }
  h1 { font: 600 1.25rem system-ui; }
  .paper { max-width: 48rem; min-height: 42rem; margin: auto; padding: 3rem 4rem; background: white; box-shadow: 0 0.8rem 2.5rem rgb(0 0 0 / 12%); }
  .title-label { display: grid; gap: 0.4rem; margin-bottom: 2rem; font: 600 0.85rem system-ui; }
  .title-label input { padding: 0.65rem; border: 1px solid #777; font: 700 1.1rem Georgia, serif; }
  .title-label.has-issue input { border-bottom: 3px double #8b1e1e; }
  .status { max-width: 48rem; min-height: 1.5rem; margin: 0.75rem auto; font: 0.9rem system-ui; }
  .menu-anchor { position: fixed; z-index: 1000; }
  :global(.tesina-spelling-issue) { text-decoration: underline wavy #8b1e1e 1.5px; text-decoration-skip-ink: none; }
</style>

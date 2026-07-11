<script lang="ts">
  import { untrack } from "svelte";
  import type { Editor as TiptapEditor } from "@tiptap/core";
  import type { CitationAttrs, DocLocale, Reference } from "@tesina/engine";
  import type { Essay, EssaySettings, TitlePage } from "$lib/model/essay";
  import Editor from "$lib/components/Editor.svelte";
  import CitationPopover from "$lib/components/CitationPopover.svelte";
  import EditorToolbar from "$lib/components/EditorToolbar.svelte";
  import ReferenceQuickForm from "$lib/components/ReferenceQuickForm.svelte";
  import PrintPreview from "$lib/components/PrintPreview.svelte";
  import ReferencesPanel from "$lib/components/ReferencesPanel.svelte";
  import TitlePageForm from "$lib/components/TitlePageForm.svelte";
  import { collectCitedRefIds } from "$lib/editor/citedRefs";
  import {
    type CitationEnv,
    insertCitation,
    refreshCitations,
  } from "$lib/editor/citation";
  import {
    addAbstract,
    addAppendix,
    addKeywordsLine,
    hasAbstract,
    removeAbstract,
    removeAppendixAtSelection,
    selectionInAppendix,
  } from "$lib/editor/sections";
  import { uiLocale } from "$lib/state/uiLocale.svelte";
  import { library } from "$lib/state/library.svelte";
  import { essays } from "$lib/state/essays.svelte";
  import { exportEssayToDocx } from "$lib/export/exportEssay";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    essay: Essay;
    onBack: () => void;
  }

  let { essay, onBack }: Props = $props();

  // This screen is remounted per essay via {#key essay.id}, so capturing the
  // essay's INITIAL values here is deliberate — hence the untrack() calls.
  let documentLanguage = $state<DocLocale>(
    untrack(() => essay.settings.documentLanguage),
  );
  let words = $state(0);
  let status = $state<"guardando" | "guardado" | "error">("guardado");
  let editor = $state<TiptapEditor | undefined>(undefined);
  let abstractPresent = $state(false);
  let inAppendix = $state(false);
  let citePopoverOpen = $state(false);
  let refFormOpen = $state(false);
  let titleFormOpen = $state(false);
  let panelOpen = $state(true);
  let essayTitle = $state(untrack(() => essay.titlePage.title));
  let exporting = $state(false);
  let exportMessage = $state("");
  let previewOpen = $state(false);
  let pageCount = $state(0);
  let citedCounts = $state<Map<string, number>>(
    untrack(() => collectCitedRefIds(essay.content)),
  );
  let lastDoc = $state<unknown>(untrack(() => essay.content));
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  // Mutable env shared with the citation plugin; updated in place, then
  // refreshCitations() forces every chip to recompute (see citation.ts).
  const citationEnv: CitationEnv = {
    refsById: untrack(() => library.byId()),
    locale: untrack(() => documentLanguage),
  };

  function syncCitationEnv() {
    citationEnv.refsById = library.byId();
    citationEnv.locale = documentLanguage;
    if (editor) refreshCitations(editor);
  }

  function snapshotCitedRefs(): Reference[] {
    const byId = library.byId();
    const cited: Reference[] = [];
    for (const refId of citedCounts.keys()) {
      const ref = byId.get(refId);
      if (ref) cited.push(ref);
    }
    return cited;
  }

  function scheduleSave() {
    status = "guardando";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        essay.settings.documentLanguage = documentLanguage;
        essay.content = lastDoc;
        essay.referencesSnapshot = snapshotCitedRefs();
        await essays.persist(essay);
        status = "guardado";
      } catch (err) {
        console.error("No se pudo guardar el ensayo:", err);
        status = "error";
      }
    }, 500);
  }

  function handleUpdate(docJson: unknown, wordCount: number) {
    lastDoc = docJson;
    words = wordCount;
    citedCounts = collectCitedRefIds(docJson);
    if (editor) abstractPresent = hasAbstract(editor);
    scheduleSave();
  }

  function handleReady(instance: TiptapEditor) {
    editor = instance;
    abstractPresent = hasAbstract(instance);
    const trackAppendix = () => {
      inAppendix = selectionInAppendix(instance);
    };
    instance.on("selectionUpdate", trackAppendix);
    instance.on("transaction", trackAppendix);
  }

  function handleRemoveAppendix() {
    if (editor) removeAppendixAtSelection(editor);
  }

  function setLanguage(lang: DocLocale) {
    if (documentLanguage === lang) return;
    documentLanguage = lang;
    syncCitationEnv();
    scheduleSave();
  }

  function toggleAbstract() {
    if (!editor) return;
    if (abstractPresent) removeAbstract(editor);
    else addAbstract(editor);
    abstractPresent = hasAbstract(editor);
  }

  function handleAddKeywords() {
    if (!editor) return;
    if (!abstractPresent) addAbstract(editor);
    addKeywordsLine(editor);
    abstractPresent = hasAbstract(editor);
  }

  function handleAddAppendix() {
    if (editor) addAppendix(editor);
  }

  const STATUS_LABELS = {
    guardando: m.editor_status_saving,
    guardado: m.editor_status_saved,
    error: m.editor_status_error,
  } as const;

  function handleInsertCitation(attrs: CitationAttrs) {
    citePopoverOpen = false;
    if (editor) insertCitation(editor, attrs);
  }

  function handleSaveReference(ref: Reference) {
    library.add(ref);
    refFormOpen = false;
    syncCitationEnv();
  }

  function handleCiteFromPanel(refId: string) {
    if (!editor) return;
    insertCitation(editor, { items: [{ refId }], mode: "parenthetical" });
  }

  function handleDeleteReference(refId: string) {
    library.remove(refId);
    syncCitationEnv();
  }

  async function handleExport() {
    if (!editor || exporting) return;
    exporting = true;
    exportMessage = "";
    try {
      const references = essay.settings.includeUncitedReferences
        ? [...library.byId().values()]
        : snapshotCitedRefs();
      const outcome = await exportEssayToDocx(
        essay,
        lastDoc ?? editor.getJSON(),
        references,
      );
      if (outcome.status === "saved") {
        exportMessage = m.editor_exported({ path: outcome.path });
      } else if (outcome.status === "error") {
        exportMessage = m.editor_export_error({ message: outcome.message });
      }
    } finally {
      exporting = false;
    }
  }

  function handleSaveTitlePage(
    titlePage: TitlePage,
    settings: EssaySettings,
  ) {
    essay.titlePage = titlePage;
    essay.settings = { ...settings, documentLanguage };
    essayTitle = titlePage.title;
    titleFormOpen = false;
    scheduleSave();
  }
</script>

<div class="shell">
  <header>
    <button class="act" onclick={onBack} aria-label={m.editor_back_aria()}>
      {m.editor_back()}
    </button>
    <span class="brand">Tesina</span>
    <span class="doc">{essayTitle}</span>
    <span class="spacer"></span>
    <button class="act" onclick={() => (titleFormOpen = true)}>
      {m.editor_title_page()}
    </button>
    <div class="seg" role="group" aria-label={m.editor_doc_language_aria()}>
      <button
        class:active={documentLanguage === "es"}
        onclick={() => setLanguage("es")}
      >
        ES
      </button>
      <button
        class:active={documentLanguage === "en"}
        onclick={() => setLanguage("en")}
      >
        EN
      </button>
    </div>
    <button class="act" onclick={toggleAbstract} disabled={!editor}>
      {abstractPresent ? m.editor_remove_abstract() : m.editor_add_abstract()}
    </button>
    <button class="act" onclick={handleAddKeywords} disabled={!editor}>
      {m.editor_keywords()}
    </button>
    <button class="act" onclick={handleAddAppendix} disabled={!editor}>
      {m.editor_add_appendix()}
    </button>
    {#if inAppendix}
      <button class="act" onclick={handleRemoveAppendix}>
        {m.editor_remove_appendix()}
      </button>
    {/if}
    <span class="divider"></span>
    <button
      class="act"
      onclick={() => {
        previewOpen = !previewOpen;
        if (!previewOpen) pageCount = 0;
      }}
    >
      {previewOpen ? m.editor_back_to_editor() : m.editor_preview()}
    </button>
    {#if previewOpen}
      <button class="act" onclick={() => window.print()}>
        {m.editor_print()}
      </button>
    {/if}
    <button class="act" onclick={() => (panelOpen = !panelOpen)}>
      {panelOpen ? m.editor_hide_references() : m.editor_show_references()}
    </button>
    <div class="cite-anchor">
      <button
        class="act"
        onclick={() => (citePopoverOpen = !citePopoverOpen)}
        disabled={!editor}
      >
        {m.editor_insert_citation()}
      </button>
      {#if citePopoverOpen}
        <CitationPopover
          references={library.references}
          {documentLanguage}
          onInsert={handleInsertCitation}
          onClose={() => (citePopoverOpen = false)}
        />
      {/if}
    </div>
    <button
      class="act primary"
      onclick={handleExport}
      disabled={!editor || exporting}
    >
      {exporting ? m.editor_exporting() : m.editor_export()}
    </button>
    <button
      class="act icon"
      onclick={() => uiLocale.cycleTheme()}
      aria-label={m.common_theme()}
      title={m.common_theme()}
    >
      {uiLocale.theme === "light" ? "☀" : uiLocale.theme === "dark" ? "☾" : "◐"}
    </button>
  </header>
  <EditorToolbar {editor} />
  <main>
    <div class="editor-col" class:hidden={previewOpen}>
      <Editor
        initialDoc={essay.content}
        {documentLanguage}
        {citationEnv}
        onUpdate={handleUpdate}
        onReady={handleReady}
      />
    </div>
    {#if previewOpen}
      <div class="editor-col preview-col">
        {#key documentLanguage}
          <PrintPreview
            {essay}
            docJson={lastDoc ?? editor?.getJSON()}
            references={snapshotCitedRefs()}
            onPageCount={(pages) => (pageCount = pages)}
          />
        {/key}
      </div>
    {/if}
    {#if panelOpen && !previewOpen}
      <ReferencesPanel
        references={library.references}
        {citedCounts}
        {documentLanguage}
        onCite={handleCiteFromPanel}
        onDelete={handleDeleteReference}
        onAdd={() => (refFormOpen = true)}
      />
    {/if}
  </main>
  <footer>
    <span>
      {words === 1 ? m.editor_words_one() : m.editor_words_many({
        count: words,
      })}
    </span>
    {#if previewOpen && pageCount > 0}
      <span>
        {pageCount === 1 ? m.editor_pages_one() : m.editor_pages_many({
          count: pageCount,
        })}
      </span>
    {/if}
    <span>
      {m.editor_refs_in_library({ count: library.references.length })}
    </span>
    <span>
      {m.editor_document_label({
        lang: documentLanguage === "es" ? "Español" : "English",
      })}
    </span>
    {#if exportMessage}
      <span class="export-msg">{exportMessage}</span>
    {/if}
    <span class="status" data-status={status}>{STATUS_LABELS[status]()}</span>
  </footer>
</div>

{#if refFormOpen}
  <ReferenceQuickForm
    onSave={handleSaveReference}
    onClose={() => (refFormOpen = false)}
  />
{/if}

{#if titleFormOpen}
  <TitlePageForm
    titlePage={essay.titlePage}
    settings={essay.settings}
    onSave={handleSaveTitlePage}
    onClose={() => (titleFormOpen = false)}
  />
{/if}

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: var(--font);
    background: var(--canvas);
    color: var(--fg);
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--chrome);
    flex-wrap: wrap;
  }

  .brand {
    font-family: var(--serif);
    font-weight: 700;
    color: var(--accent);
  }

  .act.icon {
    width: 30px;
    padding: 4px 0;
    text-align: center;
    border: none;
    color: var(--muted);
  }

  .act.icon:hover:enabled {
    background: var(--hover);
    color: var(--fg);
  }

  .doc {
    font-size: 0.85rem;
    color: var(--muted);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .spacer {
    flex: 1;
  }

  .divider {
    width: 1px;
    height: 18px;
    background: var(--border);
  }

  .cite-anchor {
    position: relative;
  }

  .seg {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 7px;
    overflow: hidden;
  }

  .seg button {
    border: none;
    background: transparent;
    font: inherit;
    font-size: 0.78rem;
    padding: 4px 10px;
    cursor: pointer;
    color: var(--muted);
  }

  .seg button.active {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }

  .act {
    border: 1px solid var(--border);
    background: transparent;
    border-radius: 7px;
    font: inherit;
    font-size: 0.78rem;
    padding: 4px 10px;
    cursor: pointer;
    color: var(--fg-2);
  }

  .act.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-on);
  }

  .act:hover:enabled {
    filter: brightness(0.97);
  }

  .act:disabled {
    opacity: 0.5;
    cursor: default;
  }

  main {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .editor-col {
    flex: 1;
    overflow-y: auto;
    min-width: 0;
  }

  .editor-col.hidden {
    display: none;
  }

  footer {
    display: flex;
    gap: 16px;
    padding: 6px 16px;
    border-top: 1px solid var(--border);
    background: var(--chrome);
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
  }

  .export-msg {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 40%;
  }

  .status {
    margin-left: auto;
  }

  .status[data-status="guardado"] {
    color: var(--success);
  }

  .status[data-status="error"] {
    color: var(--danger);
  }

  
</style>

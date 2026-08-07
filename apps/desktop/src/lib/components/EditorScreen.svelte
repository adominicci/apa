<script lang="ts">
  import { untrack } from "svelte";
  import type { Editor as TiptapEditor } from "@tiptap/core";
  import type { CitationAttrs, DocLocale, Reference } from "@tesina/engine";
  import { getTerms } from "@tesina/engine";
  import type {
    Essay,
    EssaySettings,
    FontChoice,
    TitlePage,
  } from "$lib/model/essay";
  import { APA_FONTS } from "$lib/model/fonts";
  import Editor from "$lib/components/Editor.svelte";
  import Toolbar from "$lib/components/Toolbar.svelte";
  import CoverSheet, {
    type CoverPatch,
  } from "$lib/components/CoverSheet.svelte";
  import ReferencesSheet from "$lib/components/ReferencesSheet.svelte";
  import CitationPopover from "$lib/components/CitationPopover.svelte";
  import HeadingMenu from "$lib/components/HeadingMenu.svelte";
  import ListMenu from "$lib/components/ListMenu.svelte";
  import TableMenu from "$lib/components/TableMenu.svelte";
  import FontMenu from "$lib/components/FontMenu.svelte";
  import TableInsertDialog from "$lib/components/TableInsertDialog.svelte";
  import EquationDialog from "$lib/components/EquationDialog.svelte";
  import "$lib/components/float-menu.css";
  import PrintPreview from "$lib/components/PrintPreview.svelte";
  import RefEntry from "$lib/components/RefEntry.svelte";
  import ReferenceQuickForm from "$lib/components/ReferenceQuickForm.svelte";
  import BibImportModal from "$lib/components/BibImportModal.svelte";
  import TitlePageForm from "$lib/components/TitlePageForm.svelte";
  import { collectCitedRefIds } from "$lib/editor/citedRefs";
  import {
    canInsertApaEquation,
    insertApaEquation,
    insertApaTable,
    insertFigure,
    updateApaEquationAt,
  } from "$lib/editor/blocks";
  import { importImageFile } from "$lib/persist/assets";
  import { buildOutline, type OutlineItem } from "$lib/editor/outline";
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
  import { library } from "$lib/state/library.svelte";
  import { essays } from "$lib/state/essays.svelte";
  import { uiLocale } from "$lib/state/uiLocale.svelte";
  import { dismissable } from "$lib/dom/dismiss";
  import { exportEssayToDocx } from "$lib/export/exportEssay";
  import {
    createStudentExportSnapshot,
    runStudentTitlePageValidatedExport,
    type TitlePageValidationMessageKey,
  } from "$lib/model/titlePageValidation";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    essay: Essay;
    onBack: () => void;
    onOpenLibrary: () => void;
  }

  let { essay, onBack, onOpenLibrary }: Props = $props();

  // Remounted per essay via {#key essay.id}; initial captures are deliberate.
  let documentLanguage = $state<DocLocale>(
    untrack(() => essay.settings.documentLanguage),
  );
  let words = $state(untrack(() => 0));
  let status = $state<"guardando" | "guardado" | "error">("guardado");
  let editor = $state<TiptapEditor | undefined>(undefined);
  let abstractPresent = $state(false);
  let inAppendix = $state(false);
  let citePopoverOpen = $state(false);
  let refFormOpen = $state(false);
  let citeOnSave = $state(false);
  let titleFormOpen = $state(false);
  let addMenuOpen = $state(false);
  let outlineOpen = $state(true);
  let refsOpen = $state(true);
  let focusMode = $state(false);
  let previewOpen = $state(false);
  let pageCount = $state(0);
  let refSearch = $state("");
  let confirmingDelete = $state<string | null>(null);
  let exporting = $state(false);
  let exportMessage = $state("");
  let titlePageValidationError = $state("");
  let essayTitle = $state(untrack(() => essay.titlePage.title));
  let outline = $state<OutlineItem[]>(
    untrack(() => buildOutline(essay.content)),
  );
  let selPos = $state(0);
  let bubble = $state<{ x: number; y: number } | null>(null);
  /** Active block format at the cursor, for the Headings/Lists menus. */
  let activeHeadingLevel = $state<number | null>(null);
  let activeList = $state<"bullet" | "ordered" | "lettered" | null>(null);
  let inTable = $state(false);
  let canInsertEquation = $state(false);
  let tableDialogOpen = $state(false);
  /** Insert opens with a blank LaTeX field; edit (from the pencil menu) opens
   * pre-filled at that equation's position. Same dialog either way. */
  let equationDialog = $state<
    { mode: "insert" } | { mode: "edit"; pos: number; latex: string } | null
  >(null);
  /** Only one bottom-bar dropdown open at a time. */
  let openMenu = $state<"headings" | "lists" | "table" | "font" | null>(null);
  let citedCounts = $state<Map<string, number>>(
    untrack(() => collectCitedRefIds(essay.content)),
  );
  let lastDoc = $state<unknown>(untrack(() => essay.content));
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const citationEnv: CitationEnv = {
    refsById: untrack(() => library.byId()),
    locale: untrack(() => documentLanguage),
  };

  const wordGoal = $derived(essay.settings.wordGoal ?? 2500);
  const progress = $derived(Math.min(100, Math.round((words / wordGoal) * 100)));

  // Inline-editable word goal (click the label in the outline progress card).
  let editingGoal = $state(false);
  let goalDraft = $state(2500);

  function startEditGoal() {
    goalDraft = wordGoal;
    editingGoal = true;
  }

  function commitGoal() {
    if (!editingGoal) return;
    const raw = Number(goalDraft);
    const n = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : wordGoal;
    const clamped = Math.min(100000, Math.max(100, n));
    essay.settings = { ...essay.settings, wordGoal: clamped };
    editingGoal = false;
    scheduleSave();
  }
  const pagesEst = $derived(Math.max(1, Math.ceil(words / 250)));

  function setFont(font: FontChoice) {
    essay.settings = { ...essay.settings, font };
    scheduleSave();
  }

  /** Editor sheets render in the chosen APA font via inherited CSS vars. */
  const docFont = $derived(APA_FONTS[essay.settings.font]);
  const sheetFontStyle = $derived(
    `--doc-font: ${docFont.stack}; --doc-font-size: ${docFont.sizePt}pt; --body-title: ${JSON.stringify(essayTitle)}`,
  );
  /** One reactive selection shared by the live sheet, preview, and export. */
  const referencesForExport = $derived.by(() => {
    if (essay.settings.includeUncitedReferences) {
      return [...library.byId().values()];
    }
    // Recompute from the reactive cited counts + library.
    const byId = library.byId();
    const out: Reference[] = [];
    for (const refId of citedCounts.keys()) {
      const ref = byId.get(refId);
      if (ref) out.push(ref);
    }
    return out;
  });

  const abstractLabel = $derived(
    getTerms(documentLanguage).headings.abstract,
  );
  const referencesLabel = $derived(
    getTerms(documentLanguage).headings.references,
  );
  const appendixLabel = $derived(
    getTerms(documentLanguage).headings.appendix,
  );

  function localizeTitlePageValidation(
    key: TitlePageValidationMessageKey,
  ): string {
    const messages: Record<TitlePageValidationMessageKey, () => string> = {
      titlepage_error_missing_title: m.titlepage_error_missing_title,
      titlepage_error_missing_authors: m.titlepage_error_missing_authors,
      titlepage_error_missing_affiliations:
        m.titlepage_error_missing_affiliations,
      titlepage_error_missing_course: m.titlepage_error_missing_course,
      titlepage_error_missing_instructor: m.titlepage_error_missing_instructor,
      titlepage_error_missing_due_date: m.titlepage_error_missing_due_date,
      titlepage_error_ambiguous_affiliations:
        m.titlepage_error_ambiguous_affiliations,
    };
    return messages[key]();
  }

  const STATUS_LABELS = {
    guardando: m.editor_status_saving,
    guardado: m.editor_status_saved,
    error: m.editor_status_error,
  } as const;

  interface RefRow {
    ref: Reference;
    text: string;
    cited: number;
    personal: boolean;
  }

  const refRows = $derived.by(() => {
    const t = getTerms(documentLanguage);
    const rows: RefRow[] = library.references.map((ref) => {
      const personal = ref.type === "personalCommunication";
      let text: string;
      if (personal) {
        const first = ref.authors[0];
        const name = first
          ? first.kind === "group" ? first.name : first.family
          : "";
        text = `${name} — ${t.personalCommunication}`;
      } else {
        text = "";
      }
      return { ref, text, cited: citedCounts.get(ref.id) ?? 0, personal };
    });
    const q = refSearch.trim().toLowerCase();
    return rows.filter((row) =>
      q === "" ||
      JSON.stringify(row.ref).toLowerCase().includes(q)
    );
  });

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

  // What we persist as the essay's denormalized snapshot: the live cited refs
  // PLUS the prior snapshot copy of any still-cited reference that has since
  // been deleted from the shared library. Without this, the first autosave
  // after deleting a cited ref would drop its copy and defeat the reconcile
  // restore on reopen (model/reconcile.ts). The live sheet keeps using the
  // plain snapshot above.
  function snapshotForPersist(): Reference[] {
    const live = snapshotCitedRefs();
    const have = new Set(live.map((r) => r.id));
    const merged = [...live];
    for (const r of essay.referencesSnapshot ?? []) {
      if (!have.has(r.id) && citedCounts.has(r.id)) merged.push(r);
    }
    return merged;
  }

  function scheduleSave() {
    status = "guardando";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        essay.settings.documentLanguage = documentLanguage;
        essay.content = lastDoc;
        essay.referencesSnapshot = snapshotForPersist();
        await essays.persist(essay);
        status = "guardado";
      } catch (err) {
        console.error("No se pudo guardar el ensayo:", err);
        status = "error";
      }
    }, 500);
  }

  // Flush the debounced autosave before the editor unmounts for the manager;
  // otherwise the pending 500 ms timer would race the navigation and lose the
  // latest content + snapshot.
  async function openLibrary() {
    clearTimeout(saveTimer);
    try {
      essay.settings.documentLanguage = documentLanguage;
      essay.content = lastDoc;
      essay.referencesSnapshot = snapshotForPersist();
      await essays.persist(essay);
      status = "guardado";
    } catch (err) {
      console.error("No se pudo guardar el ensayo:", err);
      status = "error";
      // Stay in the editor so the error is visible and the user can retry —
      // the debounce is already cleared, so navigating away would lose the
      // unpersisted content/snapshot.
      return;
    }
    onOpenLibrary();
  }

  function handleUpdate(docJson: unknown, wordCount: number) {
    lastDoc = docJson;
    words = wordCount;
    citedCounts = collectCitedRefIds(docJson);
    outline = buildOutline(docJson);
    if (editor) abstractPresent = hasAbstract(editor);
    scheduleSave();
  }

  function updateBubble(instance: TiptapEditor) {
    const { from, to, empty } = instance.state.selection;
    if (empty || to - from < 1) {
      bubble = null;
      return;
    }
    try {
      const start = instance.view.coordsAtPos(from);
      const end = instance.view.coordsAtPos(to);
      bubble = {
        x: (start.left + end.right) / 2,
        y: Math.min(start.top, end.top) - 10,
      };
    } catch {
      bubble = null;
    }
  }

  function handleReady(instance: TiptapEditor) {
    editor = instance;
    abstractPresent = hasAbstract(instance);
    words = instance.state.doc.textBetween(
      0,
      instance.state.doc.content.size,
      " ",
      " ",
    ).trim().split(/\s+/).filter((w) => w !== "").length;
    const track = () => {
      inAppendix = selectionInAppendix(instance);
      selPos = instance.state.selection.from;
      updateBubble(instance);
      let level: number | null = null;
      for (let l = 1; l <= 5; l++) {
        if (instance.isActive("heading", { level: l })) {
          level = l;
          break;
        }
      }
      activeHeadingLevel = level;
      activeList = instance.isActive("bulletList")
        ? "bullet"
        : instance.isActive("orderedList")
        ? (instance.isActive("orderedList", { listStyle: "lower-alpha" })
          ? "lettered"
          : "ordered")
        : null;
      inTable = instance.isActive("table");
      canInsertEquation = canInsertApaEquation(instance.state);
    };
    instance.on("selectionUpdate", track);
    instance.on("transaction", track);
    track();
    instance.on("blur", () => {
      // Let bubble clicks land before hiding.
      setTimeout(() => (bubble = null), 150);
    });
  }

  function goTo(item: OutlineItem) {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .setTextSelection(Math.min(item.pos + 1, editor.state.doc.content.size))
      .scrollIntoView()
      .run();
  }

  const activeIndex = $derived.by(() => {
    let index = -1;
    outline.forEach((item, i) => {
      if (item.pos <= selPos) index = i;
    });
    return index;
  });

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
    addMenuOpen = false;
  }

  function handleAddKeywords() {
    if (!editor) return;
    if (!abstractPresent) addAbstract(editor);
    addKeywordsLine(editor);
    abstractPresent = hasAbstract(editor);
    addMenuOpen = false;
  }

  function handleAddAppendix() {
    if (editor) addAppendix(editor);
    addMenuOpen = false;
  }

  function handleRemoveAppendix() {
    if (editor) removeAppendixAtSelection(editor);
    addMenuOpen = false;
  }

  async function handleExport() {
    if (!editor || exporting) return;
    const currentEditor = editor;
    exporting = true;
    exportMessage = "";
    titlePageValidationError = "";
    try {
      const exportSnapshot = createStudentExportSnapshot(
        essay,
        lastDoc ?? currentEditor.getJSON(),
        referencesForExport,
        documentLanguage,
      );
      const result = await runStudentTitlePageValidatedExport(
        exportSnapshot,
        async (snapshot) => {
          return await exportEssayToDocx(
            snapshot.essay,
            snapshot.document,
            snapshot.references,
          );
        },
      );
      if (result.status === "blocked") {
        titlePageValidationError = localizeTitlePageValidation(
          result.messageKey,
        );
        exportMessage = titlePageValidationError;
        titleFormOpen = true;
        return;
      }

      const outcome = result.outcome;
      if (outcome.status === "saved") {
        exportMessage = m.editor_exported({ path: outcome.path });
      } else if (outcome.status === "error") {
        exportMessage = m.editor_export_error({ message: outcome.message });
      }
    } finally {
      exporting = false;
    }
  }

  function handleInsertCitation(attrs: CitationAttrs) {
    citePopoverOpen = false;
    if (editor) insertCitation(editor, attrs);
  }

  let figureInput = $state<HTMLInputElement | undefined>(undefined);

  async function handleFigureFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || !editor) return;
    try {
      const relPath = await importImageFile(file);
      insertFigure(editor, relPath);
    } catch (err) {
      console.error("No se pudo insertar la figura:", err);
    }
  }

  // ── BibTeX import (shared modal; opened from the reference form) ──
  /** Largest .bib we'll read into memory (huge for a bibliography). */
  const MAX_BIB_BYTES = 5_000_000;
  let bibInput = $state<HTMLInputElement | undefined>(undefined);
  let bibText = $state<string | null>(null);
  let bibError = $state<string | null>(null);

  async function handleBibFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    bibError = null;
    if (!file) return;
    if (file.size > MAX_BIB_BYTES) {
      bibError = m.bib_file_too_big();
      return;
    }
    try {
      bibText = await file.text();
      refFormOpen = false;
    } catch (err) {
      console.error("No se pudo leer el archivo .bib:", err);
      bibError = m.bib_read_error();
    }
  }

  function handleSaveReference(ref: Reference) {
    library.add(ref);
    refFormOpen = false;
    syncCitationEnv();
    // From the writing bar the new source is cited where the cursor sits.
    if (citeOnSave && editor && ref.type !== "personalCommunication") {
      insertCitation(editor, {
        items: [{ refId: ref.id }],
        mode: "parenthetical",
      });
    }
    citeOnSave = false;
  }

  function openRefForm(insertAfter: boolean) {
    citeOnSave = insertAfter;
    refFormOpen = true;
  }

  function handleCiteFromPanel(refId: string) {
    if (!editor) return;
    insertCitation(editor, { items: [{ refId }], mode: "parenthetical" });
  }

  function handleDeleteReference(refId: string) {
    if (confirmingDelete !== refId) {
      confirmingDelete = refId;
      return;
    }
    confirmingDelete = null;
    library.remove(refId);
    syncCitationEnv();
  }

  function handleSaveTitlePage(titlePage: TitlePage, settings: EssaySettings) {
    essay.titlePage = titlePage;
    essay.settings = {
      ...settings,
      documentLanguage,
      variant: "student",
    };
    essayTitle = titlePage.title;
    titlePageValidationError = "";
    exportMessage = "";
    titleFormOpen = false;
    scheduleSave();
  }

  /** Applies an inline edit from the student title-page sheet. */
  function handleCoverChange(patch: CoverPatch) {
    essay.titlePage = { ...essay.titlePage, ...patch };
    if (patch.title !== undefined) essayTitle = essay.titlePage.title;
    scheduleSave();
  }
</script>

<div
  class="app"
  class:no-outline={!outlineOpen}
  class:no-refs={!refsOpen}
  class:focus={focusMode}
>
  <header class="titlebar" data-tauri-drag-region>
    <div class="tb-left">
      <div class="traffic-space"></div>
      <button class="icon-btn" onclick={onBack} title={m.tb_back()} aria-label={m.tb_back()}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" width="16" height="16"><path d="M14 6l-6 6 6 6" /></svg>
      </button>
    </div>
    <div class="tb-title" data-tauri-drag-region>
      <span class="mark">T</span> <b>{essayTitle}</b>
    </div>
    <div class="tb-actions">
      <button
        class="icon-btn"
        class:on={outlineOpen && !focusMode}
        onclick={() => (outlineOpen = !outlineOpen)}
        title={m.tb_outline()}
        aria-label={m.tb_outline()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>
      </button>
      <button
        class="icon-btn"
        class:on={refsOpen && !focusMode}
        onclick={() => (refsOpen = !refsOpen)}
        title={m.tb_refs()}
        aria-label={m.tb_refs()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 4h11a2 2 0 0 1 2 2v14l-4-2-4 2V6H6z" /><path d="M6 4v16" /></svg>
      </button>
      <button
        class="icon-btn"
        class:on={previewOpen}
        onclick={() => {
          previewOpen = !previewOpen;
          if (!previewOpen) pageCount = 0;
        }}
        title={m.tb_preview()}
        aria-label={m.tb_preview()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.6" /></svg>
      </button>
      <button
        class="icon-btn"
        onclick={() => uiLocale.cycleTheme()}
        title={m.common_theme()}
        aria-label={m.common_theme()}
      >
        {uiLocale.theme === "light" ? "☀" : uiLocale.theme === "dark" ? "☾" : "◐"}
      </button>
    </div>
  </header>

  <div class="shell">
    <aside class="outline">
      <div class="panel-head">
        <h4>{m.outline_title()}</h4>
        <div class="add-wrap">
          <button class="mini" onclick={() => (addMenuOpen = !addMenuOpen)} aria-label={m.outline_add()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          {#if addMenuOpen}
            <div class="menu" role="menu">
              <button role="menuitem" onclick={toggleAbstract}>
                {abstractPresent ? m.editor_remove_abstract() : m.editor_add_abstract()}
              </button>
              <button role="menuitem" onclick={handleAddKeywords}>{m.editor_keywords()}</button>
              <button role="menuitem" onclick={handleAddAppendix}>{m.editor_add_appendix()}</button>
              {#if inAppendix}
                <button role="menuitem" onclick={handleRemoveAppendix}>{m.editor_remove_appendix()}</button>
              {/if}
            </div>
          {/if}
        </div>
      </div>

      <button class="out-item" onclick={() => (titleFormOpen = true)}>
        <span class="n">—</span>{m.outline_titlepage(undefined, {
          locale: documentLanguage,
        })}
        <span class="wc">{m.outline_one_page(undefined, {
          locale: documentLanguage,
        })}</span>
      </button>
      {#each outline as item, i (item.pos)}
        <button
          class="out-item"
          class:sub={item.sub}
          class:active={i === activeIndex}
          onclick={() => goTo(item)}
        >
          {#if !item.sub}<span class="n">{item.marker}</span>{/if}
          {item.label ||
            (item.marker === "R" ? abstractLabel : appendixLabel)}
          {#if !item.sub}
            <span class="wc">
              {item.words > 0 ? item.words.toLocaleString(uiLocale.current) : ""}
            </span>
          {/if}
        </button>
      {/each}
      <button class="out-item" onclick={() => (refsOpen = true)}>
        <span class="n">R</span>{referencesLabel}
        <span class="wc">{citedCounts.size}</span>
      </button>

      <div class="out-progress">
        <div class="pl">
          {#if editingGoal}
            <input
              class="goal-input"
              type="number"
              min="100"
              max="100000"
              step="50"
              bind:value={goalDraft}
              aria-label={m.outline_goal_edit()}
              onkeydown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitGoal();
                } else if (e.key === "Escape") {
                  editingGoal = false;
                }
              }}
              onblur={commitGoal}
              {@attach (node) => {
                node.focus();
                node.select();
              }}
            />
          {:else}
            <button
              class="goal-btn"
              onclick={startEditGoal}
              title={m.outline_goal_edit()}
            >
              {m.outline_progress({
                goal: wordGoal.toLocaleString(uiLocale.current),
              })}
            </button>
          {/if}
          <span>{progress}%</span>
        </div>
        <div class="bar"><span style="width: {progress}%"></span></div>
      </div>
    </aside>

    <main class="canvas">
      {#if previewOpen}
        <div class="preview-host">
          {#key documentLanguage}
            <PrintPreview
              {essay}
              docJson={lastDoc ?? editor?.getJSON()}
              references={referencesForExport}
              onPageCount={(pages) => (pageCount = pages)}
            />
          {/key}
        </div>
      {:else}
        <div class="sheet-stack" style={sheetFontStyle}>
          <CoverSheet
            titlePage={essay.titlePage}
            language={documentLanguage}
            onChange={handleCoverChange}
            onOpenForm={() => (titleFormOpen = true)}
          />
          <Editor
            initialDoc={essay.content}
            {documentLanguage}
            {citationEnv}
            onUpdate={handleUpdate}
            onReady={handleReady}
            onEditEquation={(pos, latex) =>
              (equationDialog = { mode: "edit", pos, latex })}
          />
          <ReferencesSheet
            references={referencesForExport}
            language={documentLanguage}
          />
        </div>
      {/if}
    </main>

    <aside class="refs">
      <div class="panel-head">
        <h4>{referencesLabel}</h4>
        <div class="panel-head-actions">
          <button class="btn btn-ghost btn-sm" onclick={openLibrary}>
            {m.libm_manage()}
          </button>
          <button class="btn btn-primary btn-sm" onclick={() => openRefForm(false)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" /></svg>
            {m.panel_add().replace("+ ", "")}
          </button>
        </div>
      </div>
      <div class="search-ref">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input type="text" placeholder={m.refs_search()} bind:value={refSearch} />
      </div>
      {#each refRows as row (row.ref.id)}
        <div class="ref-card">
          {#if row.personal}
            <p class="rtxt">{row.text}</p>
          {:else}
            <RefEntry reference={row.ref} language={documentLanguage} />
          {/if}
          <div class="ref-foot">
            <span
              class="status"
              class:cited={row.cited > 0}
              class:uncited={row.cited === 0 && !row.personal}
            >
              <span class="dot"></span>
              {row.personal
                ? m.refs_in_text_only()
                : row.cited > 0
                ? `${m.refs_cited()} · ${row.cited}`
                : m.refs_uncited()}
            </span>
            <button
              class="del"
              onclick={() => handleDeleteReference(row.ref.id)}
              onblur={() => (confirmingDelete = null)}
            >
              {confirmingDelete === row.ref.id ? m.panel_delete_confirm() : "×"}
            </button>
            <button class="ins" onclick={() => handleCiteFromPanel(row.ref.id)}>
              {m.refs_insert()}
            </button>
          </div>
        </div>
      {/each}
    </aside>
  </div>

  {#if !previewOpen}
    <Toolbar
      dock={uiLocale.dock}
      onDockChange={(next) => uiLocale.setDock(next)}
    >
      <div
        class="fab-cite"
        {@attach citePopoverOpen && dismissable(() => (citePopoverOpen = false))}
      >
        <button
          class="fm-btn primary"
          onclick={() => (citePopoverOpen = !citePopoverOpen)}
          disabled={!editor}
          data-tip={m.editor_insert_citation()}
          aria-label={m.editor_insert_citation()}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 5v14M5 12h14" /></svg>
          <span class="fm-label">{m.editor_insert_citation()}</span>
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
        class="fm-btn"
        onclick={() => openRefForm(true)}
        data-tip={m.fab_new_ref_hint()}
        aria-label={m.fab_new_ref()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 4h11a2 2 0 0 1 2 2v14l-4-2-4 2V6H6z" /><path d="M6 4v16" /></svg>
        <span class="fm-label">{m.fab_new_ref()}</span>
      </button>
      <div class="fm-sep"></div>
      <HeadingMenu
        {editor}
        activeLevel={activeHeadingLevel}
        open={openMenu === "headings"}
        onToggle={() => (openMenu = openMenu === "headings" ? null : "headings")}
        onClose={() => (openMenu = null)}
      />
      <ListMenu
        {editor}
        {activeList}
        open={openMenu === "lists"}
        onToggle={() => (openMenu = openMenu === "lists" ? null : "lists")}
        onClose={() => (openMenu = null)}
      />
      <TableMenu
        {editor}
        {inTable}
        open={openMenu === "table"}
        onToggle={() => (openMenu = openMenu === "table" ? null : "table")}
        onClose={() => (openMenu = null)}
        onInsert={() => (tableDialogOpen = true)}
      />
      <button
        class="fm-btn"
        onclick={() => figureInput?.click()}
        disabled={!editor}
        data-tip={m.fab_figure()}
        aria-label={m.fab_figure()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="1" /><circle cx="8.5" cy="9" r="1.5" /><path d="M21 15l-5-5L5 20" /></svg>
        <span class="fm-label">{m.fab_figure()}</span>
      </button>
      <input
        bind:this={figureInput}
        type="file"
        accept="image/*"
        style="display: none"
        onchange={handleFigureFile}
      />
      <button
        class="fm-btn"
        onclick={() => (equationDialog = { mode: "insert" })}
        disabled={!editor || !canInsertEquation}
        data-tip={m.fab_equation()}
        aria-label={m.fab_equation()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 16l3 5 6-16h7" /></svg>
        <span class="fm-label">{m.fab_equation()}</span>
      </button>
      <FontMenu
        current={essay.settings.font}
        open={openMenu === "font"}
        onToggle={() => (openMenu = openMenu === "font" ? null : "font")}
        onClose={() => (openMenu = null)}
        onSelect={setFont}
      />
      <div class="fm-sep"></div>
      <button
        class="fm-btn"
        class:on={focusMode}
        onclick={() => (focusMode = !focusMode)}
        data-tip={m.fab_focus()}
        aria-label={m.fab_focus()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" /></svg>
        <span class="fm-label">{m.fab_focus()}</span>
      </button>
      <div class="fm-sep"></div>
      <button
        class="fm-btn"
        onclick={handleExport}
        disabled={!editor || exporting}
        data-tip={exporting ? m.editor_exporting() : m.editor_export()}
        aria-label={exporting ? m.editor_exporting() : m.editor_export()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12M8 11l4 4 4-4M5 21h14" /></svg>
        <span class="fm-label">{exporting ? m.editor_exporting() : m.editor_export()}</span>
      </button>
      <span class="fm-count">
        {m.fab_words({ count: words.toLocaleString(uiLocale.current) })}
      </span>
    </Toolbar>
  {/if}

  {#if bubble && !previewOpen}
    <div class="bubble show" style="left: {bubble.x}px; top: {bubble.y}px">
      <button class="bb" style="font-weight: 700" onclick={() => editor?.chain().focus().toggleBold().run()} aria-label={m.toolbar_bold()}>B</button>
      <button class="bb it" onclick={() => editor?.chain().focus().toggleItalic().run()} aria-label={m.toolbar_italic()}>I</button>
      <button class="bb un" onclick={() => editor?.chain().focus().toggleUnderline().run()} aria-label={m.toolbar_underline()}>U</button>
      <div class="bb-sep"></div>
      <button class="bb" onclick={() => editor?.chain().focus().toggleBlockquote().run()} aria-label={m.toolbar_blockquote()}>❝</button>
    </div>
  {/if}

  <footer class="statusbar" class:dim={focusMode}>
    <span>{words === 1 ? m.editor_words_one() : m.editor_words_many({ count: words })}</span>
    <span class="sep">·</span>
    <span>
      {previewOpen && pageCount > 0
        ? pageCount === 1 ? m.status_pages_one() : m.status_pages_many({ count: pageCount })
        : pagesEst === 1
        ? m.status_pages_one()
        : m.status_pages_many({ count: pagesEst })}
    </span>
    <span class="sep">·</span>
    <span>{m.status_refs({ count: citedCounts.size })}</span>
    <span class="sep">·</span>
    <button
      class="lang"
      title={m.doclang_switch()}
      aria-label={m.doclang_switch()}
      onclick={() => setLanguage(documentLanguage === "es" ? "en" : "es")}
    >
      {documentLanguage.toUpperCase()}
    </button>
    <span class="sep">·</span>
    <span>APA 7</span>
    {#if exportMessage}
      <span class="export-msg">{exportMessage}</span>
    {/if}
    <span class="saved" data-status={status}>
      <span class="dot"></span>
      {STATUS_LABELS[status]()}
    </span>
  </footer>
</div>

{#if refFormOpen}
  <ReferenceQuickForm
    language={documentLanguage}
    onSave={handleSaveReference}
    onImportBibtex={() => bibInput?.click()}
    onClose={() => {
      refFormOpen = false;
      citeOnSave = false;
    }}
  />
{/if}

<input
  bind:this={bibInput}
  type="file"
  accept=".bib"
  style="display: none"
  onchange={handleBibFile}
/>

{#if bibText !== null}
  <BibImportModal
    {bibText}
    onDone={() => {
      bibText = null;
      syncCitationEnv();
    }}
    onClose={() => (bibText = null)}
  />
{/if}

{#if bibError}
  <div class="bib-error-toast" role="alert">
    <span>{bibError}</span>
    <button
      class="bib-error-x"
      onclick={() => (bibError = null)}
      aria-label={m.common_close()}
    >×</button>
  </div>
{/if}

{#if titleFormOpen}
  <TitlePageForm
    titlePage={essay.titlePage}
    settings={essay.settings}
    validationMessage={titlePageValidationError}
    onSave={handleSaveTitlePage}
    onClose={() => (titleFormOpen = false)}
  />
{/if}

{#if tableDialogOpen}
  <TableInsertDialog
    onInsert={(rows, cols, header) => {
      tableDialogOpen = false;
      if (editor) insertApaTable(editor, rows, cols, header);
    }}
    onClose={() => (tableDialogOpen = false)}
  />
{/if}

{#if equationDialog}
  <EquationDialog
    initialLatex={equationDialog.mode === "edit" ? equationDialog.latex : ""}
    editing={equationDialog.mode === "edit"}
    onConfirm={(latex) => {
      if (editor) {
        if (equationDialog?.mode === "edit") {
          updateApaEquationAt(editor, equationDialog.pos, latex);
        } else {
          insertApaEquation(editor, latex);
        }
      }
      equationDialog = null;
    }}
    onClose={() => (equationDialog = null)}
  />
{/if}

<style>
  .app {
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--canvas);
    /* Anchos de los paneles laterales y alto del header. Viven acá (y no en
       .shell) porque la barra flotante es hermana del shell y necesita leerlos
       para anclarse al borde del canvas. --header-h es el alto de 40px del
       .titlebar, incluido su borde inferior de 1px (con box-sizing: border-box). */
    --outline-w: 248px;
    --refs-w: 312px;
    --header-h: 40px;
  }

  .app.no-outline { --outline-w: 0px; }
  .app.no-refs { --refs-w: 0px; }

  .app.no-outline.no-refs,
  .app.focus {
    --outline-w: 0px;
    --refs-w: 0px;
  }

  .titlebar {
    height: 40px;
    flex: 0 0 40px;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    padding: 0 12px;
    background: var(--chrome);
    border-bottom: 1px solid var(--border);
    user-select: none;
    -webkit-user-select: none;
  }

  .tb-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .traffic-space {
    width: 62px;
  }

  .tb-title {
    justify-self: center;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--muted);
    max-width: 46vw;
    overflow: hidden;
  }

  .tb-title b {
    color: var(--fg-2);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mark {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    border-radius: 5px;
    background: var(--accent);
    color: var(--accent-on);
    display: grid;
    place-items: center;
    font-family: var(--serif);
    font-weight: 700;
    font-size: 10px;
  }

  .tb-actions {
    justify-self: end;
    display: flex;
    gap: 4px;
  }

  .icon-btn {
    width: 30px;
    height: 30px;
    border: none;
    background: none;
    border-radius: var(--r-sm);
    display: grid;
    place-items: center;
    color: var(--muted);
    cursor: pointer;
    transition: background var(--fast) var(--ease), color var(--fast) var(--ease);
  }

  .icon-btn:hover {
    background: var(--hover);
    color: var(--fg);
  }

  .icon-btn.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .icon-btn :global(svg) {
    width: 16px;
    height: 16px;
  }

  .shell {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: var(--outline-w) 1fr var(--refs-w);
    transition: grid-template-columns 220ms var(--ease);
  }

  .outline {
    background: var(--chrome);
    border-right: 1px solid var(--border);
    overflow: hidden auto;
    padding: 20px 14px;
    transition: opacity 220ms var(--ease);
  }

  .no-outline .outline,
  .focus .outline {
    opacity: 0;
    pointer-events: none;
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }

  .panel-head h4 {
    margin: 0;
    font-size: 11px;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: 600;
  }

  .panel-head-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .btn-ghost {
    background: var(--surface);
    color: var(--fg-2);
    border-color: var(--border);
  }

  .btn-ghost:hover {
    border-color: var(--muted);
    color: var(--fg);
  }

  .btn-sm {
    height: 30px;
    padding: 0 10px;
    font-size: 12px;
  }

  .add-wrap {
    position: relative;
  }

  .mini {
    width: 22px;
    height: 22px;
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: 6px;
    display: grid;
    place-items: center;
    color: var(--muted);
    cursor: pointer;
  }

  .mini:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .menu {
    position: absolute;
    /* Anchored to the button's right edge so it opens into the column, not
       past it — the .outline column clips horizontal overflow. */
    right: 0;
    top: 115%;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    box-shadow: var(--elev-raised);
    display: flex;
    flex-direction: column;
    min-width: 170px;
    z-index: 20;
    overflow: hidden;
  }

  .menu button {
    border: none;
    background: none;
    font-size: 12.5px;
    text-align: left;
    padding: 8px 12px;
    cursor: pointer;
    color: var(--fg);
    white-space: nowrap;
  }

  .menu button:hover {
    background: var(--hover);
  }

  .out-item {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 7px 10px;
    border: none;
    background: none;
    border-radius: var(--r-sm);
    color: var(--fg-2);
    font-size: 13px;
    cursor: pointer;
    transition: background var(--fast) var(--ease), color var(--fast) var(--ease);
  }

  .out-item:hover {
    background: var(--hover);
  }

  .out-item.active {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }

  .out-item .n {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--muted);
    width: 16px;
    flex: 0 0 auto;
  }

  .out-item.active .n {
    color: var(--accent);
  }

  .out-item .wc {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--muted);
  }

  .out-item.sub {
    padding-left: 26px;
    font-size: 12.5px;
    color: var(--muted);
  }

  .out-progress {
    margin-top: 20px;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--surface);
  }

  .out-progress .pl {
    font-size: 11px;
    color: var(--muted);
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .out-progress .goal-btn {
    border: none;
    background: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .out-progress .goal-btn:hover {
    color: var(--fg);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .out-progress .goal-input {
    font: inherit;
    width: 6.5em;
    padding: 1px 5px;
    border: 1px solid var(--accent);
    border-radius: var(--r-sm);
    background: var(--bg);
    color: var(--fg);
    outline: none;
  }

  .bar {
    height: 6px;
    border-radius: var(--r-pill);
    background: var(--hover);
    overflow: hidden;
  }

  .bar > span {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: var(--r-pill);
    transition: width 220ms var(--ease);
  }

  .canvas {
    overflow-y: auto;
    scroll-behavior: smooth;
    min-width: 0;
  }

  /* The three stacked page-sheets (cover, body, references). */
  .sheet-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 28px;
    padding: 2.5rem 1.5rem 8rem;
  }

  .sheet-stack :global(.apa-editor) {
    padding: 0;
    width: 100%;
    min-height: 0;
  }

  .preview-host {
    padding-bottom: 4rem;
  }

  .refs {
    background: var(--chrome);
    border-left: 1px solid var(--border);
    overflow: hidden auto;
    padding: 20px 16px;
    transition: opacity 220ms var(--ease);
  }

  .no-refs .refs,
  .focus .refs {
    opacity: 0;
    pointer-events: none;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--r-sm);
    font-size: 12.5px;
    font-weight: 600;
    border: 1px solid transparent;
    cursor: pointer;
    white-space: nowrap;
  }

  .btn :global(svg) {
    width: 15px;
    height: 15px;
  }

  .btn-primary {
    background: var(--accent);
    color: var(--accent-on);
  }

  .btn-primary:hover {
    background: var(--accent-hover);
  }

  .search-ref {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    padding: 0 10px;
    height: 34px;
    margin: 14px 0;
  }

  .search-ref :global(svg) {
    width: 14px;
    height: 14px;
    color: var(--muted);
  }

  .search-ref input {
    border: 0;
    background: none;
    outline: none;
    width: 100%;
    font-size: 13px;
    color: var(--fg);
  }

  .ref-card {
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--surface);
    margin-bottom: 10px;
    transition: border-color var(--fast) var(--ease);
  }

  .ref-card:hover {
    border-color: color-mix(in oklab, var(--accent), var(--border) 55%);
  }

  .rtxt,
  .ref-card :global(.rtxt) {
    margin: 0 0 8px;
    font-family: var(--serif);
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--fg-2);
    overflow-wrap: anywhere;
  }

  .ref-foot {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .status {
    font-family: var(--mono);
    font-size: 9.5px;
    letter-spacing: 0.04em;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--accent);
  }

  .status.cited {
    color: var(--success);
  }

  .status.uncited {
    color: var(--muted);
  }

  .status .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  .ref-foot .del {
    margin-left: auto;
    border: none;
    background: none;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 5px;
  }

  .ref-foot .del:hover {
    color: var(--danger);
    background: color-mix(in oklab, var(--danger), transparent 90%);
  }

  .ref-foot .ins {
    border: none;
    background: none;
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  /* .fm-btn lives in the shared float-menu.css (imported above) so the
     standalone Heading/List menu components style their triggers identically. */

  .fm-sep {
    width: 1px;
    height: 22px;
    background: var(--border);
    margin: 0 3px;
  }

  .fm-count {
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--muted);
    padding: 0 12px 0 8px;
    white-space: nowrap;
  }

  .fab-cite {
    position: relative;
  }

  .bubble {
    position: fixed;
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 5px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-pill);
    box-shadow: var(--elev-raised);
    transform: translate(-50%, -100%);
  }

  .bubble.show {
    animation: pop 140ms var(--ease);
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: translate(-50%, calc(-100% + 6px));
    }
  }

  .bb {
    min-width: 30px;
    height: 30px;
    padding: 0 9px;
    border: none;
    background: none;
    border-radius: var(--r-pill);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 600;
    color: var(--fg-2);
    cursor: pointer;
    transition: background var(--fast) var(--ease);
  }

  .bb:hover {
    background: var(--hover);
  }

  .bb.it {
    font-style: italic;
    font-family: var(--serif);
  }

  .bb.un {
    text-decoration: underline;
  }

  .bb-sep {
    width: 1px;
    height: 18px;
    background: var(--border);
    margin: 0 4px;
  }

  .statusbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 16px;
    border-top: 1px solid var(--border);
    background: var(--chrome);
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
    transition: opacity 220ms var(--ease);
  }

  .statusbar.dim {
    opacity: 0.5;
  }

  .statusbar .sep {
    color: var(--border);
  }

  .statusbar .lang {
    border: none;
    background: none;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    padding: 0 2px;
  }

  .export-msg {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 32%;
  }

  .saved {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--success);
  }

  .saved[data-status="guardando"] {
    color: var(--muted);
  }

  .saved[data-status="error"] {
    color: var(--danger);
  }

  .saved .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  /* BibTeX file-read errors (too big / unreadable), mirroring the library. */
  .bib-error-toast {
    position: fixed;
    top: 52px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(90vw, 520px);
    padding: 10px 12px 10px 16px;
    border-radius: var(--r-md);
    background: var(--warn-soft);
    color: var(--warn-strong);
    border: 1px solid var(--warn);
    box-shadow: var(--elev-raised);
    font-size: 13px;
  }

  .bib-error-x {
    border: none;
    background: none;
    color: inherit;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 0 2px;
  }
</style>

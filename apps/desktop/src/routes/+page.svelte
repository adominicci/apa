<script lang="ts">
  import { onMount } from "svelte";
  import type { Editor as TiptapEditor } from "@tiptap/core";
  import type { DocLocale } from "@tesina/engine";
  import Editor from "$lib/components/Editor.svelte";
  import {
    addAbstract,
    addAppendix,
    addKeywordsLine,
    hasAbstract,
    removeAbstract,
  } from "$lib/editor/sections";
  import { readJson, writeJsonAtomic } from "$lib/persist/atomic";

  // M2.2: single-draft editor shell with sectioned document and per-document
  // language. The essay library and the three-column layout arrive next.
  const DRAFT_FILE = "essays/draft.json";

  interface DraftFile {
    schemaVersion: 1;
    settings?: { documentLanguage?: DocLocale };
    content: unknown;
  }

  let initialDoc = $state<unknown>(undefined);
  let documentLanguage = $state<DocLocale>("es");
  let ready = $state(false);
  let words = $state(0);
  let status = $state<"cargando" | "guardando" | "guardado" | "error">(
    "cargando",
  );
  let editor = $state<TiptapEditor | undefined>(undefined);
  let abstractPresent = $state(false);
  let lastDoc: unknown;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(async () => {
    try {
      const draft = await readJson<DraftFile>(DRAFT_FILE);
      if (draft) {
        initialDoc = draft.content;
        lastDoc = draft.content;
        if (draft.settings?.documentLanguage) {
          documentLanguage = draft.settings.documentLanguage;
        }
      }
      status = "guardado";
    } catch (err) {
      console.error("No se pudo cargar el borrador:", err);
      status = "error";
    } finally {
      ready = true;
    }
  });

  function scheduleSave() {
    status = "guardando";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const draft: DraftFile = {
          schemaVersion: 1,
          settings: { documentLanguage },
          content: lastDoc ?? editor?.getJSON(),
        };
        await writeJsonAtomic(DRAFT_FILE, draft);
        status = "guardado";
      } catch (err) {
        console.error("No se pudo guardar el borrador:", err);
        status = "error";
      }
    }, 500);
  }

  function handleUpdate(docJson: unknown, wordCount: number) {
    lastDoc = docJson;
    words = wordCount;
    if (editor) abstractPresent = hasAbstract(editor);
    scheduleSave();
  }

  function handleReady(instance: TiptapEditor) {
    editor = instance;
    abstractPresent = hasAbstract(instance);
  }

  function setLanguage(lang: DocLocale) {
    if (documentLanguage === lang) return;
    documentLanguage = lang;
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
</script>

<div class="shell">
  <header>
    <span class="brand">Tesina</span>
    <span class="doc">Borrador</span>
    <span class="spacer"></span>
    <div class="seg" role="group" aria-label="Idioma del documento">
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
      {abstractPresent ? "Quitar resumen" : "Añadir resumen"}
    </button>
    <button
      class="act"
      onclick={handleAddKeywords}
      disabled={!editor}
    >
      Palabras clave
    </button>
    <button class="act" onclick={handleAddAppendix} disabled={!editor}>
      Añadir apéndice
    </button>
  </header>
  <main>
    {#if ready}
      <Editor
        {initialDoc}
        {documentLanguage}
        onUpdate={handleUpdate}
        onReady={handleReady}
      />
    {/if}
  </main>
  <footer>
    <span>{words} {words === 1 ? "palabra" : "palabras"}</span>
    <span>Documento: {documentLanguage === "es" ? "Español" : "English"}</span>
    <span class="status" data-status={status}>{status}</span>
  </footer>
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: system-ui, sans-serif;
    background: #f2f1ee;
    color: #26251f;
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-bottom: 1px solid #e0deda;
    background: #faf9f7;
  }

  .brand {
    font-weight: 600;
    color: #2158d6;
  }

  .doc {
    font-size: 0.85rem;
    color: #6b6a64;
  }

  .spacer {
    flex: 1;
  }

  .seg {
    display: flex;
    border: 1px solid #d7d4cf;
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
    color: #6b6a64;
  }

  .seg button.active {
    background: #eaf1fe;
    color: #173a8c;
    font-weight: 600;
  }

  .act {
    border: 1px solid #d7d4cf;
    background: transparent;
    border-radius: 7px;
    font: inherit;
    font-size: 0.78rem;
    padding: 4px 10px;
    cursor: pointer;
    color: #44433e;
  }

  .act:hover:enabled {
    background: #eef0f4;
  }

  .act:disabled {
    opacity: 0.5;
    cursor: default;
  }

  main {
    flex: 1;
    overflow-y: auto;
  }

  footer {
    display: flex;
    gap: 16px;
    padding: 6px 16px;
    border-top: 1px solid #e0deda;
    background: #faf9f7;
    font-size: 0.8rem;
    color: #6b6a64;
  }

  .status {
    margin-left: auto;
  }

  .status[data-status="guardado"] {
    color: #2158d6;
  }

  .status[data-status="error"] {
    color: #b00020;
  }

  @media (prefers-color-scheme: dark) {
    .shell {
      background: #1c1c1a;
      color: #e8e6e1;
    }

    header,
    footer {
      background: #232320;
      border-color: #373632;
    }

    .doc,
    footer {
      color: #a3a19a;
    }

    .brand,
    .status[data-status="guardado"] {
      color: #7ea4f5;
    }

    .seg,
    .act {
      border-color: #45443f;
    }

    .seg button,
    .act {
      color: #c9c7c0;
    }

    .seg button.active {
      background: #1d2c50;
      color: #b7cdfa;
    }

    .act:hover:enabled {
      background: #2b2b28;
    }
  }
</style>

<script lang="ts">
  import { onMount } from "svelte";
  import Editor from "$lib/components/Editor.svelte";
  import { readJson, writeJsonAtomic } from "$lib/persist/atomic";

  // M2.1: single-draft editor shell. The essay library, sections, and the
  // full three-column layout arrive in the next M2 iterations.
  const DRAFT_FILE = "essays/draft.json";

  interface DraftFile {
    schemaVersion: 1;
    content: unknown;
  }

  let initialDoc = $state<unknown>(undefined);
  let ready = $state(false);
  let words = $state(0);
  let status = $state<"cargando" | "guardando" | "guardado" | "error">(
    "cargando",
  );
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(async () => {
    try {
      const draft = await readJson<DraftFile>(DRAFT_FILE);
      if (draft) initialDoc = draft.content;
      status = "guardado";
    } catch (err) {
      console.error("No se pudo cargar el borrador:", err);
      status = "error";
    } finally {
      ready = true;
    }
  });

  function handleUpdate(docJson: unknown, wordCount: number) {
    words = wordCount;
    status = "guardando";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const draft: DraftFile = { schemaVersion: 1, content: docJson };
        await writeJsonAtomic(DRAFT_FILE, draft);
        status = "guardado";
      } catch (err) {
        console.error("No se pudo guardar el borrador:", err);
        status = "error";
      }
    }, 500);
  }
</script>

<div class="shell">
  <header>
    <span class="brand">Tesina</span>
    <span class="doc">Borrador</span>
  </header>
  <main>
    {#if ready}
      <Editor {initialDoc} onUpdate={handleUpdate} />
    {/if}
  </main>
  <footer>
    <span>{words} {words === 1 ? "palabra" : "palabras"}</span>
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
    align-items: baseline;
    gap: 10px;
    padding: 10px 16px;
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
  }
</style>

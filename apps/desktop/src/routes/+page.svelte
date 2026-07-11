<script lang="ts">
  import { onMount } from "svelte";
  import { readJson, writeJsonAtomic } from "$lib/persist/atomic";

  // M0 smoke test: proves the fs plugin, the $APPDATA capability scope, and
  // atomic persistence across app relaunches. Replaced by the real essay
  // library screen in M2.
  const SMOKE_FILE = "smoke.json";

  let text = $state("");
  let status = $state<"cargando" | "guardando" | "guardado" | "error">(
    "cargando",
  );
  let loaded = $state(false);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(async () => {
    try {
      const data = await readJson<{ text: string }>(SMOKE_FILE);
      if (data) text = data.text;
      status = "guardado";
      loaded = true;
    } catch (err) {
      console.error("No se pudo leer el archivo de humo:", err);
      status = "error";
    }
  });

  function scheduleSave() {
    if (!loaded) return;
    status = "guardando";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await writeJsonAtomic(SMOKE_FILE, { text });
        status = "guardado";
      } catch (err) {
        console.error("No se pudo guardar el archivo de humo:", err);
        status = "error";
      }
    }, 400);
  }
</script>

<main>
  <h1>Tesina</h1>
  <p class="hint">
    Esqueleto M0 — lo que escribas aquí se guarda en
    <code>$APPDATA/smoke.json</code> y debe seguir presente al relanzar la app.
  </p>
  <textarea
    bind:value={text}
    oninput={scheduleSave}
    placeholder="Escribe algo y relanza la app…"
    rows="10"
  ></textarea>
  <p class="status" data-status={status}>{status}</p>
</main>

<style>
  main {
    max-width: 40rem;
    margin: 3rem auto;
    padding: 0 1.5rem;
    font-family: system-ui, sans-serif;
  }

  h1 {
    font-size: 1.5rem;
  }

  .hint {
    color: #555;
    font-size: 0.9rem;
  }

  textarea {
    width: 100%;
    font: inherit;
    padding: 0.75rem;
    border: 1px solid #ccc;
    border-radius: 6px;
    resize: vertical;
    box-sizing: border-box;
  }

  .status {
    font-size: 0.85rem;
    color: #777;
  }

  .status[data-status="error"] {
    color: #b00020;
  }

  @media (prefers-color-scheme: dark) {
    .hint,
    .status {
      color: #aaa;
    }

    textarea {
      background: #1e1e1e;
      color: #eee;
      border-color: #444;
    }
  }
</style>

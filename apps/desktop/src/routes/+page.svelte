<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { DocLocale } from "@tesina/engine";
  import type { Essay } from "$lib/model/essay";
  import EssayHome from "$lib/components/EssayHome.svelte";
  import EditorScreen from "$lib/components/EditorScreen.svelte";
  import LibraryScreen from "$lib/components/LibraryScreen.svelte";
  import { essays } from "$lib/state/essays.svelte";
  import { library } from "$lib/state/library.svelte";
  import { missingCitedRefs } from "$lib/model/reconcile";
  import { uiLocale } from "$lib/state/uiLocale.svelte";
  import { updater } from "$lib/state/updater.svelte";
  import {
    LatestLaunch,
    type LaunchValue,
  } from "$lib/state/latestLaunch";
  import type { RecoveryOutcome } from "$lib/persist/importJournal";
  import { m } from "$lib/paraglide/messages";

  // Router-less shell (plan §app shell): a desktop app, not a website.
  let currentLaunch = $state<LaunchValue<Essay> | null>(null);
  let currentEssayKey = $state<string | null>(null);
  let libraryOpen = $state(false);
  let booted = $state(false);
  const latestLaunch = new LatestLaunch();

  // ── Startup import recovery (design §13, task 6.6) ──────────────
  // Runs BEFORE the essay index and library are loaded, so an interrupted
  // Merge is resumed or rolled back before anything becomes interactive.
  let recoveryNotice = $state<"resumed" | "rolled-back" | null>(null);
  let recoveryRequired = $state<RecoveryOutcome[] | null>(null);

  async function runRecoveryPhase(): Promise<void> {
    if (
      typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)
    ) {
      return; // browser dev: no app data to recover
    }
    const { runStartupRecovery } = await import("$lib/persist/portableRuntime");
    const outcomes = await runStartupRecovery();
    const required = outcomes.filter((o) => o.kind === "recovery-required");
    if (required.length > 0) {
      recoveryRequired = outcomes;
      return;
    }
    if (outcomes.some((o) => o.kind === "resumed")) {
      recoveryNotice = "resumed";
    } else if (outcomes.some((o) => o.kind === "rolled-back")) {
      recoveryNotice = "rolled-back";
    }
  }

  async function retryRecovery(): Promise<void> {
    recoveryRequired = null;
    try {
      await runRecoveryPhase();
    } catch (err) {
      console.error("No se pudo reintentar la recuperación:", err);
    }
    if (recoveryRequired === null) {
      await Promise.all([library.reload(), essays.loadIndex()]);
    }
  }

  async function exportDiagnostic(): Promise<void> {
    try {
      const [{ buildRecoveryDiagnostic }, { save }, { writeExternalText }] =
        await Promise.all([
          import("$lib/persist/portableRuntime"),
          import("@tauri-apps/plugin-dialog"),
          import("$lib/persist/appDataFs"),
        ]);
      const destination = await save({
        defaultPath: "tesina-recovery-diagnostic.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (destination === null) return;
      await writeExternalText(
        destination,
        await buildRecoveryDiagnostic(recoveryRequired ?? []),
      );
    } catch (err) {
      console.error("No se pudo exportar el diagnóstico:", err);
    }
  }

  let stopBackup: (() => void) | null = null;
  onDestroy(() => {
    stopBackup?.();
    stopBackup = null;
  });

  onMount(async () => {
    try {
      await runRecoveryPhase();
    } catch (err) {
      // Recovery machinery itself failing must never block writing.
      console.error("No se pudo ejecutar la recuperación inicial:", err);
    }
    await Promise.all([
      library.load(),
      essays.loadIndex(),
      uiLocale.load(),
    ]);
    booted = true;
    // Backup coordinator (task 10.6): starts only after recovery and the
    // normal data loads, listens to persistence activity, and evaluates
    // once for content that changed while Tesina was closed.
    if ("__TAURI_INTERNALS__" in window) {
      try {
        const { backupStore } = await import("$lib/persist/backupRuntime");
        const store = backupStore();
        store.start();
        store.scheduleEligibilityCheck();
        stopBackup = () => store.stop();
      } catch (err) {
        // Backup machinery failing must never block writing.
        console.error("No se pudo iniciar el coordinador de respaldo:", err);
      }
    }
    // Non-blocking: never delay first paint on the network check.
    void updater.check();
  });

  function applyLaunch(launch: LaunchValue<Essay>) {
    // Restore any cited reference that was deleted from the library while this
    // essay was closed — before the editor mounts and builds its citationEnv.
    library.restore(
      missingCitedRefs(
        launch.value.content,
        launch.value.referencesSnapshot,
        new Set(library.byId().keys()),
      ),
    );
    currentEssayKey = launch.value.id;
    currentLaunch = launch;
  }

  async function createEssay(language: DocLocale) {
    try {
      await latestLaunch.run(
        true,
        () => essays.create(language),
        applyLaunch,
        (created) => essays.remove(created.id),
      );
    } catch (err) {
      console.error("No se pudo crear o limpiar el ensayo:", err);
    }
  }

  async function openEssay(id: string) {
    await latestLaunch.run(false, () => essays.load(id), applyLaunch);
  }

  function consumeLaunch() {
    const launch = currentLaunch;
    if (!launch?.newlyCreated) return;
    launch.newlyCreated = false;
  }

  function goHome() {
    latestLaunch.invalidate();
    currentLaunch = null;
    currentEssayKey = null;
    essays.loadIndex();
  }

  function openLibrary() {
    latestLaunch.invalidate();
    consumeLaunch();
    libraryOpen = true;
  }
</script>

{#if recoveryRequired !== null}
  <div
    class="recovery"
    role="alertdialog"
    aria-labelledby="recovery-title"
    aria-describedby="recovery-body"
  >
    <div class="recovery-card">
      <h1 id="recovery-title">{m.recovery_required_title()}</h1>
      <p id="recovery-body">{m.recovery_required_body()}</p>
      <p>{m.recovery_quit_hint()}</p>
      <div class="recovery-actions">
        <button class="btn btn-secondary" onclick={exportDiagnostic}>
          {m.recovery_export_diagnostic()}
        </button>
        <button
          class="btn btn-primary"
          onclick={() => {
            void retryRecovery();
          }}
        >
          {m.recovery_retry()}
        </button>
      </div>
    </div>
  </div>
{:else if !booted}
  <div class="boot">Cargando Tesina…</div>
{:else}
  {#if recoveryNotice !== null}
    <p class="recovery-notice" role="status" aria-live="polite">
      {recoveryNotice === "resumed"
        ? m.recovery_resumed()
        : m.recovery_rolled_back()}
      <button
        class="notice-dismiss"
        onclick={() => (recoveryNotice = null)}
      >
        {m.recovery_dismiss()}
      </button>
    </p>
  {/if}
  {#key uiLocale.current}
    {#if libraryOpen}
      <LibraryScreen onBack={() => (libraryOpen = false)} />
    {:else if currentLaunch}
      {#key currentEssayKey}
        <EditorScreen
          essay={currentLaunch.value}
          newlyCreated={currentLaunch.newlyCreated}
          onLaunchConsumed={consumeLaunch}
          onBack={goHome}
          onOpenLibrary={openLibrary}
        />
      {/key}
    {:else}
      <EssayHome
        onCreate={createEssay}
        onOpen={openEssay}
        onOpenLibrary={openLibrary}
      />
    {/if}
  {/key}
{/if}

<style>
  .boot {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    font-family: var(--font);
    color: var(--muted);
  }

  .recovery {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    background: var(--canvas);
    font-family: var(--font);
  }

  .recovery-card {
    max-inline-size: 32rem;
    padding: 2rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .recovery-card h1 {
    font-size: 1.25rem;
    margin: 0;
  }

  .recovery-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
  }

  .recovery-notice {
    margin: 0;
    padding: 0.5rem 1rem;
    background: var(--panel, #f4f1ea);
    font-family: var(--font);
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .notice-dismiss {
    border: none;
    background: none;
    cursor: pointer;
    text-decoration: underline;
    font: inherit;
    color: inherit;
  }
</style>

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { DocLocale } from "@tesina/engine";
  import type { Essay } from "$lib/model/essay";
  import EssayHome from "$lib/components/EssayHome.svelte";
  import EditorScreen from "$lib/components/EditorScreen.svelte";
  import LibraryScreen from "$lib/components/LibraryScreen.svelte";
  import RecoveryRequiredActions from "$lib/components/RecoveryRequiredActions.svelte";
  import { recoveryNoticeFromOutcomes } from "$lib/components/recoveryNotice";
  import { essays } from "$lib/state/essays.svelte";
  import { library } from "$lib/state/library.svelte";
  import { missingCitedRefs } from "$lib/model/reconcile";
  import { uiLocale } from "$lib/state/uiLocale.svelte";
  import { updater } from "$lib/state/updater.svelte";
  import { runStartupSafetyPhase } from "$lib/state/startup";
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
  const packagedPortableSmoke =
    import.meta.env.VITE_TESINA_PACKAGED_PORTABLE_SMOKE === "1";
  const packagedBackupSmoke =
    import.meta.env.VITE_TESINA_PACKAGED_BACKUP_SMOKE === "1";

  // ── Startup import recovery (design §13, task 6.6) ──────────────
  // Runs BEFORE the essay index and library are loaded, so an interrupted
  // Merge is resumed or rolled back before anything becomes interactive.
  let recoveryNotice = $state<"resumed" | "rolled-back" | null>(null);
  let recoveryRequired = $state<RecoveryOutcome[] | null>(null);
  let recoveryInProgress = $state(false);

  async function runRecoveryPhase(): Promise<void> {
    if (
      typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)
    ) {
      return; // browser dev: no app data to recover
    }
    recoveryInProgress = true;
    try {
      const { runStartupRecovery } = await import(
        "$lib/persist/portableRuntime"
      );
      const outcomes = await runStartupRecovery();
      const required = outcomes.filter((o) => o.kind === "recovery-required");
      if (required.length > 0) {
        recoveryRequired = outcomes;
        return;
      }
      recoveryNotice = recoveryNoticeFromOutcomes(outcomes);
    } finally {
      recoveryInProgress = false;
    }
  }

  let stopBackup: (() => void) | null = null;
  let stopUpdateChecks: (() => void) | null = null;
  onDestroy(() => {
    stopBackup?.();
    stopBackup = null;
    stopUpdateChecks?.();
    stopUpdateChecks = null;
  });

  async function finishStartup(reload = false): Promise<void> {
    await Promise.all([
      reload ? library.reload() : library.load(),
      essays.loadIndex(),
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
    // Non-blocking: never delay first paint on the network check. The timer
    // keeps re-checking while the app stays open (T3 Code cadence).
    void updater.check();
    stopUpdateChecks ??= updater.startPeriodicChecks();
  }

  async function finishRecoveredStartup(
    outcomes: RecoveryOutcome[],
  ): Promise<void> {
    await finishStartup(true);
    recoveryNotice = recoveryNoticeFromOutcomes(outcomes);
    recoveryRequired = null;
  }

  onMount(async () => {
    if (packagedBackupSmoke) {
      const { runPackagedBackupSmoke } = await import(
        "$lib/persist/packagedBackupSmoke"
      );
      await runPackagedBackupSmoke();
      return;
    }
    if (packagedPortableSmoke) {
      const { runPackagedPortableSmoke } = await import(
        "$lib/persist/packagedPortableSmoke"
      );
      await runPackagedPortableSmoke();
      return;
    }
    try {
      await runStartupSafetyPhase({
        loadUiSettings: () => uiLocale.load(),
        runRecovery: runRecoveryPhase,
      });
    } catch (err) {
      // Fail closed: an unexpected recovery failure means unfinished-import
      // state may exist that was neither resumed nor rolled back, so the
      // editable library must not load (amended library-merge-import spec).
      console.error("No se pudo ejecutar la recuperación inicial:", err);
      recoveryRequired = [{
        kind: "recovery-required",
        transactionId: "(startup)",
        reason: err instanceof Error ? err.message : String(err),
      }];
      return;
    }
    if (recoveryRequired !== null) return;
    await finishStartup();
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
      <div id="recovery-body">
        <RecoveryRequiredActions
          outcomes={recoveryRequired}
          onRecovered={finishRecoveredStartup}
        />
      </div>
    </div>
  </div>
{:else if !booted}
  <div
    class="boot"
    role={recoveryInProgress ? "status" : undefined}
    aria-live={recoveryInProgress ? "polite" : undefined}
  >
    {recoveryInProgress ? m.recovery_in_progress() : m.home_loading()}
  </div>
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
    padding: var(--sp-7);
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }

  .recovery-card h1 {
    font-size: var(--t-h2);
    margin: 0;
  }

  .recovery-notice {
    margin: 0;
    padding: var(--sp-2) var(--sp-4);
    background: var(--panel);
    font-family: var(--font);
    display: flex;
    align-items: center;
    gap: var(--sp-4);
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

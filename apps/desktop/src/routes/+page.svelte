<script lang="ts">
  import { onMount } from "svelte";
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

  // Router-less shell (plan §app shell): a desktop app, not a website.
  let currentLaunch = $state<LaunchValue<Essay> | null>(null);
  let currentEssayKey = $state<string | null>(null);
  let libraryOpen = $state(false);
  let booted = $state(false);
  const latestLaunch = new LatestLaunch();

  onMount(async () => {
    await Promise.all([
      library.load(),
      essays.loadIndex(),
      uiLocale.load(),
    ]);
    booted = true;
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
    await latestLaunch.run(
      true,
      () => essays.create(language),
      applyLaunch,
    );
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

{#if !booted}
  <div class="boot">Cargando Tesina…</div>
{:else}
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
</style>

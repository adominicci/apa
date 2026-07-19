<script lang="ts">
  import { onMount } from "svelte";
  import type { Essay } from "$lib/model/essay";
  import EssayHome from "$lib/components/EssayHome.svelte";
  import EditorScreen from "$lib/components/EditorScreen.svelte";
  import LibraryScreen from "$lib/components/LibraryScreen.svelte";
  import { essays } from "$lib/state/essays.svelte";
  import { library } from "$lib/state/library.svelte";
  import { missingCitedRefs } from "$lib/model/reconcile";
  import { uiLocale } from "$lib/state/uiLocale.svelte";
  import { updater } from "$lib/state/updater.svelte";

  // Router-less shell (plan §app shell): a desktop app, not a website.
  let currentEssay = $state<Essay | null>(null);
  let libraryOpen = $state(false);
  let booted = $state(false);

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

  async function openEssay(id: string) {
    const essay = await essays.load(id);
    if (!essay) return;
    // Restore any cited reference that was deleted from the library while this
    // essay was closed — before the editor mounts and builds its citationEnv.
    library.restore(
      missingCitedRefs(
        essay.content,
        essay.referencesSnapshot,
        new Set(library.byId().keys()),
      ),
    );
    currentEssay = essay;
  }

  function goHome() {
    currentEssay = null;
    essays.loadIndex();
  }
</script>

{#if !booted}
  <div class="boot">Cargando Tesina…</div>
{:else}
  {#key uiLocale.current}
    {#if libraryOpen}
      <LibraryScreen onBack={() => (libraryOpen = false)} />
    {:else if currentEssay}
      {#key currentEssay.id}
        <EditorScreen
          essay={currentEssay}
          onBack={goHome}
          onOpenLibrary={() => (libraryOpen = true)}
        />
      {/key}
    {:else}
      <EssayHome
        onOpen={openEssay}
        onOpenLibrary={() => (libraryOpen = true)}
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

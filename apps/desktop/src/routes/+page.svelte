<script lang="ts">
  import { onMount } from "svelte";
  import type { Essay } from "$lib/model/essay";
  import EssayHome from "$lib/components/EssayHome.svelte";
  import EditorScreen from "$lib/components/EditorScreen.svelte";
  import { essays } from "$lib/state/essays.svelte";
  import { library } from "$lib/state/library.svelte";
  import { uiLocale } from "$lib/state/uiLocale.svelte";

  // Router-less shell (plan §app shell): a desktop app, not a website.
  let currentEssay = $state<Essay | null>(null);
  let booted = $state(false);

  onMount(async () => {
    await Promise.all([
      library.load(),
      essays.loadIndex(),
      uiLocale.load(),
    ]);
    booted = true;
  });

  async function openEssay(id: string) {
    const essay = await essays.load(id);
    if (essay) currentEssay = essay;
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
    {#if currentEssay}
      {#key currentEssay.id}
        <EditorScreen essay={currentEssay} onBack={goHome} />
      {/key}
    {:else}
      <EssayHome onOpen={openEssay} />
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

<script lang="ts">
  import { onMount } from "svelte";
  import type { Component } from "svelte";

  const packagedSpellingProof =
    import.meta.env.VITE_TESINA_PACKAGED_SPELLING_PROOF === "1";
  let AppPage = $state<Component | null>(null);

  onMount(() => {
    if (packagedSpellingProof) {
      void import("$lib/spelling/packagedProof").then((module) =>
        module.runPackagedSpellingProof()
      );
      return;
    }
    void import("$lib/components/AppPage.svelte").then((module) => {
      AppPage = module.default;
    });
  });
</script>

{#if AppPage}
  <AppPage />
{/if}

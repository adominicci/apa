<script lang="ts">
  import { onMount } from "svelte";
  import type { Component, Snippet } from "svelte";

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();
  const packagedSpellingProof =
    import.meta.env.VITE_TESINA_PACKAGED_SPELLING_PROOF === "1";
  let AppLayout = $state<Component<Props> | null>(null);

  onMount(() => {
    if (packagedSpellingProof) return;
    void import("$lib/components/AppLayout.svelte").then((module) => {
      AppLayout = module.default;
    });
  });
</script>

{#if packagedSpellingProof}
  {@render children()}
{:else if AppLayout}
  <AppLayout>{@render children()}</AppLayout>
{/if}

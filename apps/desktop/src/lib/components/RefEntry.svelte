<script lang="ts">
  import {
    type DocLocale,
    formatReferenceEntry,
    type Reference,
  } from "@tesina/engine";

  interface Props {
    reference: Reference;
    language: DocLocale;
  }

  let { reference, language }: Props = $props();

  const runs = $derived(formatReferenceEntry(reference, language));
</script>

<p class="rtxt">
  {#each runs as run, i (i)}
    {#if run.italic}<em>{run.text}</em>{:else}{run.text}{/if}
  {/each}
</p>

<style>
  .rtxt {
    margin: 0 0 8px;
    font-family: var(--serif);
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--fg-2);
    overflow-wrap: anywhere;
  }
</style>

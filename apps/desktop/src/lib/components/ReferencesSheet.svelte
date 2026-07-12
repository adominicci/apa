<script lang="ts">
  import {
    buildReferenceList,
    type DocLocale,
    getTerms,
    type Reference,
  } from "@tesina/engine";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    references: Reference[];
    language: DocLocale;
  }

  let { references, language }: Props = $props();

  const heading = $derived(getTerms(language).headings.references);
  const entries = $derived(
    references.length > 0 ? buildReferenceList(references, language).entries : [],
  );
</script>

<div class="apa-editor references-sheet" data-doclang={language}>
  <article class="paper-sheet references">
    <h1 class="ref-head">{heading}</h1>
    {#if entries.length === 0}
      <p class="ref-empty">{m.refsheet_empty()}</p>
    {:else}
      {#each entries as entry (entry.refId)}
        <p class="ref-entry">
          {#each entry.runs as run, i (i)}
            {#if run.italic}<em>{run.text}</em>{:else}{run.text}{/if}
          {/each}
        </p>
      {/each}
    {/if}
  </article>
</div>

<style>
  .references-sheet {
    padding: 0;
  }

  .ref-head {
    text-align: center;
    font-family: var(--serif);
    font-size: 12pt;
    font-weight: 700;
    margin: 0 0 1em;
  }

  .ref-entry {
    font-family: var(--serif);
    font-size: 12pt;
    line-height: 2;
    margin: 0;
    padding-left: 0.5in;
    text-indent: -0.5in;
  }

  .ref-empty {
    text-align: center;
    color: var(--muted);
    font-size: 13px;
    margin: 2em 0;
  }
</style>

<script lang="ts">
  import CoverSheet, {
    type CoverPatch,
  } from "./CoverSheet.svelte";
  import type { TitlePage } from "$lib/model/essay";

  let titlePage = $state<TitlePage>({
    title: "Reading Habits",
    authors: ["Ana Ruiz"],
    affiliations: ["University of Puerto Rico"],
  });

  function handleCoverChange(patch: CoverPatch) {
    titlePage = { ...titlePage, ...patch };
  }
</script>

<CoverSheet
  {titlePage}
  language="en"
  onChange={handleCoverChange}
  onOpenForm={() => {}}
/>

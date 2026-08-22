<script lang="ts">
  import { onMount } from "svelte";
  import { runPackagedSpellingProof } from "$lib/spelling/packagedProof";

  onMount(() => {
    void runPackagedSpellingProof();
  });
</script>

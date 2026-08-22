<script lang="ts">
  import Layout from "./AppLayout.svelte";
  import LayoutReleaseNotesConsumerHarness from "./LayoutReleaseNotesConsumerHarness.test.svelte";
</script>

<Layout>
  <div data-layout-child>Paper list</div>
  <LayoutReleaseNotesConsumerHarness />
</Layout>

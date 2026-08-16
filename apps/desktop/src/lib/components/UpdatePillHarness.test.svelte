<script lang="ts">
  import { untrack } from "svelte";
  import UpdatePill from "$lib/components/UpdatePill.svelte";
  import { bundledReleaseNotes } from "$lib/update/bundledReleaseNotes";
  import {
    createReleaseNotesController,
    provideReleaseNotesController,
    type ReleaseNotesController,
  } from "$lib/update/releaseNotesController.svelte";

  interface Props {
    releaseNotesController?: ReleaseNotesController;
  }

  let { releaseNotesController }: Props = $props();

  provideReleaseNotesController(
    untrack(() => releaseNotesController) ?? createReleaseNotesController({
      bundled: bundledReleaseNotes,
      getRuntimeVersion: () => Promise.resolve(bundledReleaseNotes.version),
      getStorage: () => null,
      unavailableBody: () => "Release notes unavailable.",
    }),
  );
</script>

<UpdatePill />

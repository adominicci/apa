<script lang="ts">
  import type { DocLocale } from "@tesina/engine";
  import { untrack } from "svelte";
  import EssayHome from "$lib/components/EssayHome.svelte";
  import ReleaseNotesModal from "$lib/components/ReleaseNotesModal.svelte";
  import { bundledReleaseNotes } from "$lib/update/bundledReleaseNotes";
  import {
    createReleaseNotesController,
    provideReleaseNotesController,
    type ReleaseNotesController,
  } from "$lib/update/releaseNotesController.svelte";

  interface Props {
    onCreate: (language: DocLocale) => void;
    onOpen: (id: string) => void;
    onOpenLibrary: () => void;
    releaseNotesController?: ReleaseNotesController;
  }

  let {
    onCreate,
    onOpen,
    onOpenLibrary,
    releaseNotesController,
  }: Props = $props();

  const releaseNotes = provideReleaseNotesController(
    untrack(() => releaseNotesController) ?? createReleaseNotesController({
      bundled: bundledReleaseNotes,
      getRuntimeVersion: () => Promise.resolve(bundledReleaseNotes.version),
      getStorage: () => null,
      unavailableBody: () => "Release notes unavailable.",
    }),
  );
</script>

<EssayHome {onCreate} {onOpen} {onOpenLibrary} />

{#if releaseNotes.presentation}
  <ReleaseNotesModal
    version={releaseNotes.presentation.version}
    body={releaseNotes.presentation.body}
    onClose={() => releaseNotes.dismiss()}
  />
{/if}

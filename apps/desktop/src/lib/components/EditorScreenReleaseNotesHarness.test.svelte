<script lang="ts">
  import { untrack } from "svelte";
  import type { Essay } from "$lib/model/essay";
  import EditorScreen from "$lib/components/EditorScreen.svelte";
  import ReleaseNotesModal from "$lib/components/ReleaseNotesModal.svelte";
  import { bundledReleaseNotes } from "$lib/update/bundledReleaseNotes";
  import {
    createReleaseNotesController,
    provideReleaseNotesController,
    type ReleaseNotesController,
  } from "$lib/update/releaseNotesController.svelte";

  interface Props {
    essay: Essay;
    newlyCreated: boolean;
    onLaunchConsumed: () => void;
    onBack: () => void;
    onOpenLibrary: () => void;
    releaseNotesController?: ReleaseNotesController;
  }

  let {
    essay,
    newlyCreated,
    onLaunchConsumed,
    onBack,
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

<EditorScreen
  {essay}
  {newlyCreated}
  {onLaunchConsumed}
  {onBack}
  {onOpenLibrary}
/>

{#if releaseNotes.presentation}
  <ReleaseNotesModal
    version={releaseNotes.presentation.version}
    body={releaseNotes.presentation.body}
    onClose={() => releaseNotes.dismiss()}
  />
{/if}

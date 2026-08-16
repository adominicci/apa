<script lang="ts">
  import UpdatePill from "$lib/components/UpdatePill.svelte";
  import { useReleaseNotesController } from "$lib/update/releaseNotesController.svelte";

  const releaseNotes = useReleaseNotesController();
</script>

<button data-open-installed-notes onclick={() => releaseNotes.openInstalledNotes()}>
  v{releaseNotes.installedVersion}
</button>
<UpdatePill />

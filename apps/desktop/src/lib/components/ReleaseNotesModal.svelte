<script lang="ts">
  import Modal from "$lib/components/Modal.svelte";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    version: string;
    body: string;
    onClose: () => void;
  }

  let { version, body, onClose }: Props = $props();
</script>

<Modal
  title={m.release_notes_title()}
  subtitle={m.release_notes_version({ version })}
  {onClose}
>
  <p class="release-notes">{body}</p>

  {#snippet footer()}
    <button class="btn btn-primary" onclick={onClose}>
      {m.release_notes_done()}
    </button>
  {/snippet}
</Modal>

<style>
  .release-notes {
    margin: 0;
    color: var(--fg-2);
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>

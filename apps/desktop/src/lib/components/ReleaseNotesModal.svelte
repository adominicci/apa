<script lang="ts">
  import Modal from "$lib/components/Modal.svelte";
  import MarkdownContent from "$lib/components/MarkdownContent.svelte";
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
  <MarkdownContent source={body} />

  {#snippet footer()}
    <button class="btn btn-primary" onclick={onClose}>
      {m.release_notes_done()}
    </button>
  {/snippet}
</Modal>

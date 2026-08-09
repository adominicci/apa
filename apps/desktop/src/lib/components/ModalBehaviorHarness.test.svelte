<script lang="ts">
  import Modal from "./Modal.svelte";
  import ReleaseNotesModal from "./ReleaseNotesModal.svelte";

  interface Props {
    mode?: "release" | "protected";
    onClosed?: () => void;
  }

  let { mode = "release", onClosed = () => {} }: Props = $props();
  let open = $state(false);
  const releaseBody = "# Changed\n\n- Formatted item\n- Another item";

  function close() {
    open = false;
    onClosed();
  }
</script>

<button class="exact-opener" onclick={() => (open = true)}>Open notes</button>
<button class="ordinary-background">Background action</button>
<div class="preexisting-background" inert aria-hidden="false">Existing state</div>

{#if open}
  {#if mode === "release"}
    <ReleaseNotesModal
      version="0.1.3"
      body={releaseBody}
      onClose={close}
    />
  {:else}
    <Modal
      title="Protected form"
      dismissOnOverlay={false}
      onClose={close}
    >
      <input aria-label="Protected value" value="draft" />
    </Modal>
  {/if}
{/if}

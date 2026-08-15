<script lang="ts">
  import { m } from "$lib/paraglide/messages";
  import Modal from "$lib/components/Modal.svelte";
  import { localizeTitlePageValidation } from "$lib/components/titlePageValidationMessages";
  import type { StudentTitlePageWarning } from "$lib/model/titlePageValidation";

  interface Props {
    warnings: readonly StudentTitlePageWarning[];
    onExportAnyway: () => void;
    onFixTitlePage: () => void;
    onClose: () => void;
  }

  let { warnings, onExportAnyway, onFixTitlePage, onClose }: Props = $props();
</script>

<!-- Advisory, never a gate: the primary action exports as asked, and fixing
     the title page is the secondary path for whoever wants APA to be exact. -->
<Modal title={m.export_warn_title()} {onClose}>
  <div class="status-panel" data-tone="warn">
    <span class="status-dot" aria-hidden="true"></span>
    <div class="status-body">
      <span class="status-title">{m.titlepage_warn_heading()}</span>
      <span class="status-meta">{m.export_warn_meta()}</span>
    </div>
  </div>

  <ul class="warn-list">
    {#each warnings as warning (warning.issue)}
      <li>{localizeTitlePageValidation(warning.messageKey)}</li>
    {/each}
  </ul>

  {#snippet footer()}
    <button class="btn btn-ghost" onclick={onFixTitlePage}>
      {m.export_warn_fix()}
    </button>
    <button class="btn btn-primary" onclick={onExportAnyway}>
      {m.export_warn_anyway()}
    </button>
  {/snippet}
</Modal>

<style>
  .warn-list {
    margin: 0;
    padding-left: var(--sp-5);
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    font-size: var(--t-small);
    line-height: var(--lh-snug);
    color: var(--fg-2);
  }
</style>

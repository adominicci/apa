<script lang="ts">
  import { m } from "$lib/paraglide/messages";
  import Modal from "$lib/components/Modal.svelte";
  import { localizeTitlePageValidation } from "$lib/components/titlePageValidationMessages";
  import { localizeApaCheck } from "$lib/components/apaCheckMessages";
  import type { StudentTitlePageWarning } from "$lib/model/titlePageValidation";
  import type { PositionedApaIssue } from "$lib/editor/apaCheck";

  interface Props {
    warnings: readonly StudentTitlePageWarning[];
    /** Live APA structure issues frozen at export time; advisory like the
       title-page warnings. */
    apaIssues?: readonly PositionedApaIssue[];
    onExportAnyway: () => void;
    onFixTitlePage: () => void;
    onClose: () => void;
  }

  let {
    warnings,
    apaIssues = [],
    onExportAnyway,
    onFixTitlePage,
    onClose,
  }: Props = $props();
</script>

<!-- Advisory, never a gate: the primary action exports as asked, and fixing
     the title page is the secondary path for whoever wants APA to be exact. -->
<Modal
  title={warnings.length > 0
    ? m.export_warn_title()
    : m.apa_check_warn_heading()}
  {onClose}
>
  <div class="status-panel" data-tone="warn">
    <span class="status-dot" aria-hidden="true"></span>
    <div class="status-body">
      <span class="status-title">
        {warnings.length > 0
          ? m.titlepage_warn_heading()
          : m.apa_check_warn_heading()}
      </span>
      <span class="status-meta">{m.export_warn_meta()}</span>
    </div>
  </div>

  {#if warnings.length > 0}
    <ul class="warn-list">
      {#each warnings as warning (warning.issue)}
        <li>{localizeTitlePageValidation(warning.messageKey)}</li>
      {/each}
    </ul>
  {/if}

  {#if apaIssues.length > 0}
    {#if warnings.length > 0}
      <p class="warn-subhead">{m.apa_check_warn_heading()}</p>
    {/if}
    <ul class="warn-list">
      {#each apaIssues as issue (`${issue.rule}:${issue.from}`)}
        <li>{localizeApaCheck(issue)}</li>
      {/each}
    </ul>
  {/if}

  {#snippet footer()}
    {#if warnings.length > 0}
      <button class="btn btn-ghost" onclick={onFixTitlePage}>
        {m.export_warn_fix()}
      </button>
    {/if}
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

  .warn-subhead {
    margin: var(--sp-2) 0 0;
    font-size: var(--t-small);
    font-weight: var(--w-medium);
    color: var(--fg);
  }
</style>

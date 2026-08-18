<script lang="ts">
  import { onMount } from "svelte";
  import Modal from "$lib/components/Modal.svelte";
  import { m } from "$lib/paraglide/messages";
  import type {
    ImportApplyResult,
    ImportPreviewResult,
  } from "$lib/persist/importFlow";
  import {
    archiveErrorCode,
    describeArchiveError,
  } from "./archiveErrorMessage.ts";

  /**
   * Shared Merge modal (design §11): used by Import library and Restore.
   * States: validating → invalid | preview → applying → success |
   * replan-needed (re-confirmation) | failure. Version one exposes Merge
   * and Cancel only — there is no replace-library operation.
   */
  interface Props {
    /** Resolves the validated preview (dialog + validation already ran). */
    loadPreview: () => Promise<ImportPreviewResult | null>;
    /** Applies a confirmed preview (may return replan-needed). */
    apply: (confirmed: ImportPreviewResult) => Promise<ImportApplyResult>;
    /** Shown above the confirm button on the Restore path. */
    restoreMode?: boolean;
    /** Called after a successful merge so home/library state reloads. */
    onDone: () => void;
    onClose: () => void;
  }

  let { loadPreview, apply, restoreMode = false, onDone, onClose }: Props =
    $props();

  type Phase =
    | { kind: "validating" }
    | { kind: "invalid"; message: string }
    | { kind: "preview"; preview: ImportPreviewResult; replanned: boolean }
    | { kind: "applying" }
    | { kind: "success" }
    | { kind: "failure"; message: string }
    | { kind: "recovery-required"; message: string };

  let phase = $state<Phase>({ kind: "validating" });
  const busy = $derived(
    phase.kind === "validating" || phase.kind === "applying" ||
      phase.kind === "recovery-required",
  );

  onMount(() => {
    void (async () => {
      try {
        const preview = await loadPreview();
        if (preview === null) {
          onClose();
          return;
        }
        phase = { kind: "preview", preview, replanned: false };
      } catch (error) {
        phase = { kind: "invalid", message: describeArchiveError(error) };
      }
    })();
  });

  async function confirm(): Promise<void> {
    if (phase.kind !== "preview") return;
    const confirmed = phase.preview;
    phase = { kind: "applying" };
    try {
      const result = await apply(confirmed);
      if (result.kind === "replan-needed") {
        phase = { kind: "preview", preview: result.next, replanned: true };
        return;
      }
      phase = { kind: "success" };
      onDone();
    } catch (error) {
      phase = {
        kind: archiveErrorCode(error) === "import/recovery-required"
          ? "recovery-required"
          : "failure",
        message: describeArchiveError(error),
      };
    }
  }

  function close(): void {
    if (phase.kind === "applying" || phase.kind === "recovery-required") {
      return;
    }
    onClose();
  }
</script>

<Modal
  title={m.imp_title()}
  dismissOnOverlay={false}
  dismissOnEscape={!busy}
  onClose={close}
>
  <div class="import-body" aria-live="polite">
    {#if phase.kind === "validating"}
      <p>{m.imp_validating()}</p>
    {:else if phase.kind === "invalid"}
      <h3>{m.imp_invalid_title()}</h3>
      <p role="alert">{phase.message}</p>
    {:else if phase.kind === "preview"}
      {#if phase.replanned}
        <h3>{m.imp_replan_title()}</h3>
        <p>{m.imp_replan_body()}</p>
      {/if}
      <p>{m.imp_preview_intro()}</p>
      <ul class="counts">
        <li>{m.imp_essays_new({ count: phase.preview.preview.essays.new })}</li>
        <li>
          {m.imp_essays_identical({
            count: phase.preview.preview.essays.identical,
          })}
        </li>
        <li>
          {m.imp_essays_conflicting({
            count: phase.preview.preview.essays.conflicting,
          })}
        </li>
        <li>
          {m.imp_refs_summary({
            added: phase.preview.preview.references.new,
            identical: phase.preview.preview.references.identical,
            conflicting: phase.preview.preview.references.conflicting,
          })}
        </li>
        <li>
          {m.imp_colls_summary({
            added: phase.preview.preview.collections.new,
            identical: phase.preview.preview.collections.identical,
            conflicting: phase.preview.preview.collections.conflicting,
          })}
        </li>
        <li>
          {m.imp_assets_summary({
            added: phase.preview.preview.assets.added,
            reused: phase.preview.preview.assets.reused,
          })}
        </li>
      </ul>
      {#if restoreMode}
        <p class="note">{m.restore_consequences()}</p>
      {/if}
      <p class="note">{m.imp_rollback_privacy()}</p>
    {:else if phase.kind === "applying"}
      <p role="status">{m.imp_applying()}</p>
    {:else if phase.kind === "success"}
      <p role="status">{m.imp_success()}</p>
    {:else if phase.kind === "failure" || phase.kind === "recovery-required"}
      <p role="alert">{m.imp_failed({ reason: phase.message })}</p>
    {/if}
  </div>

  {#snippet footer()}
    {#if phase.kind === "preview"}
      <button class="btn btn-secondary" onclick={close}>
        {m.imp_cancel()}
      </button>
      <button class="btn btn-primary" onclick={confirm}>
        {m.imp_confirm()}
      </button>
    {:else if phase.kind === "success" || phase.kind === "invalid" ||
      phase.kind === "failure"}
      <button class="btn btn-primary" onclick={close}>
        {m.recovery_dismiss()}
      </button>
    {/if}
  {/snippet}
</Modal>

<style>
  .import-body {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    max-inline-size: 34rem;
  }
  .counts {
    margin: 0;
    padding-inline-start: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: var(--sp-15);
  }
  .note {
    font-size: var(--t-ui);
    color: var(--muted);
  }
</style>

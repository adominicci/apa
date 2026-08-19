<script module lang="ts">
  import type { RecoveryOutcome } from "$lib/persist/importJournal";

  export interface RecoveryActionDeps {
    retry(): Promise<RecoveryOutcome[]>;
    exportDiagnostic(outcomes: RecoveryOutcome[]): Promise<void>;
  }
</script>

<script lang="ts">
  import { m } from "$lib/paraglide/messages";

  interface Props {
    outcomes: RecoveryOutcome[];
    onRecovered: (
      outcomes: RecoveryOutcome[],
    ) => void | Promise<void>;
    actions?: RecoveryActionDeps;
  }

  const productionActions: RecoveryActionDeps = {
    async retry() {
      const { runStartupRecovery } = await import(
        "$lib/persist/portableRuntime"
      );
      return await runStartupRecovery();
    },
    async exportDiagnostic(outcomes) {
      const [{ buildRecoveryDiagnostic }, { save }, { writeExternalText }] =
        await Promise.all([
          import("$lib/persist/portableRuntime"),
          import("@tauri-apps/plugin-dialog"),
          import("$lib/persist/appDataFs"),
        ]);
      const destination = await save({
        defaultPath: "tesina-recovery-diagnostic.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (destination === null) return;
      await writeExternalText(
        destination,
        await buildRecoveryDiagnostic(outcomes),
      );
    },
  };

  let { outcomes, onRecovered, actions = productionActions }: Props = $props();
  let retryOutcomes = $state<RecoveryOutcome[] | null>(null);
  const activeOutcomes = $derived(retryOutcomes ?? outcomes);
  let operation = $state<"retry" | "export" | null>(null);
  const working = $derived(operation !== null);

  function failClosedAfterRetry(error?: unknown): void {
    if (error !== undefined) {
      console.error("No se pudo reintentar la recuperación:", error);
    }
  }

  async function retry(): Promise<void> {
    if (working) return;
    operation = "retry";
    try {
      const next = await actions.retry();
      if (next.some((outcome) => outcome.kind === "recovery-required")) {
        retryOutcomes = next;
        return;
      }
      if (
        !next.some((outcome) =>
          outcome.kind === "resumed" || outcome.kind === "rolled-back" ||
          outcome.kind === "already-complete"
        )
      ) {
        failClosedAfterRetry();
        return;
      }
      retryOutcomes = next;
      await onRecovered(next);
    } catch (error) {
      failClosedAfterRetry(error);
    } finally {
      operation = null;
    }
  }

  async function exportDiagnostic(): Promise<void> {
    if (working) return;
    operation = "export";
    try {
      await actions.exportDiagnostic(activeOutcomes);
    } catch (error) {
      console.error("No se pudo exportar el diagnóstico:", error);
    } finally {
      operation = null;
    }
  }
</script>

<p>{m.recovery_required_body()}</p>
<p>{m.recovery_quit_hint()}</p>
{#if operation === "retry"}
  <p role="status" aria-live="polite">{m.recovery_in_progress()}</p>
{/if}
<div class="recovery-actions">
  <button
    class="btn btn-secondary"
    disabled={working}
    onclick={() => {
      void exportDiagnostic();
    }}
  >
    {m.recovery_export_diagnostic()}
  </button>
  <button
    class="btn btn-primary"
    disabled={working}
    onclick={() => {
      void retry();
    }}
  >
    {m.recovery_retry()}
  </button>
</div>

<style>
  .recovery-actions {
    display: flex;
    gap: var(--sp-3);
    justify-content: flex-end;
  }
</style>

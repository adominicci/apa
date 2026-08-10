<script module lang="ts">
  import type { BackupAdapterStatus } from "$lib/state/backup.svelte";
  import type { BackupUiSettings } from "$lib/state/uiLocale.svelte";

  /** Minimal status reader injected in tests (real: tauriBackupAdapter). */
  export interface BackupStatusSource {
    status(): Promise<BackupAdapterStatus>;
  }

  /** UI settings surface the backup components read and update. */
  export interface BackupSettingsFacade {
    readonly backup: BackupUiSettings | undefined;
    updateBackup(patch: Partial<BackupUiSettings>): void;
  }
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { m } from "$lib/paraglide/messages";
  import { getLocale } from "$lib/paraglide/runtime";
  import type { BackupStore } from "$lib/state/backup.svelte";
  import { uiLocale } from "$lib/state/uiLocale.svelte";
  import { backupStore, tauriBackupAdapter } from "$lib/persist/backupRuntime";
  import { describeBackupError } from "./backupErrorMessage.ts";

  /**
   * Home status surface (task 10.3): a dismissible optional setup card
   * while unconfigured, and a compact health card afterwards. Never blocks
   * essay actions; healthy/warning states pair icons with text (never color
   * alone); a started run preserves the previous success time.
   */
  interface Props {
    statusSource?: BackupStatusSource;
    store?: BackupStore;
    settings?: BackupSettingsFacade;
    /** Opens the five-step wizard (setup or choose another folder). */
    onSetup: () => void;
    /** Opens the persistent backup Settings surface. */
    onOpenSettings: () => void;
  }

  let {
    statusSource = tauriBackupAdapter,
    store = backupStore(),
    settings = uiLocale,
    onSetup,
    onOpenSettings,
  }: Props = $props();

  let status = $state<BackupAdapterStatus | null>(null);
  let dismissedNow = $state(false);

  onMount(() => {
    void (async () => {
      try {
        status = await statusSource.status();
      } catch {
        status = null; // browser dev / bridge failure: render nothing
      }
    })();
  });

  const dismissed = $derived(
    dismissedNow || settings.backup?.setupCardDismissed === true,
  );

  type Health = "running" | "warning" | "retention" | "healthy";
  const health = $derived.by((): Health => {
    if (store.running) return "running";
    if (settings.backup?.lastErrorCode !== undefined) return "warning";
    if (store.retentionWarning || store.accumulationWarning) {
      return "retention";
    }
    return "healthy";
  });

  function formatTime(iso: string): string {
    try {
      return new Intl.DateTimeFormat(getLocale(), {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  }

  function dismiss(): void {
    dismissedNow = true;
    settings.updateBackup({ setupCardDismissed: true });
  }

  function retry(): void {
    void store.runManual();
  }
</script>

{#if status !== null && !status.configured && !dismissed}
  <section class="backup-card setup" aria-label={m.bk_card_title()}>
    <div class="text">
      <h3>{m.bk_card_title()}</h3>
      <p>{m.bk_card_body()}</p>
    </div>
    <div class="actions">
      <button class="btn btn-primary" onclick={onSetup}>
        {m.bk_card_setup()}
      </button>
      <button class="btn btn-secondary" onclick={dismiss}>
        {m.bk_card_dismiss()}
      </button>
    </div>
  </section>
{:else if status !== null && status.configured}
  <section class="backup-card" aria-label={m.bk_status_title()}>
    <div class="text" role="status" aria-live="polite">
      {#if health === "running"}
        <p class="state">
          <span class="glyph" aria-hidden="true">⟳</span>
          {m.bk_state_running()}
        </p>
      {:else if health === "warning"}
        <p class="state warn">
          <span class="glyph" aria-hidden="true">⚠</span>
          {m.bk_state_warning()}
        </p>
        <p class="reason">
          {describeBackupError({ code: settings.backup?.lastErrorCode })}
        </p>
      {:else if health === "retention"}
        <p class="state warn">
          <span class="glyph" aria-hidden="true">⚠</span>
          {m.bk_state_retention()}
        </p>
        <p class="reason">{m.bk_retention_help()}</p>
      {:else}
        <p class="state">
          <span class="glyph ok" aria-hidden="true">✓</span>
          {m.bk_state_healthy()}
        </p>
      {/if}
      <p class="detail">
        {settings.backup?.lastSuccessAt !== undefined
          ? m.bk_last_success({
            time: formatTime(settings.backup.lastSuccessAt),
          })
          : m.bk_last_success_never()}
      </p>
      <p class="detail">{m.bk_next_expected()}</p>
    </div>
    <div class="actions">
      {#if health === "warning"}
        <button
          class="btn btn-secondary"
          disabled={store.running}
          onclick={retry}
        >
          {m.bk_retry()}
        </button>
        <button class="btn btn-secondary" onclick={onSetup}>
          {m.bk_choose_another()}
        </button>
      {/if}
      <button class="btn btn-secondary" onclick={onOpenSettings}>
        {m.bk_open_settings()}
      </button>
    </div>
  </section>
{/if}

<style>
  .backup-card {
    margin: 0 clamp(20px, 4vw, 48px) 12px;
    padding: 14px 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-inline-size: 0;
  }

  .text h3,
  .text p {
    margin: 0;
  }

  .text h3 {
    font-size: 14.5px;
  }

  .setup p,
  .detail,
  .reason {
    font-size: 12.5px;
    color: var(--muted);
  }

  .state {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13.5px;
    font-weight: 600;
  }

  .state.warn {
    color: var(--danger, #a33);
  }

  .glyph {
    font-size: 13px;
  }

  .glyph.ok {
    color: var(--accent);
  }

  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--r-sm);
    font-size: 12.5px;
    font-weight: 600;
    border: 1px solid transparent;
    cursor: pointer;
  }

  .btn-primary {
    background: var(--accent);
    color: var(--accent-on);
  }

  .btn-secondary {
    background: var(--surface);
    color: var(--fg);
    border-color: var(--border);
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: default;
  }
</style>

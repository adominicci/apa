<script lang="ts">
  import { onMount } from "svelte";
  import Modal from "$lib/components/Modal.svelte";
  import LibraryImportModal from "$lib/components/LibraryImportModal.svelte";
  import { m } from "$lib/paraglide/messages";
  import { getLocale } from "$lib/paraglide/runtime";
  import type {
    BackupAdapter,
    BackupAdapterStatus,
    BackupStore,
  } from "$lib/state/backup.svelte";
  import { uiLocale } from "$lib/state/uiLocale.svelte";
  import type {
    ImportApplyResult,
    ImportPreviewResult,
  } from "$lib/persist/importFlow";
  import {
    backupStore,
    disableBackup,
    previewBackupArchive,
    revealBackupFolder,
    tauriBackupAdapter,
  } from "$lib/persist/backupRuntime";
  import { applyImportWithRuntime } from "$lib/persist/portableRuntime";
  import type { BackupSettingsFacade } from "./BackupStatusCard.svelte";
  import { describeBackupError } from "./backupErrorMessage.ts";

  /**
   * Persistent backup Settings surface (tasks 10.4/10.5): location, last
   * success, next expected condition, Back up now, Restore by merging (via
   * the shared Merge modal), Open backup folder, Change folder, Turn
   * off/Re-enable, Retry, and the setup-card preference. Folder change and
   * Turn off disclose that old archive files remain untouched.
   */
  interface Props {
    adapter?: BackupAdapter;
    store?: BackupStore;
    settings?: BackupSettingsFacade;
    restorePreview?: (fileName: string) => Promise<ImportPreviewResult>;
    restoreApply?: (
      confirmed: ImportPreviewResult,
    ) => Promise<ImportApplyResult>;
    turnOff?: () => Promise<void>;
    openFolder?: () => Promise<void>;
    /** Runs the five-step wizard (setup, re-enable, or change folder). */
    onRunWizard: () => void;
    /** Called after a successful restore merge so home/library reload. */
    onRestored: () => void;
    /** Called when native backup configuration changes. */
    onBackupChanged?: () => void;
    onClose: () => void;
  }

  let {
    adapter = tauriBackupAdapter,
    store = backupStore(),
    settings = uiLocale,
    restorePreview = previewBackupArchive,
    restoreApply = applyImportWithRuntime,
    turnOff = disableBackup,
    openFolder = revealBackupFolder,
    onRunWizard,
    onRestored,
    onBackupChanged = () => {},
    onClose,
  }: Props = $props();

  let status = $state<BackupAdapterStatus | null>(null);
  let statusLoaded = $state(false);
  let notice = $state<string | null>(null);
  let errorNotice = $state<string | null>(null);
  let confirmingOff = $state(false);
  let showCardPref = $state(true);

  // Restore chooser (spec: list available .tesina files, then Merge).
  let view = $state<"main" | "restore">("main");
  let archives = $state<{ fileName: string; byteLength: number }[] | null>(
    null,
  );
  let restoreFile = $state<string | null>(null);

  onMount(() => {
    showCardPref = settings.backup?.setupCardDismissed !== true;
    void reloadStatus();
  });

  async function reloadStatus(): Promise<void> {
    try {
      status = await adapter.status();
    } catch (error) {
      status = null;
      errorNotice = describeBackupError(error);
    } finally {
      statusLoaded = true;
    }
  }

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

  async function backupNow(): Promise<void> {
    if (store.running) return;
    notice = null;
    errorNotice = null;
    const outcome = await store.runManual();
    if (outcome.kind === "success") {
      notice = m.bk_run_success();
    } else if (outcome.kind === "failed") {
      errorNotice = m.bk_run_failed({
        reason: describeBackupError({ code: outcome.errorCode }),
      });
    } else if (outcome.reason === "unchanged") {
      notice = m.bk_run_skipped_unchanged();
    } else if (outcome.reason === "not-configured") {
      errorNotice = m.bk_not_configured();
    }
  }

  async function confirmTurnOff(): Promise<void> {
    confirmingOff = false;
    notice = null;
    errorNotice = null;
    try {
      await turnOff();
      await reloadStatus();
      onBackupChanged();
      notice = m.bk_turn_off_done();
    } catch (error) {
      errorNotice = describeBackupError(error);
    }
  }

  async function openRestore(): Promise<void> {
    view = "restore";
    archives = null;
    errorNotice = null;
    try {
      archives = await adapter.listArchives();
    } catch (error) {
      view = "main";
      errorNotice = describeBackupError(error);
    }
  }

  function handleOpenFolder(): void {
    errorNotice = null;
    void openFolder().catch((error) => {
      errorNotice = describeBackupError(error);
    });
  }

  function toggleCardPref(): void {
    showCardPref = !showCardPref;
    settings.updateBackup({ setupCardDismissed: !showCardPref });
  }

  const failing = $derived(settings.backup?.lastErrorCode !== undefined);

  /* One status slot carries all four states. Previously each was its own
     stray paragraph, so the dialog's first answer changed shape and position
     depending on what had happened. */
  const tone = $derived(
    store.running ? "busy" : failing ? "warn" : "ok",
  );

  const statusTitle = $derived(
    store.running
      ? m.bk_state_running()
      : failing
      ? m.bk_state_warning()
      : m.bk_state_healthy(),
  );

  const statusMeta = $derived(
    settings.backup?.lastSuccessAt !== undefined
      ? m.bk_last_success({ time: formatTime(settings.backup.lastSuccessAt) })
      : m.bk_last_success_never(),
  );

  const folderPath = $derived(
    status?.folderPath !== undefined
      ? `${status.folderPath}/Tesina Backups`
      : "",
  );
</script>

<Modal title={m.bk_settings_title()} dismissOnOverlay={false} {onClose}>
  <div class="backup-settings">
    {#if !statusLoaded}
      <p role="status">{m.home_loading()}</p>
    {:else if view === "restore"}
      <div class="status-panel" data-tone="warn">
        <span class="status-dot" aria-hidden="true"></span>
        <div class="status-body">
          <span class="status-title">{m.bk_restore_pick_title()}</span>
          <span class="status-meta">{m.restore_consequences()}</span>
        </div>
      </div>
      <p class="hint">{m.bk_restore_pick_body()}</p>
      {#if archives === null}
        <p class="hint" role="status">{m.home_loading()}</p>
      {:else if archives.length === 0}
        <p class="hint" role="status">{m.bk_restore_empty()}</p>
      {:else}
        <ul class="archive-list">
          {#each archives as archive (archive.fileName)}
            <li>
              <button
                class="archive"
                onclick={() => (restoreFile = archive.fileName)}
              >
                {archive.fileName}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      <button class="btn btn-secondary" onclick={() => (view = "main")}>
        {m.bk_back()}
      </button>
    {:else if status !== null && status.configured}
      <!-- The answer first: state, then when, then the schedule as fine print. -->
      <div class="status-panel" data-tone={tone}>
        <span class="status-dot" aria-hidden="true"></span>
        <div class="status-body">
          <span class="status-title" role="status">{statusTitle}</span>
          <span class="status-meta">{statusMeta}</span>
        </div>
      </div>
      <p class="hint">{m.bk_next_expected()}</p>

      {#if notice !== null && !store.running}
        <p class="hint" role="status">{notice}</p>
      {/if}
      {#if errorNotice !== null}
        <p class="error" role="alert">{errorNotice}</p>
      {/if}
      {#if failing && !store.running}
        <p class="error" role="alert">
          {describeBackupError({
            code: settings.backup?.lastErrorCode,
          })}
        </p>
      {/if}

      <div class="actions">
        <button
          class="btn btn-primary"
          disabled={store.running}
          onclick={() => {
            void backupNow();
          }}
        >
          {m.bk_backup_now()}
        </button>
        {#if failing}
          <button
            class="btn btn-secondary"
            disabled={store.running}
            onclick={() => {
              void backupNow();
            }}
          >
            {m.bk_retry()}
          </button>
        {/if}
        <button
          class="btn btn-secondary"
          onclick={() => {
            void openRestore();
          }}
        >
          {m.bk_restore()}
        </button>
      </div>

      <div class="section"><span>{m.bk_section_folder()}</span></div>
      <p class="path-value" title={folderPath}>{folderPath}</p>
      <div class="actions">
        <button class="btn btn-secondary" onclick={handleOpenFolder}>
          {m.bk_open_folder()}
        </button>
        <button class="btn btn-secondary" onclick={onRunWizard}>
          {m.bk_change_folder()}
        </button>
      </div>
      <p class="hint">{m.bk_change_disclosure()}</p>

      <div class="section"><span>{m.bk_section_advanced()}</span></div>
      {#if confirmingOff}
        <div
          class="confirm-off"
          role="alertdialog"
          aria-label={m.bk_turn_off_confirm_title()}
        >
          <strong class="status-title">{m.bk_turn_off_confirm_title()}</strong>
          <p class="status-meta">{m.bk_turn_off_body()}</p>
          <div class="actions">
            <button
              class="btn btn-secondary"
              onclick={() => (confirmingOff = false)}
            >
              {m.bk_cancel()}
            </button>
            <button
              class="btn btn-danger-solid"
              onclick={() => {
                void confirmTurnOff();
              }}
            >
              {m.bk_turn_off_confirm()}
            </button>
          </div>
        </div>
      {:else}
        <div class="actions">
          <button class="btn btn-danger" onclick={() => (confirmingOff = true)}>
            {m.bk_turn_off()}
          </button>
        </div>
      {/if}
    {:else}
      <div class="status-panel" data-tone="off">
        <span class="status-dot" aria-hidden="true"></span>
        <div class="status-body">
          <span class="status-title" role="status">{m.bk_not_configured()}</span>
          <span class="status-meta">{m.bk_reenable_note()}</span>
        </div>
      </div>
      {#if notice !== null}
        <p class="hint" role="status">{notice}</p>
      {/if}
      {#if errorNotice !== null}
        <p class="error" role="alert">{errorNotice}</p>
      {/if}
      <div class="actions">
        <button class="btn btn-primary" onclick={onRunWizard}>
          {m.bk_reenable()}
        </button>
      </div>
    {/if}
  </div>

  {#snippet footer()}
    {#if statusLoaded && view === "main"}
      <label class="check">
        <input
          type="checkbox"
          checked={showCardPref}
          onchange={toggleCardPref}
        />
        {m.bk_card_pref()}
      </label>
    {/if}
    <button class="btn btn-ghost" onclick={onClose}>{m.common_close()}</button>
  {/snippet}
</Modal>

{#if restoreFile !== null}
  <LibraryImportModal
    loadPreview={() => restorePreview(restoreFile as string)}
    apply={restoreApply}
    restoreMode={true}
    onDone={onRestored}
    onClose={() => (restoreFile = null)}
  />
{/if}

<style>
  /*
   * Layout only. The status panel, path well, section dividers, hints and
   * every .btn variant come from the shared modal.css, so this dialog cannot
   * drift from the other twelve. The private .btn/.btn-secondary/.btn-danger
   * copies that used to live here are gone.
   */
  .backup-settings {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }

  .backup-settings p {
    margin: 0;
  }

  .error {
    font-size: var(--t-small);
    line-height: var(--lh-snug);
    color: var(--danger);
  }

  .actions {
    display: flex;
    gap: var(--sp-2);
    flex-wrap: wrap;
  }

  .archive-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    max-block-size: 14rem;
    overflow-y: auto;
  }

  .archive {
    inline-size: 100%;
    text-align: left;
    font-family: var(--mono);
    font-size: var(--t-small);
    padding: var(--sp-2) var(--sp-3);
    background: var(--bg);
    border: 1px solid var(--border-soft);
    border-radius: var(--r-xs);
    cursor: pointer;
    color: var(--fg-2);
  }

  .archive:hover {
    background: var(--hover);
    border-color: var(--fg-2);
    color: var(--fg);
  }

  /* Inline confirmation, not a second dialog stacked on the first. */
  .confirm-off {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    padding: var(--sp-3) var(--sp-4);
    border-radius: var(--r-md);
    background: var(--danger-soft);
  }
</style>

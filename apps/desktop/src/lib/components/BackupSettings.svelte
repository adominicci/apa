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
</script>

<Modal title={m.bk_settings_title()} dismissOnOverlay={false} {onClose}>
  <div class="backup-settings">
    {#if !statusLoaded}
      <p role="status">{m.home_loading()}</p>
    {:else if view === "restore"}
      <h4>{m.bk_restore_pick_title()}</h4>
      <p class="note">{m.restore_consequences()}</p>
      <p>{m.bk_restore_pick_body()}</p>
      {#if archives === null}
        <p role="status">{m.home_loading()}</p>
      {:else if archives.length === 0}
        <p role="status">{m.bk_restore_empty()}</p>
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
      {#if status.folderPath !== undefined}
        <p class="path">
          {m.bk_location({ path: `${status.folderPath}/Tesina Backups` })}
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

      {#if store.running}
        <p role="status">{m.bk_state_running()}</p>
      {:else if notice !== null}
        <p role="status">{notice}</p>
      {/if}
      {#if errorNotice !== null}
        <p class="error" role="alert">{errorNotice}</p>
      {/if}
      {#if settings.backup?.lastErrorCode !== undefined && !store.running}
        <p class="error" role="alert">
          <span aria-hidden="true">⚠</span>
          {m.bk_state_warning()} — {describeBackupError({
            code: settings.backup.lastErrorCode,
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
        {#if settings.backup?.lastErrorCode !== undefined}
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
        <button class="btn btn-secondary" onclick={handleOpenFolder}>
          {m.bk_open_folder()}
        </button>
        <button class="btn btn-secondary" onclick={onRunWizard}>
          {m.bk_change_folder()}
        </button>
        <button
          class="btn btn-danger"
          onclick={() => (confirmingOff = true)}
        >
          {m.bk_turn_off()}
        </button>
      </div>
      <p class="note">{m.bk_change_disclosure()}</p>

      {#if confirmingOff}
        <div class="confirm-off" role="alertdialog" aria-label={m.bk_turn_off_confirm_title()}>
          <h4>{m.bk_turn_off_confirm_title()}</h4>
          <p>{m.bk_turn_off_body()}</p>
          <div class="actions">
            <button
              class="btn btn-secondary"
              onclick={() => (confirmingOff = false)}
            >
              {m.bk_cancel()}
            </button>
            <button
              class="btn btn-danger"
              onclick={() => {
                void confirmTurnOff();
              }}
            >
              {m.bk_turn_off_confirm()}
            </button>
          </div>
        </div>
      {/if}
    {:else}
      <p>{m.bk_not_configured()}</p>
      {#if notice !== null}
        <p role="status">{notice}</p>
      {/if}
      {#if errorNotice !== null}
        <p class="error" role="alert">{errorNotice}</p>
      {/if}
      <p class="note">{m.bk_reenable_note()}</p>
      <div class="actions">
        <button class="btn btn-primary" onclick={onRunWizard}>
          {m.bk_reenable()}
        </button>
      </div>
    {/if}

    {#if statusLoaded && view === "main"}
      <label class="pref">
        <input
          type="checkbox"
          checked={showCardPref}
          onchange={toggleCardPref}
        />
        {m.bk_card_pref()}
      </label>
    {/if}
  </div>
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
  .backup-settings {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-inline-size: 34rem;
  }

  .backup-settings h4,
  .backup-settings p {
    margin: 0;
  }

  .path {
    font-family: var(--mono, monospace);
    font-size: 0.85rem;
    word-break: break-all;
  }

  .detail,
  .note {
    font-size: 0.85rem;
    color: var(--muted, #666);
  }

  .error {
    color: var(--danger, #a33);
  }

  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    height: 34px;
    padding: 0 14px;
    border-radius: var(--r-sm);
    font-size: 13px;
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

  .btn-danger {
    background: var(--surface);
    color: var(--danger, #a33);
    border-color: var(--border);
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .archive-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-block-size: 14rem;
    overflow-y: auto;
  }

  .archive {
    inline-size: 100%;
    text-align: left;
    font-family: var(--mono, monospace);
    font-size: 0.85rem;
    padding: 8px 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    cursor: pointer;
    color: var(--fg);
  }

  .archive:hover {
    background: var(--hover, #eee);
  }

  .confirm-off {
    border: 1px solid var(--danger, #a33);
    border-radius: var(--r-sm);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .pref {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    cursor: pointer;
  }
</style>

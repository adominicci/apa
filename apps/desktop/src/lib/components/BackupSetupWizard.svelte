<script module lang="ts">
  /** Injectable wizard I/O so tests run without Tauri (tasks 10.1/10.2). */
  export interface BackupWizardIo {
    pickFolder(): Promise<string | null>;
    begin(path: string): Promise<{
      canonicalFolderPath: string;
      backupSubfolderPath: string;
    }>;
    writeTest(): Promise<{ fileName: string; contentDigest: string }>;
    activate(test: { contentDigest: string }): Promise<void>;
    cancel(): Promise<void>;
  }
</script>

<script lang="ts">
  import Modal from "$lib/components/Modal.svelte";
  import { m } from "$lib/paraglide/messages";
  import {
    activateBackupConfiguration,
    beginBackupConfiguration,
    cancelBackupConfiguration,
    pickBackupFolder,
    writeWizardTestBackup,
  } from "$lib/persist/backupRuntime";
  import { describeBackupError } from "./backupErrorMessage.ts";

  /**
   * Five explicit steps (design §11): Why → Choose location → Review
   * privacy → Test backup → Success. Nothing is configured until the real
   * test archive is written, reopened, validated, and activated; cancel at
   * any earlier point clears the pending native selection and its own test
   * files only.
   */
  interface Props {
    io?: BackupWizardIo;
    /** Called once the validated test activated the configuration. */
    onConfigured: () => void;
    onClose: () => void;
  }

  const realIo: BackupWizardIo = {
    pickFolder: () => pickBackupFolder(),
    begin: (path) => beginBackupConfiguration(path),
    writeTest: () => writeWizardTestBackup(),
    activate: async (test) => {
      await activateBackupConfiguration(test);
    },
    cancel: () => cancelBackupConfiguration(),
  };

  let { io = realIo, onConfigured, onClose }: Props = $props();

  type Step = "why" | "location" | "privacy" | "test" | "success";
  const stepNumber: Record<Step, number> = {
    why: 1,
    location: 2,
    privacy: 3,
    test: 4,
    success: 5,
  };

  let step = $state<Step>("why");
  let pending = $state<
    { canonicalFolderPath: string; backupSubfolderPath: string } | null
  >(null);
  let locationError = $state<string | null>(null);
  let choosing = $state(false);
  let consent = $state(false);
  let testing = $state(false);
  let testError = $state<string | null>(null);
  let activated = $state(false);

  async function chooseFolder(): Promise<void> {
    if (choosing) return;
    choosing = true;
    locationError = null;
    try {
      const picked = await io.pickFolder();
      if (picked === null) return; // cancelled picker: stay on this step
      pending = await io.begin(picked);
    } catch (error) {
      pending = null;
      locationError = describeBackupError(error);
    } finally {
      choosing = false;
    }
  }

  async function runTest(): Promise<void> {
    if (!consent || testing) return;
    testing = true;
    testError = null;
    try {
      const test = await io.writeTest();
      await io.activate(test);
      activated = true;
      step = "success";
    } catch (error) {
      testError = describeBackupError(error);
    } finally {
      testing = false;
    }
  }

  async function chooseAnotherFolder(): Promise<void> {
    // Cleanup via cancel: Rust removes only this session's test files.
    try {
      await io.cancel();
    } catch {
      // Cleanup is best-effort; the user is re-selecting anyway.
    }
    pending = null;
    consent = false;
    testError = null;
    locationError = null;
    step = "location";
  }

  function goBack(): void {
    if (testing) return;
    if (step === "location") step = "why";
    else if (step === "privacy") step = "location";
    else if (step === "test") {
      testError = null;
      step = "privacy";
    }
  }

  function cancelWizard(): void {
    if (testing) return; // the test write finishes or fails first
    if (activated) {
      onConfigured();
      return;
    }
    void io.cancel().catch(() => {
      // Best-effort native cleanup; nothing was configured.
    });
    onClose();
  }
</script>

<Modal
  title={m.bk_wizard_title()}
  subtitle={m.bk_step_of({ current: stepNumber[step] })}
  dismissOnOverlay={false}
  dismissOnEscape={!testing}
  onClose={cancelWizard}
>
  <div class="wizard-body">
    {#if step === "why"}
      <h4>{m.bk_why_title()}</h4>
      <p>{m.bk_why_body()}</p>
      <p class="note">{m.bk_why_provider_note()}</p>
    {:else if step === "location"}
      <h4>{m.bk_location_title()}</h4>
      <p>{m.bk_location_body()}</p>
      <button
        class="btn btn-secondary"
        disabled={choosing}
        onclick={chooseFolder}
      >
        {m.bk_choose_folder()}
      </button>
      {#if pending !== null}
        <p class="path">
          {m.bk_chosen_folder({ path: pending.canonicalFolderPath })}
        </p>
      {:else}
        <p class="note">{m.bk_no_folder_yet()}</p>
      {/if}
      {#if locationError !== null}
        <p class="error" role="alert">{locationError}</p>
      {/if}
    {:else if step === "privacy"}
      <h4>{m.bk_privacy_title()}</h4>
      <p>{m.bk_privacy_body()}</p>
    {:else if step === "test"}
      <h4>{m.bk_test_title()}</h4>
      {#if pending !== null}
        <p class="path">
          {m.bk_test_destination({ path: pending.backupSubfolderPath })}
        </p>
      {/if}
      <p>{m.bk_test_explain()}</p>
      {#if testing}
        <p role="status">{m.bk_test_running()}</p>
      {:else if testError !== null}
        <p class="error" role="alert">
          {m.bk_test_failed({ reason: testError })}
        </p>
      {:else}
        <label class="consent">
          <input type="checkbox" bind:checked={consent} />
          {m.bk_test_consent()}
        </label>
      {/if}
    {:else if step === "success"}
      <h4>{m.bk_success_title()}</h4>
      <p role="status">{m.bk_success_local_only()}</p>
      <p>{m.bk_success_next()}</p>
    {/if}
  </div>

  {#snippet footer()}
    {#if step === "success"}
      <button class="btn btn-primary" onclick={onConfigured}>
        {m.bk_done()}
      </button>
    {:else}
      <button class="btn btn-secondary" disabled={testing} onclick={cancelWizard}>
        {m.bk_cancel()}
      </button>
      {#if step !== "why"}
        <button class="btn btn-secondary" disabled={testing} onclick={goBack}>
          {m.bk_back()}
        </button>
      {/if}
      {#if step === "why"}
        <button class="btn btn-primary" onclick={() => (step = "location")}>
          {m.bk_continue()}
        </button>
      {:else if step === "location"}
        <button
          class="btn btn-primary"
          disabled={pending === null}
          onclick={() => (step = "privacy")}
        >
          {m.bk_continue()}
        </button>
      {:else if step === "privacy"}
        <button class="btn btn-primary" onclick={() => (step = "test")}>
          {m.bk_continue()}
        </button>
      {:else if step === "test"}
        {#if testError !== null}
          <button
            class="btn btn-secondary"
            onclick={() => {
              void chooseAnotherFolder();
            }}
          >
            {m.bk_choose_another()}
          </button>
          <button
            class="btn btn-primary"
            onclick={() => {
              testError = null;
              void runTest();
            }}
          >
            {m.bk_retry()}
          </button>
        {:else}
          <button
            class="btn btn-primary"
            disabled={!consent || testing}
            onclick={() => {
              void runTest();
            }}
          >
            {m.bk_test_write()}
          </button>
        {/if}
      {/if}
    {/if}
  {/snippet}
</Modal>

<style>
  .wizard-body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-inline-size: 32rem;
  }

  .wizard-body h4 {
    margin: 0;
    font-size: 1rem;
  }

  .wizard-body p {
    margin: 0;
  }

  .note {
    font-size: 0.85rem;
    color: var(--muted, #666);
  }

  .path {
    font-family: var(--mono, monospace);
    font-size: 0.85rem;
    word-break: break-all;
  }

  .error {
    color: var(--danger, #a33);
  }

  .consent {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    cursor: pointer;
  }

  .consent input {
    margin-block-start: 0.2rem;
  }
</style>

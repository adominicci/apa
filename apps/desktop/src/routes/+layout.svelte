<script lang="ts">
  // Inter's @font-face is embedded (base64) in the static document head
  // (app.html), NOT imported here — a Vite-processed @font-face kept getting
  // dropped in dev (WKWebView HMR + dev-server url() 404s). See AGENTS.md.
  import "$lib/styles/tokens.css";
  import { onMount, untrack } from "svelte";
  import type { Snippet } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import ReleaseNotesModal from "$lib/components/ReleaseNotesModal.svelte";
  import { uiLocale } from "$lib/state/uiLocale.svelte";
  import { updater } from "$lib/state/updater.svelte";
  import type { ReleaseNotesStorage } from "$lib/update/releaseNotes";
  import { bundledReleaseNotes } from "$lib/update/bundledReleaseNotes";
  import {
    createReleaseNotesController,
    provideReleaseNotesController,
  } from "$lib/update/releaseNotesController.svelte";
  import { m } from "$lib/paraglide/messages";
  import { library } from "$lib/state/library.svelte";
  import { persistence } from "$lib/persist/coordinator";
  import { operations } from "$lib/persist/operationCoordinator";
  import { createCloseRequestHandler } from "$lib/persist/windowClose";

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();

  // Per-session dismissal; the banner returns next launch if still available.
  let updateDismissed = $state(false);

  function browserStorage(): ReleaseNotesStorage | null {
    try {
      return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      return null;
    }
  }

  const releaseNotes = provideReleaseNotesController(
    createReleaseNotesController({
      bundled: bundledReleaseNotes,
      getRuntimeVersion: getVersion,
      getStorage: browserStorage,
      unavailableBody: () =>
        m.release_notes_unavailable(undefined, {
          locale: uiLocale.current,
        }),
    }),
  );

  onMount(() => {
    // Version resolution is optional and must never delay startup. The
    // controller retains the statically bundled package version on failure.
    void releaseNotes.resolveRuntimeVersion();
  });

  onMount(() => {
    const libraryPersistence = persistence.register(() =>
      library.flushPending()
    );
    const settingsPersistence = persistence.register(() =>
      uiLocale.flushPending()
    );
    library.setPersistenceDirtyNotifier(libraryPersistence.markDirty);
    uiLocale.setPersistenceDirtyNotifier(settingsPersistence.markDirty);
    let disposed = false;
    let unlisten: (() => void) | undefined;

    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      const appWindow = getCurrentWindow();
      const close = createCloseRequestHandler({
        // Flush persistence first, then wait for active export/backup/import
        // operations to reach their safe points (cancel-and-clean or a
        // persisted recoverable journal) — design §13, task 6.7.
        flushPending: async () => {
          await persistence.flushPending();
          await operations.awaitSafeShutdown();
          await persistence.flushPending();
        },
        destroy: () => appWindow.destroy(),
        onError: (error) => {
          console.error("No se pudo cerrar la aplicación:", error);
        },
      });
      void appWindow.onCloseRequested((event) => {
        void close(event);
      }).then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      }).catch((error) => {
        console.error("No se pudo preparar el cierre seguro:", error);
      });
    }

    return () => {
      disposed = true;
      unlisten?.();
      library.setPersistenceDirtyNotifier(null);
      uiLocale.setPersistenceDirtyNotifier(null);
      libraryPersistence.unregister();
      settingsPersistence.unregister();
    };
  });

  $effect(() => {
    // Reading both axes keeps mismatch fallback copy synchronized with the UI
    // language while startup waits only for the locale loader itself.
    uiLocale.current;
    const localeReady = uiLocale.loaded;
    untrack(() => releaseNotes.setUiReady(localeReady));
  });

  // Resolve "system" against the OS preference, live.
  $effect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = uiLocale.theme === "dark" ||
        (uiLocale.theme === "system" && media.matches);
      document.documentElement.dataset["theme"] = dark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  });
</script>

{#if !releaseNotes.resolutionPending && !releaseNotes.presentation && updater.status !== "idle" && !updateDismissed}
  <div class="update-banner" role="status">
    {#if updater.status === "downloading"}
      <span>{m.update_downloading({ percent: updater.progress })}</span>
    {:else if updater.status === "error"}
      <span>{m.update_error()}</span>
      <button class="update-action" onclick={() => updater.install()}>
        {m.update_action()}
      </button>
      <button
        class="update-x"
        onclick={() => (updateDismissed = true)}
        aria-label={m.common_close()}
      >×</button>
    {:else}
      <span>{m.update_ready({ version: updater.version ?? "" })}</span>
      <button class="update-action" onclick={() => updater.install()}>
        {m.update_action()}
      </button>
      <button
        class="update-x"
        onclick={() => (updateDismissed = true)}
        aria-label={m.common_close()}
      >×</button>
    {/if}
  </div>
{/if}

{#if releaseNotes.presentation}
  <ReleaseNotesModal
    version={releaseNotes.presentation.version}
    body={releaseNotes.presentation.body}
    onClose={() => releaseNotes.dismiss()}
  />
{/if}

{@render children()}

<style>
  .update-banner {
    position: fixed;
    top: 52px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 200;
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: min(92vw, 560px);
    padding: 10px 12px 10px 16px;
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--fg);
    border: 1px solid var(--accent);
    box-shadow: var(--elev-raised);
    font-family: var(--font);
    font-size: 13px;
  }

  .update-action {
    border: none;
    background: var(--accent);
    color: var(--accent-on);
    border-radius: var(--r-pill);
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }

  .update-action:hover {
    background: var(--accent-hover);
  }

  .update-x {
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 0 2px;
  }
</style>

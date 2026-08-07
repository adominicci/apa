<script lang="ts">
  // Inter's @font-face is embedded (base64) in the static document head
  // (app.html), NOT imported here — a Vite-processed @font-face kept getting
  // dropped in dev (WKWebView HMR + dev-server url() 404s). See AGENTS.md.
  import "$lib/styles/tokens.css";
  import { onMount } from "svelte";
  import type { Snippet } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import ReleaseNotesModal from "$lib/components/ReleaseNotesModal.svelte";
  import { uiLocale } from "$lib/state/uiLocale.svelte";
  import { updater } from "$lib/state/updater.svelte";
  import {
    clearPendingReleaseNotes,
    type PendingReleaseNotes,
    releaseNotesForVersion,
    type ReleaseNotesStorage,
  } from "$lib/update/releaseNotes";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();

  // Per-session dismissal; the banner returns next launch if still available.
  let updateDismissed = $state(false);
  let runningVersion = $state<string | null>(null);
  let runningVersionResolved = $state(false);
  let releaseNotesDismissed = $state(false);

  function browserStorage(): ReleaseNotesStorage | null {
    try {
      return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      return null;
    }
  }

  onMount(() => {
    void (async () => {
      try {
        runningVersion = await getVersion();
      } catch (err) {
        // Release notes are optional and must never delay or block startup.
        console.error("No se pudieron cargar las notas de versión:", err);
      } finally {
        runningVersionResolved = true;
      }
    })();
  });

  const releaseNotesResolutionPending = $derived(
    !runningVersionResolved || !uiLocale.loaded,
  );

  const releaseNotes = $derived.by((): PendingReleaseNotes | null => {
    if (
      releaseNotesResolutionPending || !runningVersion ||
      releaseNotesDismissed
    ) {
      return null;
    }
    const storage = browserStorage();
    if (!storage) return null;
    return releaseNotesForVersion(
      storage,
      runningVersion,
      m.release_notes_fallback(undefined, { locale: uiLocale.current }),
    );
  });

  function dismissReleaseNotes() {
    const displayed = releaseNotes;
    const storage = browserStorage();
    if (storage && displayed) clearPendingReleaseNotes(storage, displayed);
    releaseNotesDismissed = true;
  }

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

{#if !releaseNotesResolutionPending && !releaseNotes && updater.status !== "idle" && !updateDismissed}
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

{#if releaseNotes}
  <ReleaseNotesModal
    version={releaseNotes.version}
    body={releaseNotes.body}
    onClose={dismissReleaseNotes}
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

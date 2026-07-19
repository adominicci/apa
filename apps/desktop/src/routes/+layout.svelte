<script lang="ts">
  // Inter's @font-face is embedded (base64) in the static document head
  // (app.html), NOT imported here — a Vite-processed @font-face kept getting
  // dropped in dev (WKWebView HMR + dev-server url() 404s). See AGENTS.md.
  import "$lib/styles/tokens.css";
  import type { Snippet } from "svelte";
  import { uiLocale } from "$lib/state/uiLocale.svelte";
  import { updater } from "$lib/state/updater.svelte";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();

  // Per-session dismissal; the banner returns next launch if still available.
  let updateDismissed = $state(false);

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

{#if updater.status !== "idle" && !updateDismissed}
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

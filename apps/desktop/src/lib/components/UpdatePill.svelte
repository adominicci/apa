<script lang="ts">
  import MarkdownContent from "$lib/components/MarkdownContent.svelte";
  import { m } from "$lib/paraglide/messages";
  import { uiLocale } from "$lib/state/uiLocale.svelte";
  import { updater } from "$lib/state/updater.svelte";
  import { useReleaseNotesController } from "$lib/update/releaseNotesController.svelte";

  const releaseNotes = useReleaseNotesController();

  let cardOpen = $state(false);
  /** A user-triggered re-check; the launch check never surfaces "up to date". */
  let manualCheck = $state<"none" | "checking" | "uptodate">("none");

  // The release-notes modal wins: the pill stays hidden until the runtime
  // version is resolved and no notes dialog is on screen (same precedence the
  // old layout banner enforced).
  const visible = $derived(
    !releaseNotes.resolutionPending && !releaseNotes.presentation,
  );

  const label = $derived.by(() => {
    const opts = { locale: uiLocale.current };
    if (updater.status === "downloading") {
      return m.update_downloading({ percent: updater.progress }, opts);
    }
    if (updater.status === "error") return m.update_error(undefined, opts);
    if (updater.status === "idle") return m.update_check(undefined, opts);
    return m.update_ready({ version: updater.version ?? "" }, opts);
  });

  const cardVisible = $derived(
    cardOpen &&
      (updater.status === "available" || updater.status === "error" ||
        (updater.status === "idle" && manualCheck === "uptodate")),
  );

  // r=9.5 in a 22px viewBox; circumference 2πr.
  const RING = 2 * Math.PI * 9.5;
  const ringOffset = $derived(
    updater.status === "downloading"
      ? RING * (1 - updater.progress / 100)
      : RING,
  );

  async function handleClick() {
    if (updater.status === "downloading") return;
    if (updater.status === "idle") {
      if (manualCheck === "checking") return;
      manualCheck = "checking";
      await updater.check();
      manualCheck = updater.status === "idle" ? "uptodate" : "none";
      if (manualCheck === "uptodate") cardOpen = true;
      return;
    }
    void updater.install();
  }

  function closeCard() {
    cardOpen = false;
    if (manualCheck === "uptodate") manualCheck = "none";
  }
</script>

{#if visible}
  <span
    data-update-pill
    class="anchor"
    role="presentation"
    onmouseenter={() => (cardOpen = true)}
    onmouseleave={closeCard}
  >
    <button
      type="button"
      class="pill"
      class:err={updater.status === "error"}
      disabled={updater.status === "downloading"}
      aria-label={label}
      title={label}
      onclick={handleClick}
      onfocus={() => (cardOpen = true)}
      onblur={closeCard}
    >
      <svg class="ring" viewBox="0 0 22 22" aria-hidden="true">
        <circle class="track" cx="11" cy="11" r="9.5" />
        <circle
          class="progress"
          cx="11"
          cy="11"
          r="9.5"
          stroke-dasharray={RING}
          stroke-dashoffset={ringOffset}
        />
      </svg>
      {#if updater.status === "error"}
        <span class="warn" aria-hidden="true">!</span>
      {:else if updater.status === "idle"}
        <svg
          class="arrow"
          class:spin={manualCheck === "checking"}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          aria-hidden="true"
        >
          <path d="M18.4 6.7A7 7 0 1 0 19 12" />
          <path d="M19 4v4h-4" />
        </svg>
      {:else}
        <svg
          class="arrow"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          aria-hidden="true"
        >
          <path d="M12 4v12m0 0 5-5m-5 5-5-5" />
          <path d="M5 20h14" />
        </svg>
        {#if updater.status === "available"}
          <span class="badge" aria-hidden="true"></span>
        {/if}
      {/if}
    </button>

    {#if cardVisible}
      <div data-update-card class="card" role="status">
        {#if updater.status === "idle"}
          <div class="title">
            {m.update_up_to_date(undefined, { locale: uiLocale.current })}
          </div>
        {:else}
          <div class="title">{label}</div>
        {/if}
        {#if updater.status === "available" && updater.body}
          <div class="head">
            {m.release_notes_title(undefined, { locale: uiLocale.current })}
          </div>
          <div class="notes"><MarkdownContent source={updater.body} /></div>
        {/if}
        {#if updater.status !== "idle"}
          <p class="hint">
            {m.update_click_hint(undefined, { locale: uiLocale.current })}
          </p>
        {/if}
      </div>
    {/if}
  </span>
{/if}

<style>
  .anchor {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .pill {
    position: relative;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--muted);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition: color var(--fast) var(--ease);
  }

  .pill:hover:enabled,
  .pill:focus-visible {
    color: var(--accent);
  }

  .pill:disabled {
    cursor: default;
  }

  .pill.err {
    color: var(--danger);
  }

  .ring {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
  }

  .ring circle {
    fill: none;
    stroke-width: 2;
  }

  .ring .track {
    stroke: var(--hover);
  }

  .ring .progress {
    stroke: var(--accent);
    stroke-linecap: round;
    transition: stroke-dashoffset var(--fast) var(--ease);
  }

  .arrow {
    width: 11px;
    height: 11px;
  }

  .arrow.spin {
    animation: pill-spin 0.9s linear infinite;
  }

  @keyframes pill-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .warn {
    font-size: var(--t-caption);
    font-weight: 700;
    line-height: 1;
  }

  .badge {
    position: absolute;
    top: -1px;
    right: -1px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
  }

  .card {
    position: absolute;
    bottom: calc(100% + 8px);
    right: -4px;
    width: 216px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    box-shadow: var(--elev-raised);
    padding: var(--sp-3);
    z-index: var(--z-toast);
    text-align: left;
  }

  .title {
    font-size: var(--t-small);
    font-weight: 600;
    color: var(--fg);
  }

  .head {
    margin-top: var(--sp-2);
    font-size: var(--t-caption);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .notes {
    margin-top: var(--sp-1);
    max-height: 180px;
    overflow-y: auto;
    font-size: var(--t-small);
  }

  .notes :global(.markdown-content) {
    font-size: inherit;
  }

  .hint {
    margin: var(--sp-2) 0 0;
    font-size: var(--t-caption);
    color: var(--muted);
  }
</style>

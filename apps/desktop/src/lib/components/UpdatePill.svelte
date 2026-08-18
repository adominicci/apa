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

  /** Tone for the popover header. Same four names the badge uses. */
  const cardTone = $derived(
    updater.status === "error"
      ? "danger"
      : updater.status === "available" || updater.status === "downloading"
      ? "accent"
      : "success",
  );

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
      {#if updater.status === "downloading"}
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
      {/if}
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
          <span class="dot" aria-hidden="true"></span>
        {/if}
      {/if}
    </button>

    {#if cardVisible}
      <div data-update-card class="popover card" role="status">
        <div class="popover-head" data-tone={cardTone}>
          <span class="popover-dot" aria-hidden="true"></span>
          <div>
            <div class="popover-title">
              {#if updater.status === "idle"}
                {m.update_up_to_date(undefined, { locale: uiLocale.current })}
              {:else}
                {label}
              {/if}
            </div>
            {#if updater.status !== "idle"}
              <div class="popover-meta">
                {m.update_click_hint(undefined, { locale: uiLocale.current })}
              </div>
            {/if}
          </div>
        </div>
        {#if updater.status === "available" && updater.body}
          <div class="notes-wrap">
            <div class="head">
              {m.release_notes_title(undefined, { locale: uiLocale.current })}
            </div>
            <div class="notes"><MarkdownContent source={updater.body} /></div>
          </div>
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
    width: 13px;
    height: 13px;
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

  /* Renamed off `.badge` in v2: that is now a global label class in
     controls-v2.css, and its `padding: 0 var(--sp-15)` cascaded in under
     `box-sizing: border-box` and stretched this 7px dot into a 12px oval. */
  .dot {
    position: absolute;
    top: -1px;
    right: -1px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
  }

  /* Shell comes from `.popover` in controls-v2.css. Only placement, width
     and the local stacking level stay here. */
  .card {
    position: absolute;
    bottom: calc(100% + 8px);
    right: -4px;
    width: 216px;
    z-index: var(--z-toast);
    text-align: left;
    /*
     * Both hosts — EssayHome's .foot and EditorScreen's .statusbar — set
     * font-family: var(--mono) for the version readout they wrap around this
     * pill, and the popover inherited it. That set a plain sentence, and a
     * whole rendered changelog, in monospace. --mono is for machine values;
     * a popover is its own surface and states its own family. See
     * docs/design/DESIGN.md section 3.
     */
    font-family: var(--font);
    line-height: var(--lh-snug);
  }

  .notes-wrap {
    padding: var(--sp-2) var(--sp-3) var(--sp-3);
  }

  /* The all-caps label pattern: --w-medium at 0.09em, like .section and
     .select-group. Section 3 makes that tracking mandatory. */
  .head {
    font-size: var(--t-caption);
    font-weight: var(--w-medium);
    letter-spacing: 0.09em;
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
</style>

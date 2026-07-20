<script lang="ts">
  import type { FontChoice } from "$lib/model/essay";
  import { APA_FONT_ORDER, APA_FONTS } from "$lib/model/fonts";
  import { m } from "$lib/paraglide/messages";
  import { dismissable } from "$lib/actions/dismissable";

  interface Props {
    /** The essay's current document-wide font choice. */
    current: FontChoice;
    open: boolean;
    onToggle: () => void;
    onClose: () => void;
    onSelect: (font: FontChoice) => void;
  }

  let { current, open, onToggle, onClose, onSelect }: Props = $props();

  const serifFonts = APA_FONT_ORDER.filter((f) =>
    APA_FONTS[f].kind === "serif"
  );
  const sansFonts = APA_FONT_ORDER.filter((f) => APA_FONTS[f].kind === "sans");

  function apply(font: FontChoice) {
    onClose();
    onSelect(font);
  }
</script>

{#snippet fontItem(font: FontChoice)}
  <button
    class="mi"
    class:active={font === current}
    role="menuitem"
    onclick={() => apply(font)}
  >
    <span class="pv" style="font-family: {APA_FONTS[font].stack}">
      {APA_FONTS[font].family}
    </span>
    <span class="pt">{APA_FONTS[font].sizePt} pt</span>
  </button>
{/snippet}

<div class="menu-wrap" {@attach open && dismissable(onClose)}>
  <button
    class="fm-btn"
    class:on={open}
    onclick={onToggle}
    data-tip={m.tb_font()}
    aria-label={`${m.tb_font()}: ${APA_FONTS[current].family}`}
    aria-haspopup="menu"
    aria-expanded={open}
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
      <path d="M4 7V4h16v3M9 20h6M12 4v16" />
    </svg>
    <span class="fam fm-label">{APA_FONTS[current].family}</span>
    <svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M6 15l6-6 6 6" />
    </svg>
  </button>

  {#if open}
    <div class="menu-pop" role="menu">
      <span class="grp">{m.font_group_serif()}</span>
      {#each serifFonts as font (font)}
        {@render fontItem(font)}
      {/each}
      <span class="grp">{m.font_group_sans()}</span>
      {#each sansFonts as font (font)}
        {@render fontItem(font)}
      {/each}
    </div>
  {/if}
</div>

<style>
  .menu-wrap {
    position: relative;
    --pop-min-w: 230px;
  }

  /* Current family on the trigger; capped so long names can't stretch the bar. */
  .fam {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .caret {
    width: 12px;
    height: 12px;
    margin-left: -3px;
    opacity: 0.6;
  }

  .grp {
    padding: 7px 10px 3px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .mi {
    border: none;
    background: none;
    text-align: left;
    padding: 7px 10px;
    border-radius: var(--r-sm);
    cursor: pointer;
    color: var(--fg);
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
  }

  .mi:hover {
    background: var(--hover);
  }

  .mi.active {
    background: var(--accent-soft);
  }

  /* Each family previews itself, mirroring the sheets' rendering stack. */
  .pv {
    font-size: 14px;
    color: var(--fg);
    white-space: nowrap;
  }

  .pt {
    font-size: 11px;
    color: var(--muted);
  }
</style>

<script lang="ts">
  import type { Editor } from "@tiptap/core";
  import { m } from "$lib/paraglide/messages";
  import { dismissable } from "$lib/actions/dismissable";

  interface Props {
    editor: Editor | undefined;
    /** Heading level at the cursor, or null for body text. */
    activeLevel: number | null;
    open: boolean;
    onToggle: () => void;
    onClose: () => void;
  }

  let { editor, activeLevel, open, onToggle, onClose }: Props = $props();

  type Level = 1 | 2 | 3 | 4 | 5;
  const LEVELS: Level[] = [1, 2, 3, 4, 5];

  const LABELS: Record<Level, () => string> = {
    1: m.head_l1,
    2: m.head_l2,
    3: m.head_l3,
    4: m.head_l4,
    5: m.head_l5,
  };

  function apply(level: Level | null) {
    onClose();
    if (!editor) return;
    if (level === null) editor.chain().focus().setParagraph().run();
    else editor.chain().focus().toggleHeading({ level }).run();
  }
</script>

<div class="menu-wrap" {@attach open && dismissable(onClose)}>
  <button
    class="fm-btn"
    class:on={open}
    onclick={onToggle}
    disabled={!editor}
    data-tip={m.tb_headings()}
    aria-label={m.tb_headings()}
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
      <path d="M6 4v16M18 4v16M6 12h12" />
    </svg>
    <span class="fm-label">{m.tb_headings()}</span>
    <svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M6 15l6-6 6 6" />
    </svg>
  </button>

  {#if open}
    <div class="menu-pop" role="menu">
      <button
        class="mi"
        class:active={activeLevel === null}
        role="menuitem"
        onclick={() => apply(null)}
      >
        <span class="pv pv-normal">{m.head_normal()}</span>
      </button>
      {#each LEVELS as lvl (lvl)}
        <button
          class="mi"
          class:active={activeLevel === lvl}
          role="menuitem"
          onclick={() => apply(lvl)}
        >
          <span class="pv pv-h{lvl}">{LABELS[lvl]()}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .menu-wrap {
    position: relative;
    --pop-min-w: 220px;
  }

  .caret {
    width: 12px;
    height: 12px;
    margin-left: -3px;
    opacity: 0.6;
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
  }

  .mi:hover {
    background: var(--hover);
  }

  .mi.active {
    background: var(--accent-soft);
  }

  /* Style previews mirror the APA heading rules in apa.css. */
  .pv {
    font-family: var(--serif);
    font-size: 14px;
    color: var(--fg);
  }

  .pv-normal {
    font-family: var(--font);
    font-size: 13px;
    color: var(--fg-2);
  }

  .pv-h1 {
    font-weight: 700;
    width: 100%;
    text-align: center;
  }

  .pv-h2 {
    font-weight: 700;
  }

  .pv-h3 {
    font-weight: 700;
    font-style: italic;
  }

  .pv-h4 {
    font-weight: 700;
    padding-left: 18px;
  }

  .pv-h5 {
    font-weight: 700;
    font-style: italic;
    padding-left: 18px;
  }
</style>

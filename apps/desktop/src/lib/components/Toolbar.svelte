<script lang="ts">
  import type { Snippet } from "svelte";
  import { TOOLBAR_DOCKS, type ToolbarDock } from "$lib/state/toolbarDock";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    dock: ToolbarDock;
    onDockChange: (dock: ToolbarDock) => void;
    children: Snippet;
  }

  let { dock, onDockChange, children }: Props = $props();

  let open = $state(false);

  function label(option: ToolbarDock): string {
    if (option === "bottom") return m.toolbar_pos_bottom();
    if (option === "top") return m.toolbar_pos_top();
    if (option === "left") return m.toolbar_pos_left();
    return m.toolbar_pos_right();
  }

  function choose(next: ToolbarDock): void {
    open = false;
    onDockChange(next);
  }
</script>

<div class="float-menu" data-dock={dock}>
  {@render children()}
  <div class="fm-sep"></div>
  <div class="menu-wrap">
    <button
      class="fm-btn"
      data-tip={m.toolbar_position()}
      aria-label={m.toolbar_position()}
      aria-expanded={open}
      onclick={() => (open = !open)}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 16h18" />
      </svg>
      <span class="fm-label">{m.toolbar_position()}</span>
    </button>
    {#if open}
      <div class="menu-pop" role="menu">
        {#each TOOLBAR_DOCKS as option (option)}
          <button
            class="mi"
            class:active={dock === option}
            role="menuitem"
            onclick={() => choose(option)}
          >
            {label(option)}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  /*
   * .mi propio en lugar de reusar el de los otros menús: esos tres bloques no
   * son idénticos entre sí (HeadingMenu alinea por baseline para sus previews
   * de títulos), así que consolidarlos cambiaría su aspecto.
   */
  .mi {
    border: none;
    background: none;
    text-align: left;
    padding: 8px 10px;
    border-radius: var(--r-sm);
    cursor: pointer;
    color: var(--fg);
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .mi:hover {
    background: var(--hover);
  }

  .mi.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
</style>

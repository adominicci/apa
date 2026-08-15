<script module lang="ts">
  export interface SelectOption {
    value: string;
    label: string;
    /** Trailing metadata, e.g. a point size. */
    hint?: string;
    /** Render the label in this font stack, for font pickers. */
    preview?: string;
  }

  export interface SelectGroup {
    /** Empty string renders no header — use it for a flat list. */
    label: string;
    options: SelectOption[];
  }

  let selectCounter = 0;

  function nextSelectId(): number {
    selectCounter += 1;
    return selectCounter;
  }
</script>

<script lang="ts">
  import { tick } from "svelte";
  import { dismissable } from "$lib/dom/dismiss";

  interface Props {
    groups: SelectGroup[];
    value: string;
    onChange: (value: string) => void;
    /** Names the control for assistive tech when no visible label wraps it. */
    ariaLabel?: string;
    /** Shown on the trigger when `value` matches no option. */
    placeholder?: string;
    /** Inline, content-width trigger for a control that sits in a text row
     *  rather than stacked as a full-width form field. */
    compact?: boolean;
  }

  let {
    groups,
    value,
    onChange,
    ariaLabel,
    placeholder = "",
    compact = false,
  }: Props = $props();

  let open = $state(false);
  let activeIndex = $state(-1);
  let triggerElement = $state<HTMLButtonElement | null>(null);
  let listElement = $state<HTMLDivElement | null>(null);
  let typeahead = "";
  let typeaheadTimer: ReturnType<typeof setTimeout> | null = null;

  // A plain counter, not crypto.randomUUID(): this has to produce a stable id
  // under SSR and in the jsdom test environment, where randomUUID is absent.
  const listId = `select-list-${nextSelectId()}`;

  // Flattened options, so keyboard movement crosses group boundaries the way
  // a native select does instead of stopping at each header.
  const flat = $derived(groups.flatMap((g) => g.options));
  const selectedIndex = $derived(flat.findIndex((o) => o.value === value));
  const selected = $derived(selectedIndex >= 0 ? flat[selectedIndex] : null);

  function optionId(index: number): string {
    return `${listId}-opt-${index}`;
  }

  async function openList(startAt = selectedIndex): Promise<void> {
    open = true;
    activeIndex = startAt >= 0 ? startAt : 0;
    await tick();
    listElement?.focus();
    scrollActiveIntoView();
  }

  function closeList(refocus = true): void {
    open = false;
    activeIndex = -1;
    if (refocus) triggerElement?.focus();
  }

  function commit(index: number): void {
    const option = flat[index];
    if (!option) return;
    closeList();
    if (option.value !== value) onChange(option.value);
  }

  function scrollActiveIntoView(): void {
    if (activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView({
      block: "nearest",
    });
  }

  function move(delta: number): void {
    if (flat.length === 0) return;
    const next = Math.min(Math.max(activeIndex + delta, 0), flat.length - 1);
    activeIndex = next;
    scrollActiveIntoView();
  }

  /** Native selects jump to the first match as you type; keep that. */
  function matchTypeahead(key: string): boolean {
    if (key.length !== 1 || key === " ") return false;
    typeahead += key.toLowerCase();
    if (typeaheadTimer) clearTimeout(typeaheadTimer);
    typeaheadTimer = setTimeout(() => (typeahead = ""), 600);
    const hit = flat.findIndex((o) =>
      o.label.toLowerCase().startsWith(typeahead)
    );
    if (hit < 0) return false;
    activeIndex = hit;
    scrollActiveIntoView();
    return true;
  }

  function onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      void openList();
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      void openList(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      void openList(flat.length - 1);
    }
  }

  function onListKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        return;
      case "Home":
        event.preventDefault();
        activeIndex = 0;
        scrollActiveIntoView();
        return;
      case "End":
        event.preventDefault();
        activeIndex = flat.length - 1;
        scrollActiveIntoView();
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(activeIndex);
        return;
      case "Escape":
        event.preventDefault();
        closeList();
        return;
      case "Tab":
        // Let focus leave, but never leave an orphaned popup behind.
        closeList(false);
        return;
      default:
        if (matchTypeahead(event.key)) event.preventDefault();
    }
  }
</script>

<div
  class="select-wrap"
  class:is-compact={compact}
  {@attach open && dismissable(() => closeList(false))}
>
  <button
    bind:this={triggerElement}
    type="button"
    class="select-trigger"
    class:is-compact={compact}
    class:is-open={open}
    role="combobox"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls={listId}
    aria-label={ariaLabel}
    onclick={() => (open ? closeList() : void openList())}
    onkeydown={onTriggerKeydown}
  >
    <span
      class="select-value"
      class:is-placeholder={!selected}
      style={selected?.preview ? `font-family: ${selected.preview}` : undefined}
    >
      {selected ? selected.label : placeholder}
    </span>
    <svg
      class="select-caret"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <path d="M7 10l5 5 5-5" />
    </svg>
  </button>

  {#if open}
    <div
      bind:this={listElement}
      id={listId}
      class="select-pop"
      role="listbox"
      tabindex="-1"
      aria-label={ariaLabel}
      aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
      onkeydown={onListKeydown}
    >
      {#each groups as group (group.label)}
        {#if group.label !== ""}
          <span class="select-group">{group.label}</span>
        {/if}
        {#each group.options as option (option.value)}
          {@const index = flat.indexOf(option)}
          <!-- A button, not a div: focus stays on the listbox and moves by
               aria-activedescendant, but the native button keeps click and
               Enter/Space working without a hand-rolled key handler. -->
          <button
            id={optionId(index)}
            type="button"
            tabindex="-1"
            class="select-option"
            class:is-active={index === activeIndex}
            role="option"
            aria-selected={option.value === value}
            onclick={() => commit(index)}
            onmousemove={() => (activeIndex = index)}
          >
            <svg
              class="select-tick"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              aria-hidden="true"
            >
              {#if option.value === value}<path d="M5 13l4 4L19 7" />{/if}
            </svg>
            <span
              class="select-label"
              style={option.preview
                ? `font-family: ${option.preview}`
                : undefined}
            >{option.label}</span>
            {#if option.hint}<span class="select-hint">{option.hint}</span>{/if}
          </button>
        {/each}
      {/each}
    </div>
  {/if}
</div>

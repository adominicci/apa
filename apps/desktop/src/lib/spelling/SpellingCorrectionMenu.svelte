<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { ExperienceSpellingIssue } from "./controller";

  export type SpellingMenuAction =
    | { type: "replace"; suggestion: string }
    | { type: "ignore-once" }
    | { type: "ignore-document" }
    | { type: "add-personal" }
    | { type: "next" };

  interface Labels {
    menu: string;
    noSuggestions: string;
    ignoreOnce: string;
    ignoreDocument: string;
    addPersonal: string;
    next: string;
  }

  interface Props {
    issue: ExperienceSpellingIssue;
    labels: Labels;
    canAddDictionary: boolean;
    canNext: boolean;
    onAction: (action: SpellingMenuAction) => void;
    onClose: (direction: "restore" | "forward" | "backward") => void;
  }

  let {
    issue,
    labels,
    canAddDictionary,
    canNext,
    onAction,
    onClose,
  }: Props = $props();
  let menu = $state<HTMLElement>();
  let activeIndex = $state(0);

  const itemElements = () =>
    menu ? [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')] : [];

  function focusIndex(index: number) {
    const items = itemElements();
    if (items.length === 0) return;
    activeIndex = (index + items.length) % items.length;
    items[activeIndex]?.focus();
  }

  function activateCurrent() {
    const item = itemElements()[activeIndex];
    if (!item || item.getAttribute("aria-disabled") === "true") return;
    item.click();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (
      ![
        "ArrowDown",
        "ArrowUp",
        "Home",
        "End",
        "Enter",
        " ",
        "Escape",
        "Tab",
      ].includes(event.key)
    ) return;
    event.stopPropagation();
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusIndex(activeIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusIndex(activeIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        focusIndex(0);
        break;
      case "End":
        event.preventDefault();
        focusIndex(itemElements().length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        activateCurrent();
        break;
      case "Escape":
        event.preventDefault();
        onClose("restore");
        break;
      case "Tab":
        event.preventDefault();
        onClose(event.shiftKey ? "backward" : "forward");
        break;
    }
  }

  function activate(action: SpellingMenuAction, enabled = true) {
    if (enabled) onAction(action);
  }

  onMount(async () => {
    await tick();
    focusIndex(0);
  });
</script>

<div
  class="spelling-menu"
  role="menu"
  aria-label={labels.menu}
  tabindex="-1"
  bind:this={menu}
  onkeydown={handleKeydown}
>
  {#if issue.suggestions.length > 0}
    {#each issue.suggestions as suggestion (suggestion)}
      <button
        type="button"
        role="menuitem"
        tabindex="-1"
        onclick={() => activate({ type: "replace", suggestion })}
      >{suggestion}</button>
    {/each}
  {:else}
    <button type="button" role="menuitem" tabindex="-1" aria-disabled="true">
      {labels.noSuggestions}
    </button>
  {/if}
  <div role="separator"></div>
  <button
    type="button"
    role="menuitem"
    tabindex="-1"
    onclick={() => activate({ type: "ignore-once" })}
  >{labels.ignoreOnce}</button>
  <button
    type="button"
    role="menuitem"
    tabindex="-1"
    onclick={() => activate({ type: "ignore-document" })}
  >{labels.ignoreDocument}</button>
  <button
    type="button"
    role="menuitem"
    tabindex="-1"
    aria-disabled={!canAddDictionary}
    onclick={() => activate({ type: "add-personal" }, canAddDictionary)}
  >{labels.addPersonal}</button>
  <div role="separator"></div>
  <button
    type="button"
    role="menuitem"
    tabindex="-1"
    aria-disabled={!canNext}
    onclick={() => activate({ type: "next" }, canNext)}
  >{labels.next}</button>
</div>

<style>
  .spelling-menu {
    min-width: 15rem;
    padding: 0.35rem;
    border: 1px solid var(--border, #c9c7c2);
    border-radius: 0.55rem;
    background: var(--surface, #fff);
    box-shadow: 0 0.75rem 2rem rgb(0 0 0 / 18%);
  }

  button {
    display: block;
    width: 100%;
    padding: 0.48rem 0.6rem;
    border: 0;
    border-radius: 0.35rem;
    background: transparent;
    color: inherit;
    text-align: left;
  }

  button:focus-visible {
    outline: 2px solid var(--accent, #5d3fd3);
    outline-offset: -2px;
  }

  button[aria-disabled="true"] {
    opacity: 0.5;
  }

  [role="separator"] {
    height: 1px;
    margin: 0.3rem 0.25rem;
    background: var(--border, #dedbd4);
  }
</style>

<script lang="ts">
  import { onMount } from "svelte";
  import { VARIANT_LABELS, type VariantKey } from "./types";

  interface Props {
    current: VariantKey;
    onChange: (variant: VariantKey) => void;
  }

  let { current, onChange }: Props = $props();
  const variants: VariantKey[] = ["A", "B", "C"];

  function cycle(direction: -1 | 1): void {
    const index = variants.indexOf(current);
    onChange(variants[(index + direction + variants.length) % variants.length]);
  }

  onMount(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.matches("input, textarea, select, [contenteditable='true']")
      ) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        cycle(-1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        cycle(1);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });
</script>

<nav class="prototype-switcher" aria-label="Prototype variants">
  <button type="button" onclick={() => cycle(-1)} aria-label="Previous variant">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
  </button>
  <div>
    <span>Throwaway prototype</span>
    <strong>{current} · {VARIANT_LABELS[current]}</strong>
  </div>
  <button type="button" onclick={() => cycle(1)} aria-label="Next variant">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
  </button>
</nav>

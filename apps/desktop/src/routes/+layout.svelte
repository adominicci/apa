<script lang="ts">
  // Inter is self-hosted via an @font-face in tokens.css (static/fonts) — no
  // npm-font import here, which was flaky under Deno's node_modules. See CLAUDE.md.
  import "$lib/styles/tokens.css";
  import type { Snippet } from "svelte";
  import { uiLocale } from "$lib/state/uiLocale.svelte";

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();

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

{@render children()}

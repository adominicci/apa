<script lang="ts">
  // Inter's @font-face is embedded (base64) in the static document head
  // (app.html), NOT imported here — a Vite-processed @font-face kept getting
  // dropped in dev (WKWebView HMR + dev-server url() 404s). See AGENTS.md.
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

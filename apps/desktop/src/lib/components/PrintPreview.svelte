<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import type { Reference } from "@tesina/engine";
  import type { Essay } from "$lib/model/essay";
  import {
    renderEssayCss,
    renderEssayHtml,
  } from "$lib/preview/renderEssayHtml";

  interface Props {
    essay: Essay;
    docJson: unknown;
    references: Reference[];
    onPageCount?: (pages: number) => void;
  }

  let { essay, docJson, references, onPageCount }: Props = $props();

  let rendering = $state(true);
  let error = $state("");

  const paginate: Attachment<HTMLDivElement> = (container) => {
    let cancelled = false;
    let styleUrl = "";

    (async () => {
      try {
        const { Previewer } = await import("pagedjs");
        if (cancelled) return;
        const html = renderEssayHtml(essay, docJson, references);
        const css = renderEssayCss(essay.settings);
        styleUrl = URL.createObjectURL(
          new Blob([css], { type: "text/css" }),
        );
        const previewer = new Previewer();
        const flow = await previewer.preview(html, [styleUrl], container);
        if (!cancelled) {
          rendering = false;
          onPageCount?.(flow.total);
        }
      } catch (err) {
        console.error("No se pudo paginar la vista previa:", err);
        if (!cancelled) {
          rendering = false;
          error = "No se pudo generar la vista previa.";
        }
      }
    })();

    return () => {
      cancelled = true;
      if (styleUrl) URL.revokeObjectURL(styleUrl);
    };
  };
</script>

<div class="preview-wrap">
  {#if rendering}
    <p class="msg">Paginando…</p>
  {/if}
  {#if error}
    <p class="msg error">{error}</p>
  {/if}
  <div class="pages" {@attach paginate}></div>
</div>

<style>
  .preview-wrap {
    padding: 1.5rem 1rem 3rem;
  }

  .msg {
    text-align: center;
    color: #8a887f;
    font-size: 0.85rem;
  }

  .msg.error {
    color: #a32d2d;
  }

  .pages :global(.pagedjs_page) {
    background: #fff;
    margin: 0 auto 1.25rem;
    box-shadow: 0 1px 5px rgba(0, 0, 0, 0.15);
  }

  @media print {
    .preview-wrap {
      padding: 0;
    }

    .pages :global(.pagedjs_page) {
      box-shadow: none;
      margin: 0;
    }
  }
</style>

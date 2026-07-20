<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import type { Reference } from "@tesina/engine";
  import type { Essay } from "$lib/model/essay";
  import {
    renderEssayCss,
    renderEssayHtml,
  } from "$lib/preview/renderEssayHtml";
  import { imageObjectUrl } from "$lib/persist/assets";
  import { latexToMathml } from "$lib/editor/mathml";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    essay: Essay;
    docJson: unknown;
    references: Reference[];
    onPageCount?: (pages: number) => void;
  }

  let { essay, docJson, references, onPageCount }: Props = $props();

  /** Collects every figure image path in the doc. */
  function figureSrcs(node: unknown, out: Set<string>): void {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; attrs?: { src?: string };
      content?: unknown[]; };
    if (n.type === "figureImage" && n.attrs?.src) out.add(n.attrs.src);
    for (const child of n.content ?? []) figureSrcs(child, out);
  }

  /** Collects every block equation's LaTeX source in the doc. */
  function equationLatexes(node: unknown, out: Set<string>): void {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; attrs?: { latex?: string };
      content?: unknown[]; };
    if (n.type === "apaEquation" && n.attrs?.latex) out.add(n.attrs.latex);
    for (const child of n.content ?? []) equationLatexes(child, out);
  }

  let rendering = $state(true);
  let error = $state("");

  const paginate: Attachment<HTMLDivElement> = (container) => {
    let cancelled = false;
    let styleUrl = "";
    const objectUrls: string[] = [];

    (async () => {
      try {
        const { Previewer } = await import("pagedjs");
        if (cancelled) return;
        const srcs = new Set<string>();
        figureSrcs(docJson, srcs);
        const imageUrls = new Map<string, string>();
        for (const src of srcs) {
          try {
            const url = await imageObjectUrl(src);
            objectUrls.push(url);
            imageUrls.set(src, url);
          } catch {
            // Missing asset — skip; the figure renders without an image.
          }
        }
        const latexes = new Set<string>();
        equationLatexes(docJson, latexes);
        const mathml = new Map<string, string>();
        for (const latex of latexes) {
          try {
            mathml.set(latex, latexToMathml(latex));
          } catch {
            // Malformed LaTeX — skip; the equation renders with just its
            // number, same graceful degradation as a missing figure asset.
          }
        }
        if (cancelled) return;
        const html = renderEssayHtml(
          essay,
          docJson,
          references,
          imageUrls,
          mathml,
        );
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
          error = m.preview_error();
        }
      }
    })();

    return () => {
      cancelled = true;
      if (styleUrl) URL.revokeObjectURL(styleUrl);
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  };
</script>

<div class="preview-wrap">
  {#if rendering}
    <p class="msg">{m.preview_paginating()}</p>
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
    color: var(--muted);
    font-size: 0.85rem;
  }

  .msg.error {
    color: var(--danger);
  }

  .pages :global(.pagedjs_page) {
    /* Always white, in both themes — see --paper-print in tokens.css. */
    background: var(--paper-print);
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

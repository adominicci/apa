<script lang="ts">
  import DOMPurify from "dompurify";
  import { Marked } from "marked";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import type { Attachment } from "svelte/attachments";
  import { on } from "svelte/events";

  interface Props {
    source: string;
  }

  let { source }: Props = $props();

  const allowedTags = [
    "a",
    "br",
    "code",
    "em",
    "h4",
    "h5",
    "h6",
    "li",
    "ol",
    "p",
    "strong",
    "ul",
  ];
  const parser = new Marked({
    async: false,
    breaks: false,
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const level = Math.min(6, depth + 3);
        return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>`;
      },
      image({ text }) {
        return escapeHtml(text);
      },
    },
  });

  function escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function safeHttpsUrl(value: string | null): string | null {
    if (!value || value.startsWith("//")) return null;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" ? parsed.href : null;
    } catch {
      return null;
    }
  }

  function readableFallback(value: string): string {
    return `<p>${escapeHtml(value)}</p>`;
  }

  function renderMarkdown(value: string): string {
    let parsed: string;
    try {
      parsed = parser.parse(value, { async: false });
    } catch {
      parsed = readableFallback(value);
    }

    if (!DOMPurify.isSupported) return readableFallback(value);

    const clean = DOMPurify.sanitize(parsed, {
      ALLOWED_TAGS: allowedTags,
      ALLOWED_ATTR: ["href"],
      ALLOW_ARIA_ATTR: false,
      ALLOW_DATA_ATTR: false,
      FORBID_ATTR: ["style"],
      RETURN_DOM: false,
      RETURN_DOM_FRAGMENT: false,
      RETURN_TRUSTED_TYPE: false,
    });
    const template = document.createElement("template");
    template.innerHTML = clean;
    for (const link of template.content.querySelectorAll("a")) {
      const destination = safeHttpsUrl(link.getAttribute("href"));
      if (destination) link.setAttribute("href", destination);
      else link.removeAttribute("href");
    }
    return template.innerHTML;
  }

  function activateLink(event: MouseEvent) {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>("a")
      : null;
    if (!target || !(event.currentTarget instanceof Element)) return;
    if (!event.currentTarget.contains(target)) return;

    event.preventDefault();
    const destination = safeHttpsUrl(target.getAttribute("href"));
    if (!destination) return;
    void openUrl(destination).catch((error: unknown) => {
      console.error("Could not open the release-note link:", error);
    });
  }

  const delegateLinkActivation: Attachment<HTMLElement> = (node) =>
    on(node, "click", activateLink);

  const rendered = $derived(renderMarkdown(source));
  const insertSanitizedHtml: Attachment<HTMLElement> = (node) => {
    node.innerHTML = rendered;
    return () => node.replaceChildren();
  };
</script>

<article
  class="markdown-content"
  {@attach insertSanitizedHtml}
  {@attach delegateLinkActivation}
></article>

<style>
  .markdown-content {
    min-width: 0;
    color: var(--fg-2);
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  .markdown-content :global(:first-child) {
    margin-top: 0;
  }

  .markdown-content :global(:last-child) {
    margin-bottom: 0;
  }

  .markdown-content :global(h4),
  .markdown-content :global(h5),
  .markdown-content :global(h6) {
    color: var(--fg);
    line-height: 1.3;
    margin: 1.25em 0 0.45em;
    font-weight: 600;
  }

  .markdown-content :global(h4) {
    font-size: var(--t-h3);
  }

  .markdown-content :global(h5),
  .markdown-content :global(h6) {
    font-size: var(--t-h3);
  }

  .markdown-content :global(p) {
    margin: 0 0 0.85em;
  }

  .markdown-content :global(ol),
  .markdown-content :global(ul) {
    box-sizing: border-box;
    margin: 0 0 0.9em;
    padding-inline-start: 1.5rem;
  }

  .markdown-content :global(li + li) {
    margin-top: 0.3em;
  }

  .markdown-content :global(code) {
    max-width: 100%;
    padding: 0.12em 0.35em;
    border-radius: 4px;
    background: var(--hover);
    color: var(--fg);
    font-family: var(--mono);
    font-size: 0.92em;
    white-space: break-spaces;
  }

  .markdown-content :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .markdown-content :global(a:not([href])) {
    color: inherit;
    text-decoration: none;
  }
</style>

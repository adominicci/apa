/**
 * Runs Paged.js in the current webview and returns a standalone document.
 *
 * The hidden webview that prints the PDF gets **static** markup — page boxes
 * already laid out, no scripts, no module graph. That is deliberate: shipping
 * Paged.js into a second webview would mean bundling and serving it there, and
 * the printing webview would have to run and settle a layout engine before it
 * could be trusted. Paginating here reuses the engine the Print preview already
 * loads, and reduces the print step to what the spike proved works: load static
 * HTML, wait for fonts, print.
 */

export interface PaginatedDocument {
  html: string;
  pages: number;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Paged.js writes its computed rules into `<style>` elements it appends to the
 * document head, not into the container. Dropping them would strip every page
 * box, margin box and running header from the printed output, so they are
 * collected and carried into the standalone document.
 */
function collectInsertedStyles(before: ReadonlySet<Element>): string {
  return [...document.head.querySelectorAll("style")]
    .filter((element) => !before.has(element))
    .map((element) => element.textContent ?? "")
    .join("\n");
}

export async function paginateForPrint(
  contentHtml: string,
  css: string,
): Promise<PaginatedDocument> {
  const { Previewer } = await import("pagedjs");

  const styleUrl = URL.createObjectURL(new Blob([css], { type: "text/css" }));
  // Off-screen rather than `display: none`: Paged.js measures real boxes, and a
  // display:none subtree has no layout to measure.
  const container = document.createElement("div");
  container.setAttribute("aria-hidden", "true");
  container.style.cssText =
    "position:absolute;left:-100000px;top:0;width:0;height:0;overflow:hidden";
  document.body.appendChild(container);
  const stylesBefore = new Set(document.head.querySelectorAll("style"));

  try {
    const previewer = new Previewer();
    const flow = await previewer.preview(contentHtml, [styleUrl], container);
    const inserted = collectInsertedStyles(stylesBefore);

    const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>${css}</style>
<style>${inserted}</style>
</head>
<body class="pagedjs_root">${container.innerHTML}</body></html>`;

    return { html, pages: flow.total };
  } finally {
    container.remove();
    URL.revokeObjectURL(styleUrl);
    // Paged.js's styles are global; leaving them behind would restyle the app.
    for (const element of document.head.querySelectorAll("style")) {
      if (!stylesBefore.has(element)) element.remove();
    }
  }
}

/** Wraps a failure so the caller can surface it without leaking internals. */
export function printDocumentError(error: unknown): string {
  return error instanceof Error ? error.message : escapeHtml(String(error));
}

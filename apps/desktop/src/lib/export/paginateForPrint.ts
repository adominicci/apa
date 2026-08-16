import type { Previewer as PagedPreviewer } from "pagedjs";

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

/**
 * Paged.js writes its computed rules into `<style>` elements it appends to the
 * document head, not into the container. Dropping them would strip every page
 * box, margin box and running header from the printed output, so they are
 * collected and carried into the standalone document.
 *
 * The polisher is read directly rather than diffing `document.head`: a diff
 * would also scoop up unrelated styles other code appended while pagination
 * awaited, and it would miss the runtime counter rules Paged.js inserts
 * through the CSSOM, which never appear in any element's textContent.
 */
function collectPreviewerStyles(previewer: PagedPreviewer): string {
  const { base, styleSheet, inserted } = previewer.polisher;
  const parts: string[] = [];
  for (const element of inserted) {
    parts.push(element.textContent ?? "");
    // The CSSOM sheet sits right after the base styles in document order;
    // keep that cascade order in the standalone document.
    if (element === base && styleSheet) {
      parts.push(
        [...styleSheet.cssRules].map((rule) => rule.cssText).join("\n"),
      );
    }
  }
  return parts.join("\n");
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
  const previewer = new Previewer();

  try {
    const flow = await previewer.preview(contentHtml, [styleUrl], container);

    const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>${css}</style>
<style>${collectPreviewerStyles(previewer)}</style>
<style>
/* The page boxes above are already full pages. The raw @page margin in the
   first sheet would inset them a second time in the print pipeline, and the
   default body margin would shift every box. */
html, body { margin: 0; padding: 0; }
@page { margin: 0; }
</style>
</head>
<body class="pagedjs_root">${container.innerHTML}</body></html>`;

    return { html, pages: flow.total };
  } finally {
    container.remove();
    URL.revokeObjectURL(styleUrl);
    // Paged.js's styles are global; leaving them behind would restyle the
    // app. Remove exactly what this Previewer inserted — a `document.head`
    // sweep would also delete styles other code added while pagination ran.
    if (previewer.polisher.styleSheet) previewer.polisher.destroy();
  }
}

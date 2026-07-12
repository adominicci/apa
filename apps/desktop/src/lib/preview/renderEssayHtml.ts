import {
  buildReferenceList,
  formatCitation,
  getTerms,
  type Reference,
  type RichRun,
} from "@tesina/engine";
import type { CitationAttrs, DocLocale } from "@tesina/engine";
import {
  buildDocContext,
  type DocContext,
  type PMJson,
} from "@tesina/docx-export";
import type { Essay } from "$lib/model/essay";

/**
 * Pure assembly of the whole essay as print-ready HTML + CSS for Paged.js.
 * Mirrors the DOCX exporter's structure (same engine calls, same section
 * order) so the preview and the exported file cannot disagree on content.
 */

function esc(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function runsToHtml(runs: readonly RichRun[]): string {
  return runs
    .map((r) => (r.italic ? `<em>${esc(r.text)}</em>` : esc(r.text)))
    .join("");
}

function isoToLongDate(iso: string, locale: DocLocale): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  return getTerms(locale).formatLongDate({
    year: Number.parseInt(match[1]!, 10),
    month: Number.parseInt(match[2]!, 10),
    day: Number.parseInt(match[3]!, 10),
  });
}

interface RenderState {
  ctx: DocContext;
  counter: { next: number };
  tableNo: { n: number };
  figureNo: { n: number };
  /** Maps a figure's relative asset path to a resolved blob/object URL. */
  imageUrls: Map<string, string>;
}

function inlineHtml(inline: readonly PMJson[], state: RenderState): string {
  let out = "";
  for (const node of inline) {
    if (node.type === "text" && typeof node.text === "string") {
      let text = esc(node.text);
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") text = `<strong>${text}</strong>`;
        if (mark.type === "italic") text = `<em>${text}</em>`;
        if (mark.type === "underline") text = `<u>${text}</u>`;
      }
      out += text;
    } else if (node.type === "citation" && node.attrs) {
      const attrs = node.attrs as unknown as CitationAttrs;
      const index = state.counter.next;
      state.counter.next += 1;
      const firstOccurrenceRefIds = new Set(
        attrs.items
          .map((item) => item.refId)
          .filter(
            (refId) => state.ctx.firstOccurrenceIndex.get(refId) === index,
          ),
      );
      out += runsToHtml(
        formatCitation(
          attrs,
          state.ctx.citationCtx,
          state.ctx.refsById,
          state.ctx.locale,
          {
            firstOccurrenceRefIds,
          },
        ),
      );
    } else if (node.type === "hardBreak") {
      out += "<br />";
    }
  }
  return out;
}

/** Renders an APA table figure: "Table N" caption, italic title, grid, note. */
function apaTableHtml(block: PMJson, state: RenderState): string {
  state.tableNo.n += 1;
  const t = getTerms(state.ctx.locale);
  const children = block.content ?? [];
  const titleNode = children.find((c) => c.type === "tableTitle");
  const tableNode = children.find((c) => c.type === "table");
  const noteNode = children.find((c) => c.type === "tableNote");

  let out = `<figure class="apa-table"><p class="tbl-cap">${
    esc(t.headings.table)
  } ${state.tableNo.n}<br /><em>${
    titleNode ? inlineHtml(titleNode.content ?? [], state) : ""
  }</em></p>`;

  out += "<table>";
  for (const rowNode of tableNode?.content ?? []) {
    out += "<tr>";
    for (const cellNode of rowNode.content ?? []) {
      const tag = cellNode.type === "tableHeader" ? "th" : "td";
      let inner = "";
      for (const child of cellNode.content ?? []) {
        inner += inlineHtml(child.content ?? [], state);
      }
      out += `<${tag}>${inner}</${tag}>`;
    }
    out += "</tr>";
  }
  out += "</table>";

  const note = noteNode ? inlineHtml(noteNode.content ?? [], state) : "";
  if (note.trim() !== "") {
    out += `<p class="tbl-note"><em>${esc(t.headings.note)}</em> ${note}</p>`;
  }
  return `${out}</figure>`;
}

/** Renders an APA figure: "Figure N" caption, italic title, image, note. */
function apaFigureHtml(block: PMJson, state: RenderState): string {
  state.figureNo.n += 1;
  const t = getTerms(state.ctx.locale);
  const children = block.content ?? [];
  const titleNode = children.find((c) => c.type === "figureTitle");
  const imageNode = children.find((c) => c.type === "figureImage");
  const noteNode = children.find((c) => c.type === "figureNote");

  let out = `<figure class="apa-figure"><p class="fig-cap">${
    esc(t.headings.figure)
  } ${state.figureNo.n}<br /><em>${
    titleNode ? inlineHtml(titleNode.content ?? [], state) : ""
  }</em></p>`;

  const src = imageNode?.attrs?.["src"] as string | undefined;
  const url = src ? state.imageUrls.get(src) : undefined;
  if (url) out += `<img class="fig-img" src="${esc(url)}" alt="" />`;

  const note = noteNode ? inlineHtml(noteNode.content ?? [], state) : "";
  if (note.trim() !== "") {
    out += `<p class="fig-note"><em>${esc(t.headings.note)}</em> ${note}</p>`;
  }
  return `${out}</figure>`;
}

/** Renders a list and its nested sublists (APA lettered lists use type="a"). */
function listHtml(block: PMJson, state: RenderState): string {
  const ordered = block.type === "orderedList";
  const tag = ordered ? "ol" : "ul";
  const typeAttr = ordered && block.attrs?.["listStyle"] === "lower-alpha"
    ? ' type="a"'
    : "";
  let out = `<${tag}${typeAttr}>`;
  for (const item of block.content ?? []) {
    out += "<li>";
    for (const child of item.content ?? []) {
      if (child.type === "bulletList" || child.type === "orderedList") {
        out += listHtml(child, state);
      } else {
        out += inlineHtml(child.content ?? [], state);
      }
    }
    out += "</li>";
  }
  out += `</${tag}>`;
  return out;
}

function blocksHtml(
  blocks: readonly PMJson[],
  state: RenderState,
  firstParagraphClass = "",
): string {
  let out = "";
  let first = true;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.type === "paragraph") {
      const cls = first && firstParagraphClass
        ? ` class="${firstParagraphClass}"`
        : "";
      out += `<p${cls}>${inlineHtml(block.content ?? [], state)}</p>`;
    } else if (block.type === "heading") {
      const level = Number(block.attrs?.["level"] ?? 1);
      if (level >= 4) {
        const text = inlineHtml(block.content ?? [], state).replace(
          /\.?\s*$/,
          "",
        );
        const open = level === 5 ? "<strong><em>" : "<strong>";
        const close = level === 5 ? "</em></strong>" : "</strong>";
        const next = blocks[i + 1];
        if (next?.type === "paragraph") {
          i += 1;
          out += `<p>${open}${text}. ${close}${
            inlineHtml(next.content ?? [], state)
          }</p>`;
        } else {
          out += `<p>${open}${text}. ${close}</p>`;
        }
      } else {
        out += `<h${level}>${
          inlineHtml(block.content ?? [], state)
        }</h${level}>`;
      }
    } else if (block.type === "blockquote") {
      out += "<blockquote>";
      for (const child of block.content ?? []) {
        out += `<p>${inlineHtml(child.content ?? [], state)}</p>`;
      }
      out += "</blockquote>";
    } else if (block.type === "bulletList" || block.type === "orderedList") {
      out += listHtml(block, state);
    } else if (block.type === "apaTable") {
      out += apaTableHtml(block, state);
    } else if (block.type === "figure") {
      out += apaFigureHtml(block, state);
    } else if (block.type === "keywordsLine") {
      const t = getTerms(state.ctx.locale);
      out += `<p class="keywords"><em>${esc(t.headings.keywords)}</em> ${
        inlineHtml(block.content ?? [], state)
      }</p>`;
    }
    first = false;
  }
  return out;
}

const FONT_CSS: Record<Essay["settings"]["font"], string> = {
  "times-new-roman-12": `"Times New Roman", Georgia, serif; font-size: 12pt`,
  "calibri-11": `Calibri, "Segoe UI", sans-serif; font-size: 11pt`,
  "arial-11": `Arial, Helvetica, sans-serif; font-size: 11pt`,
};

export function renderEssayCss(settings: Essay["settings"]): string {
  const size = settings.paperSize === "a4" ? "A4" : "letter";
  const topLeft = settings.variant === "professional"
    ? `@top-left { content: string(runhead); font-family: ${
      FONT_CSS[settings.font]
    }; }`
    : "";
  return `
@page {
  size: ${size};
  margin: 1in;
  @top-right { content: counter(page); font-family: ${
    FONT_CSS[settings.font]
  }; }
  ${topLeft}
}
body { font-family: ${
    FONT_CSS[settings.font]
  }; line-height: 2; color: #131313; }
p { margin: 0; text-indent: 0.5in; }
p.no-indent { text-indent: 0; }
p.keywords { text-indent: 0.5in; }
h1, h2, h3 { font-size: 1em; margin: 0; font-weight: bold; }
h1 { text-align: center; }
h3 { font-style: italic; }
blockquote { margin: 0 0 0 0.5in; }
blockquote p { text-indent: 0; }
ul, ol { margin: 0; padding-left: 1in; }
.title-page { text-align: center; break-after: page; }
.title-page .spacer { height: 6em; }
.title-page .tp-title { font-weight: bold; }
.title-page p { text-indent: 0; }
.rh-set { string-set: runhead content(text); display: none; }
section.abstract, section.appendix, section.references { break-before: page; }
.ref-entry { padding-left: 0.5in; text-indent: -0.5in; }
.apa-table { margin: 1em 0; break-inside: avoid; }
.apa-table .tbl-cap { text-indent: 0; }
.apa-table table { border-collapse: collapse; width: 100%; border-top: 1px solid #131313; border-bottom: 1px solid #131313; }
.apa-table th, .apa-table td { padding: 3px 8px; text-align: left; vertical-align: top; }
.apa-table th { border-bottom: 1px solid #131313; font-weight: normal; }
.apa-table .tbl-note { text-indent: 0; }
.apa-figure { margin: 1em 0; break-inside: avoid; text-align: center; }
.apa-figure .fig-cap { text-indent: 0; text-align: left; }
.apa-figure .fig-img { max-width: 100%; height: auto; }
.apa-figure .fig-note { text-indent: 0; text-align: left; }
`;
}

export function renderEssayHtml(
  essay: Essay,
  docJson: unknown,
  references: Reference[],
  imageUrls: Map<string, string> = new Map(),
): string {
  const locale = essay.settings.documentLanguage;
  const t = getTerms(locale);
  const ctx = buildDocContext(docJson as PMJson, references, locale);
  const state: RenderState = {
    ctx,
    counter: { next: 0 },
    tableNo: { n: 0 },
    figureNo: { n: 0 },
    imageUrls,
  };
  const { titlePage } = essay;

  let html = "";
  if (essay.settings.variant === "professional") {
    const head = (essay.settings.runningHead ?? titlePage.title)
      .toUpperCase()
      .slice(0, 50);
    html += `<span class="rh-set">${esc(head)}</span>`;
  }

  html += `<div class="title-page"><div class="spacer"></div>`;
  html += `<p class="tp-title">${esc(titlePage.title)}</p><p>&nbsp;</p>`;
  for (const author of titlePage.authors) html += `<p>${esc(author)}</p>`;
  for (const aff of titlePage.affiliations) html += `<p>${esc(aff)}</p>`;
  if (titlePage.course) html += `<p>${esc(titlePage.course)}</p>`;
  if (titlePage.instructor) html += `<p>${esc(titlePage.instructor)}</p>`;
  if (titlePage.dueDate) {
    html += `<p>${esc(isoToLongDate(titlePage.dueDate, locale))}</p>`;
  }
  html += `</div>`;

  const doc = docJson as PMJson;
  for (const section of doc.content ?? []) {
    if (section.type === "sectionAbstract") {
      html += `<section class="abstract"><h1>${esc(t.headings.abstract)}</h1>`;
      html += blocksHtml(section.content ?? [], state, "no-indent");
      html += "</section>";
    } else if (section.type === "sectionBody") {
      html += `<section class="body-sec">`;
      html += blocksHtml(section.content ?? [], state);
      html += "</section>";
    } else if (section.type === "sectionAppendix") {
      html += `<section class="appendix">`;
      html += blocksHtml(section.content ?? [], state);
      html += "</section>";
    }
  }

  // Appendix headings with computed letters (only when 2+, APA 2.14).
  const appendices = (doc.content ?? []).filter(
    (s) => s.type === "sectionAppendix",
  ).length;
  if (appendices > 0) {
    let index = 0;
    html = html.replaceAll('<section class="appendix">', () => {
      index += 1;
      const letter = appendices > 1
        ? ` ${String.fromCharCode(64 + index)}`
        : "";
      return `<section class="appendix"><h1>${
        esc(t.headings.appendix)
      }${letter}</h1>`;
    });
  }

  if (references.length > 0) {
    const { entries } = buildReferenceList(references, locale);
    html += `<section class="references"><h1>${
      esc(t.headings.references)
    }</h1>`;
    for (const entry of entries) {
      html += `<p class="ref-entry">${runsToHtml(entry.runs)}</p>`;
    }
    html += "</section>";
  }

  return html;
}

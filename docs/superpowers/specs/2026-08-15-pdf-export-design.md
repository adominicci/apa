# PDF export design

Date: 2026-08-15
Status: proposed — awaiting review
Applies to: `apps/desktop`

## Problem

Export produces a `.docx` and nothing else. Students are routinely asked to
submit PDF, and a Word file converted by a third party is where APA layout goes
wrong. Tesina should hand the student the exact pages it already shows them.

## Decision

**PDF is rendered from the existing Paged.js print preview.** No new PDF
writer package.

`renderEssayHtml.ts` already assembles the whole essay as print-ready HTML plus
CSS, drives Paged.js in `PrintPreview.svelte`, and carries a `@page` rule keyed
off `essay.settings.paperSize` (`renderEssayHtml.ts:318`). The pages a student
sees in Print preview are the pages we want in the PDF. Printing that same
document is the shortest correct path.

### Why not a pure `@tesina/pdf-export` package

Attractive on paper — it would mirror `@tesina/docx-export` and be unit-testable
without a webview. Rejected because:

- AGENTS.md already requires block behavior to stay aligned across schema,
  editor CSS, HTML preview, and DOCX export. A PDF writer makes that a
  four-way sync, and the fourth renderer would be the only one reimplementing
  line breaking, widow/orphan control, and page-gap math from scratch.
- Paged.js already solves pagination correctly and is proven in CI against a
  50-page fixture.
- The cost is months, and the failure mode is silent APA drift between what the
  student previewed and what they submitted.

Revisit only if the print path proves unable to hit a hard requirement.

## Architecture

### What exists

```
renderEssayHtml.ts  (pure)   →  HTML + CSS  →  PrintPreview.svelte  →  Paged.js
createStudentExportSnapshot  →  detached essay/doc/references snapshot
exportEssay.ts               →  DOCX bytes  →  save() dialog  →  writeFile
```

### What gets added

```
exportEssayToPdf(essay, doc, references)
  ├── renderEssayHtml + renderEssayCss        (reused, same snapshot as DOCX)
  ├── inline figure images as data URLs       (new: self-contained document)
  ├── invoke("export_pdf_from_html", { html }) (new Rust command → Vec<u8>)
  └── save() dialog + writeFile               (reused, same ExportOutcome union)
```

The Rust command opens a hidden `WebviewWindow`, loads the self-contained HTML,
waits for Paged.js to signal completion, calls the platform print-to-PDF API,
and returns the bytes.

### Boundaries

- `renderEssayHtml.ts` stays pure and gains **no** PDF knowledge. It already
  produces what is needed.
- The image-inlining step is app-layer, not engine-layer: it touches the
  filesystem through `$lib/persist/assets`, which pure packages must not do.
- The Rust command takes HTML and returns bytes. It knows nothing about APA,
  essays, or references. That keeps it testable and keeps the contract narrow.
- `ExportOutcome` (`saved` / `cancelled` / `error`) is reused verbatim so the
  UI handles both formats through one code path.

### Why the preview cannot be printed directly

`PrintPreview.svelte` renders figures as **object URLs** bound to the live
window, and the preview only exists while the user has it open. The PDF path
needs a document that stands alone: same HTML, but with figures inlined as data
URLs. This is the one genuinely new piece of rendering work.

## The open question — spike this first

**Does `with_webview` + the platform print-to-PDF API return bytes for a loaded
HTML document?**

- Tauri v2 exposes `WebviewWindow::with_webview()` to reach the platform handle.
- macOS: `WKWebView.createPDF(configuration:completionHandler:)`, macOS 11+.
  The app targets macOS 12+, so this is available.
- Windows: `ICoreWebView2_7::PrintToPdf`.

Each of these is documented for its platform, but none of it is wired up in this
repo today and the Tauri-side ergonomics are unverified. **Timebox a spike
before committing to the rest of the plan.**

Fallback if the spike fails: `window.print()` from a dedicated print route. It
costs almost no code and the fidelity is identical, because it is the same
engine — but it routes the student through the OS print panel instead of a
Tesina save dialog. Worse UX, not worse output.

## Fonts — correction and real constraint

An earlier note in conversation said the repo self-hosts its fonts. That is
**wrong** and worth stating plainly, because it changes what PDF can promise.

Only **Inter** is bundled (`static/fonts/inter-latin-variable.woff2`), and it is
chrome-only. The seven APA document fonts resolve from the operating system
through the CSS stacks in `$lib/model/fonts.ts`:

- macOS supplies Times New Roman and Georgia.
- Calibri and Aptos are Microsoft fonts and are frequently absent on macOS.
- Computer Modern is usually absent; the stack falls back to Georgia.

The preview already falls back this way today. The PDF will inherit exactly the
same substitution, which yields a clean and defensible contract:

> **The PDF matches the Print preview, byte for byte in layout.**
> It does not promise to match the DOCX opened in Word.

Do not let the PDF work quietly become a font-licensing project. Bundling
Latin Modern (OFL, permitted by the AGENTS.md license policy) would fix
Computer Modern and is a reasonable **separate** change. Times New Roman,
Calibri, and Aptos are proprietary and cannot be bundled at all.

## UI

The Export button becomes a two-item menu: **Word (.docx)** and **PDF**.

Both formats route through the advisory title-page dialog shipped in v0.1.8 —
`studentTitlePageWarnings` is format-agnostic, so PDF gets the same "advise,
never block" behavior for free. Unresolved citations still block both.

New Paraglide keys (both `en` and `es`, per the two-axis i18n rule; these are
chrome strings and use the UI locale):

- `editor_export_docx`, `editor_export_pdf`
- `editor_exporting_pdf`, `editor_exported_pdf`
- `editor_export_pdf_error`

## Testing

Proportional to risk, smallest useful check first:

- **Pure render** — `renderEssayHtml.test.ts` already has golden snapshots. Add
  one covering the self-contained variant, asserting that figures arrive as
  data URLs and that no object URL survives.
- **Export adapter** — unit test that the PDF path consumes the same detached
  snapshot as DOCX and returns the same `ExportOutcome` shape, with the Rust
  command mocked.
- **Component** — extend the `EditorScreen` suite: the menu offers both formats,
  each calls its own exporter once, and the title-page advice fires for PDF
  exactly as it does for DOCX.
- **Rust** — unit test the command's error mapping (bad HTML, webview failure).
  Do not attempt to assert PDF bytes; the existing native-proof harness is the
  precedent for anything needing a real webview.

## Risks

1. **The spike fails.** Mitigation: `window.print()` fallback, already scoped.
2. **Paged.js completion signal.** In a hidden webview there is no user to watch
   for "done". Paged.js resolves a promise on completion; the loaded document
   must post that back explicitly before the PDF is captured. Capturing early
   yields a blank or half-paginated file — this is the most likely source of a
   subtle bug.
3. **Page size.** `@page` is already driven by `essay.settings.paperSize`, but
   the platform PDF call may impose its own default. Assert US Letter and A4
   both come out at the right dimensions.
4. **Large documents.** CI already paginates a 50-page fixture; a hidden webview
   doing the same should be measured, not assumed.

## Out of scope

- PDF/A or any archival profile
- Embedding fonts the project has no license to
- Annotating, merging, or reading existing PDFs
- Windows delivery (the app ships macOS today; keep the Rust command's platform
  split clean so Windows is a later addition, not a rewrite)

## Build order

1. Spike the platform print-to-PDF call. **Gate: stop and re-plan if it fails.**
2. Self-contained HTML (figures inlined as data URLs) + golden coverage.
3. Rust `export_pdf_from_html` command with error mapping.
4. `exportEssayToPdf` adapter reusing the save dialog and outcome union.
5. Export menu + i18n keys for both locales.
6. Component and adapter tests.

Steps 2 and 3 are independent and can proceed in parallel once step 1 clears.

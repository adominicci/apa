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
  ├── save() dialog                            (reused; path chosen first)
  ├── renderEssayHtml + renderEssayCss         (reused, same snapshot as DOCX)
  ├── inline figure images as data URLs        (new: self-contained document)
  └── invoke("export_pdf", { html, path })     (new Rust command)
        ├── hidden WebviewWindow loads the HTML
        ├── waits for Paged.js to report completion
        ├── printOperationWithPrintInfo → temp file
        └── atomic move temp → path
```

Returns the same `ExportOutcome` union as DOCX, so the UI keeps one code path.

### Boundaries

- `renderEssayHtml.ts` stays pure and gains **no** PDF knowledge. It already
  produces what is needed.
- The image-inlining step is app-layer, not engine-layer: it touches the
  filesystem through `$lib/persist/assets`, which pure packages must not do.
- The Rust command takes HTML and a destination path. It knows nothing about
  APA, essays, or references. That keeps the contract narrow and testable.
- `ExportOutcome` (`saved` / `cancelled` / `error`) is reused verbatim so the
  UI handles both formats through one code path.

### Why the preview cannot be printed directly

`PrintPreview.svelte` renders figures as **object URLs** bound to the live
window, and the preview only exists while the user has it open. The PDF path
needs a document that stands alone: same HTML, but with figures inlined as data
URLs. This is the one genuinely new piece of rendering work.

## The platform call — verified against the locked dependencies

Tauri itself has **no PDF API**. `WebviewWindow::print()`
(`tauri-2.11.5/src/webview/webview_window.rs:2306`) only opens the OS print
panel. Silent PDF output requires the raw platform webview, reached through
`WebviewWindow::with_webview()` → `PlatformWebview`
(`tauri-2.11.5/src/webview/mod.rs:151`).

Every symbol below was confirmed present in the versions this repo already
locks. Nothing new enters the dependency graph.

**macOS** — `PlatformWebview::inner()` returns `*mut c_void`, the `WKWebView`:

| Call | Crate |
| --- | --- |
| `WKWebView::printOperationWithPrintInfo` | `objc2-web-kit` 0.3.2 |
| `NSPrintOperation::setShowsPrintPanel(false)` | `objc2-app-kit` 0.3.2 |
| `NSPrintOperation::runOperation()` | `objc2-app-kit` 0.3.2 |
| `NSPrintInfo::setJobDisposition` + `NSPrintJobSavingURL` | `objc2-app-kit` 0.3.2 |

Both crates are licensed `Zlib OR Apache-2.0 OR MIT` and already arrive through
`wry` 0.55.1, which itself holds the webview as
`Retained<objc2_web_kit::WKWebView>`. This satisfies the AGENTS.md license
policy with no new vendor.

**Windows** (later) — `PlatformWebview::controller()` returns
`ICoreWebView2Controller`, from which `ICoreWebView2_7::PrintToPdf` is
reachable. Keep the macOS code behind `#[cfg(target_os = "macos")]` so adding
Windows is an addition, not a rewrite.

### Use the print operation, not `createPDF`

`WKWebView.createPDF(configuration:completionHandler:)` looks like the obvious
choice and is the wrong one. It snapshots the web content's scroll rect, so a
Paged.js document — which lays its pages out as stacked `.pagedjs_page`
elements — comes back as **one enormously tall page** instead of 12 letter-sized
ones.

`printOperationWithPrintInfo` runs the real print pipeline, which honours the
`@page` rule `renderEssayHtml.ts` already emits. With `showsPrintPanel` set to
false and `jobDisposition` set to save, it writes a correctly paginated PDF to
a path with no panel and no user interaction.

This distinction is the single most important implementation detail in this
document. Getting it wrong produces a file that looks plausible in a thumbnail
and is unusable when submitted.

## Export UX

The student's experience is the point of this work, so it is specified rather
than left to the implementation.

**The flow, end to end:**

1. Press **Export**. A two-item menu opens: **Word (.docx)** and **PDF**.
2. If the title page is missing APA items, the v0.1.8 advisory dialog appears
   first — identical for both formats.
3. The Tesina save dialog opens, pre-filled with the sanitized essay title and
   the right extension.
4. The button reads "Exporting…" while the work happens.
5. The footer confirms the saved path, exactly as DOCX does today.

**No OS print panel. Ever.** A print panel asks the student about printers,
copies, and scaling — none of which they want — and it is the reason
`window.print()` is rejected as the primary path. It survives only as an
emergency fallback if the platform call proves unworkable, and choosing it
would be a visible downgrade worth flagging to the user, not a silent
substitution.

**Save first, then render.** `NSPrintJobSavingURL` needs a destination before
rendering starts, which inverts the DOCX order (build bytes → save → write).
The student cannot tell the difference: one dialog, then done.

**Never leave a broken file behind.** Because the path is chosen up front, a
mid-render failure would otherwise strand a truncated PDF where the student
expects their paper. Render to a temp path and move it into place only on
success, honouring the atomic-write invariant in AGENTS.md. On failure the
original file — if any — is untouched, and the footer shows the error.

**Both formats share the gate.** `studentTitlePageWarnings` is
format-agnostic, so PDF inherits the v0.1.8 "advise, never block" behaviour for
free. Unresolved citations still block both formats — that is a data error, not
a style preference.

New Paraglide keys (both `en` and `es`, per the two-axis i18n rule; these are
chrome strings and use the UI locale):

- `editor_export_docx`, `editor_export_pdf`
- `editor_exporting_pdf`, `editor_exported_pdf`
- `editor_export_pdf_error`

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

> **The PDF matches the Print preview, page for page.**
> It does not promise to match the DOCX opened in Word.

Do not let the PDF work quietly become a font-licensing project. Bundling
Latin Modern (OFL, permitted by the AGENTS.md license policy) would fix
Computer Modern and is a reasonable **separate** change. Times New Roman,
Calibri, and Aptos are proprietary and cannot be bundled at all.

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

Ordered by how likely they are to actually bite.

1. **Paged.js completion signal.** In a hidden webview nobody is watching for
   "done". Paged.js resolves a promise on completion, and the loaded document
   must post that back before the print operation runs. Printing early yields a
   blank or half-paginated file. **This is now the most likely source of a
   subtle bug** and deserves the first test.
2. **Page size.** `@page` is already driven by `essay.settings.paperSize`
   (`renderEssayHtml.ts:318`), but `NSPrintInfo` carries its own paper size and
   margins that can silently override it. Assert US Letter and A4 both come out
   at the right dimensions, and set `NSPrintInfo` margins to zero so the CSS
   owns the layout.
3. **Hidden window behaviour.** A webview that is never shown may not lay out
   at all on macOS. If so, render off-screen (positioned outside the visible
   frame) rather than un-shown.
4. **Large documents.** CI already paginates a 50-page fixture; a hidden webview
   doing the same should be measured, not assumed.

The earlier "the platform call may not exist" risk is retired — every symbol is
verified present in the locked dependencies, as tabled above.

## Out of scope

- PDF/A or any archival profile
- Embedding fonts the project has no license to
- Annotating, merging, or reading existing PDFs
- Windows delivery (the app ships macOS today; keep the Rust command's platform
  split clean so Windows is a later addition, not a rewrite)

## Build order

1. **Spike:** hidden webview + `printOperationWithPrintInfo` writing a
   multi-page PDF from a hard-coded two-page HTML string. Proves pagination and
   the completion signal together. Timeboxed; discard the code afterwards.
2. Self-contained HTML (figures inlined as data URLs) + golden coverage.
3. Rust `export_pdf` command: temp render, atomic move, error mapping.
4. `exportEssayToPdf` adapter reusing the save dialog and outcome union.
5. Export menu + i18n keys for both locales.
6. Component and adapter tests.

Steps 2 and 3 are independent and can proceed in parallel once step 1 clears.

Step 1 is no longer a design gate — the APIs are confirmed — but it is still
the right first move, because it isolates the two genuine unknowns (pagination
fidelity and the completion signal) from all the plumbing around them.

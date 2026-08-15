# PDF export design

Date: 2026-08-15
Status: **blocked at step 1** — the spike did not clear the gate. See
"Spike result" below before building anything from this document.
Applies to: `apps/desktop`

> **Read this first.** The architecture below still stands, but the section
> titled "The render contract" prescribes a print configuration that has now
> been measured and does **not** work: it paginates without terminating. Do not
> implement steps 2-6 until the runaway is understood.

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

```text
renderEssayHtml.ts  (pure)   →  HTML + CSS  →  PrintPreview.svelte  →  Paged.js
createStudentExportSnapshot  →  detached essay/doc/references snapshot
exportEssay.ts               →  DOCX bytes  →  save() dialog  →  writeFile
```

### What gets added

```text
exportEssayToPdf(essay, doc, references)
  ├── save() dialog                            (reused; path chosen first)
  ├── build imageUrls: figures → data URLs     (new; PrintPreview uses blob URLs)
  ├── build mathml: latexToMathml per equation (same as PrintPreview)
  ├── renderEssayHtml(…, imageUrls, mathml)    (reused, same snapshot as DOCX)
  ├── renderEssayCss(essay.settings)           (reused; carries the @page rule)
  └── invoke("export_pdf", { html, css, path })  (new Rust command)
        ├── hidden WebviewWindow loads the HTML
        ├── waits for the Paged.js completion handshake, under a deadline
        ├── printOperationWithPrintInfo → temp file beside the destination
        └── rename temp → path (same directory, so the rename is atomic)
```

Returns the same `ExportOutcome` union as DOCX, so the UI keeps one code path.

### The asset pipeline must be carried over whole

`renderEssayHtml` takes **two** asset maps (`renderEssayHtml.ts:370`):
`imageUrls` and `mathml`. `PrintPreview.svelte` builds both, and it builds them
defensively — a missing figure asset and a malformed LaTeX string are each
caught individually so the page still renders, one without its image and the
other with just its equation number.

The PDF path must reproduce **both** maps and **both** fallbacks. Carrying only
the figures would silently drop every block equation to raw LaTeX in the
submitted PDF while the on-screen preview still looked correct — a divergence
the student would not catch. Tests must cover equation conversion and both
degradation paths, not just the happy figure case.

### Boundaries

- `renderEssayHtml.ts` stays pure and gains **no** PDF knowledge. It already
  produces what is needed.
- Building the two asset maps is app-layer, not engine-layer: it reaches the
  filesystem through `$lib/persist/assets`, which pure packages must not do.
- The Rust command takes HTML, CSS, and a destination path. It knows nothing
  about APA, essays, or references. That keeps the contract narrow and testable.
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

## Spike result — 2026-08-15

Step 1 ran. Host:
`apps/desktop/src-tauri/examples/macos-pdf-proof-host.rs`, behind the
`pdf-proof-host` feature. It prints one JSON envelope and exits non-zero on
failure, following the `webview2-proof-host` precedent.

```bash
cargo run --example macos-pdf-proof-host --features pdf-proof-host -- /tmp/out.pdf
```

### What cleared

- **Every API in the table above is real and callable from Rust.** The host
  compiles and runs against the locked `objc2` crates. Nothing new was needed
  in the dependency graph, exactly as predicted.
- **The completion handshake works in a hidden window** — but only after a fix
  the design did not anticipate. `requestAnimationFrame` is **suspended in an
  off-screen window**, so an rAF-based ready signal never fires and the host
  stalled until its deadline. Racing rAF against a `setTimeout` fixes it. The
  same trap applies to `document.fonts.ready`, which can also stall off-screen;
  it too needs a timer as a second path.

### What did not clear

**`runOperation` paginates without terminating.** The first visible run wrote a
**3.65 GB** PDF and was still growing when the process was killed. The host now
carries a size watchdog so a bad geometry cannot fill the disk again.

Four candidate causes were eliminated by measurement, not argument:

| Hypothesis | Flag | Result |
| --- | --- | --- |
| Zeroed `NSPrintInfo` margins | `--default-margins` | still runs away |
| Stacked page-box CSS | `--simple` | still runs away |
| Resizing the view to the paper box | `--keep-frame` | still runs away |
| Mutating the shared `NSPrintInfo` | `--shared-info` | still runs away |

Trivial HTML with no page CSS, printed through an unmodified print info, runs
away too. **The fault is in how the operation is driven, not in the document.**

### Consequences for this document

- The geometry table in "The render contract" is **not** the fix it was written
  as. Zeroed margins are not the cause of the runaway, and were never tested
  against a working baseline; treat the whole table as unverified.
- The stated risk order was wrong. "Paged.js completion signal" was ranked most
  likely to bite; it was real but cheap to fix. The unranked risk — that the
  print operation itself would not terminate — is the one that actually blocks.
- A new hard requirement, learned the expensive way: **any code path that runs
  a print operation must be bounded by an output-size or page-count cap.** A
  runaway here does not merely fail, it fills the user's disk.

### Next hypothesis

`runOperation` is called synchronously from inside the `tao` event-loop
callback, so the main run loop never pumps and the operation cannot finish.
wry's own `print_with_options` avoids precisely this: it calls
`runOperationModalForWindow:...` with `setCanSpawnSeparateThread(true)` rather
than blocking the handler. The next attempt should defer the print onto the
main queue and settle through a completion delegate.

If that fails too, the fallback ladder is: a visible-but-off-screen window, then
`window.print()` with its announced UX downgrade.

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

**No OS print panel on the shipping path.** A print panel asks the student
about printers, copies, and scaling — none of which they want — which is why
`window.print()` is rejected as the primary path.

`window.print()` is **not** forbidden outright; it is a named contingency. If
the platform call proves unworkable, shipping it would be a deliberate,
announced downgrade — the change would say so in the CHANGELOG and this
document would be amended to record the decision. What is forbidden is
substituting it silently, so that a student who chose "PDF" lands in a printer
dialog with no explanation.

**Save first, then render.** `NSPrintJobSavingURL` needs a destination before
rendering starts, which inverts the DOCX order (build bytes → save → write).
The student cannot tell the difference: one dialog, then done.

**Never leave a broken file behind.** Because the path is chosen up front, a
mid-render failure would otherwise strand a truncated PDF where the student
expects their paper. The write rules, honouring the atomic-write invariant in
AGENTS.md:

- Render to a **uniquely named temp file in the destination's own directory**,
  not in the system temp directory. A rename only becomes an atomic replace
  when source and destination share a filesystem; `/tmp` and a folder on an
  external drive or a network share do not, and the "atomic move" would
  silently decay into a copy that can tear.
- Replace the destination **only after** the render reports success.
- If the render or the rename fails, the existing file at that path — if any —
  is left exactly as it was. A failed PDF export never destroys the student's
  previous export.
- Delete the temp file on **every** failure path, including timeout and
  cancellation. A directory slowly filling with `.tesina-export-*.pdf`
  leftovers is its own bug.

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

## The render contract

`export_pdf` is the one place where a vague spec turns into a hung UI or a
blank file. The contract is therefore explicit.

### Completion handshake

The hidden webview must tell Rust when it is safe to print. `previewer.preview()`
resolves with a flow object carrying `flow.total`
(`PrintPreview.svelte` already reads it for the page count). The injected
bootstrap awaits that promise and posts a single message back:

- **success** — `{ ok: true, pages: flow.total }`
- **failure** — `{ ok: false, error: <message> }`, posted from a `catch` around
  the whole pagination, plus a `window.onerror` hook so a script failure that
  never reaches the `catch` still reports rather than going silent.

Rust prints only after an `ok: true`. `pages` is carried through so the adapter
can assert page-count parity against what the preview showed.

### Deadline and cleanup

**Every failure mode must terminate in an `ExportOutcome.error`.** The one
unacceptable outcome is a button stuck on "Exporting…" forever.

- The wait is bounded by a deadline. Exceeding it is a normal, handled error,
  not a panic.
- On success, failure, timeout, or cancellation: destroy the hidden webview,
  delete the temp file, and return. No path may leave either behind.
- A JavaScript error inside the webview propagates as the error message rather
  than being swallowed, so a broken document is diagnosable from the footer.

The deadline must be generous enough for the 50-page CI fixture on a slow
machine. Pick it from a measurement taken during step 1, not from a guess.

### Page geometry

The CSS owns the layout; `NSPrintInfo` must be configured not to fight it.

| `NSPrintInfo` | Value | Why |
| --- | --- | --- |
| paper size | from `essay.settings.paperSize` | must agree with the `@page` rule at `renderEssayHtml.ts:318` |
| top/bottom/left/right margins | `0` | APA margins are already in the CSS; non-zero here insets them twice |
| `isHorizontallyCentered` / `isVerticallyCentered` | `false` | centering shifts an already-positioned page box |
| orientation | portrait | APA papers are portrait |
| scaling factor | `1.0` | any other value silently breaks 12 pt type |

The webview also needs a deterministic environment before printing: a fixed
viewport width matching the target page width, so Paged.js does not lay out
against an arbitrary window size, and confirmation that fonts and images have
settled (`document.fonts.ready`, plus image decode) before the handshake fires.
Printing mid-font-load produces a PDF laid out in the fallback face.

## Testing

Proportional to risk, smallest useful check first:

- **Pure render** — `renderEssayHtml.test.ts` already has golden snapshots. Add
  one covering the self-contained variant, asserting that figures arrive as data
  URLs, that no blob URL survives, and that equations arrive as MathML.
- **Asset fallbacks** — a missing figure asset and a malformed LaTeX string each
  degrade exactly as `PrintPreview.svelte` degrades them, rather than failing
  the export.
- **Export adapter** — unit test that the PDF path consumes the same detached
  snapshot as DOCX and returns the same `ExportOutcome` shape, with the Rust
  command mocked. Cover the error and timeout replies, asserting the UI leaves
  the "Exporting…" state in every case.
- **Component** — extend the `EditorScreen` suite: the menu offers both formats,
  each calls its own exporter once, and the title-page advice fires for PDF
  exactly as it does for DOCX.
- **Rust** — unit test error mapping and the temp-file cleanup guarantee
  (failure leaves no temp file and does not touch an existing destination).
- **Native proof** — the existing harness under
  `src/lib/editor/pagination/proof/` is the precedent for anything needing a
  real webview. Extend it to assert, on a real render: the handshake fires,
  timeout cleanup works, a US Letter and an A4 export each produce a non-blank
  multi-page PDF at the correct point dimensions, and the page count matches
  `flow.total`. Byte-level PDF assertions stay out of scope; dimensions and page
  count are what actually protect the student.

## Risks

Ordered by how likely they are to actually bite.

1. **Paged.js completion signal.** In a hidden webview nobody is watching for
   "done". Printing early yields a blank or half-paginated file. **This is the
   most likely source of a subtle bug** and deserves the first test. Governed by
   the handshake and deadline rules above.
2. **Page size.** `NSPrintInfo` carries its own paper size, margins, and scaling
   that silently override the CSS. Governed by the geometry table above; assert
   US Letter and A4 dimensions in the native proof.
3. **Hidden window behaviour.** A webview that is never shown may not lay out
   at all on macOS. If so, render off-screen (positioned outside the visible
   frame) rather than un-shown.
4. **Large documents.** CI already paginates a 50-page fixture; a hidden webview
   doing the same should be measured, not assumed. That measurement also sets
   the deadline.

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

## Context

Tesina stores one ProseMirror document shaped as `sectionAbstract? sectionBody sectionAppendix*`. The title page is Svelte chrome and the references section is a derived ProseMirror widget. The live editor currently gives every top-level section one Letter-shaped block with `aspect-ratio`, but content taller than that minimum simply lengthens the block. Paged.js creates accurate non-editable preview pages, and Word performs its own pagination during DOCX rendering.

Release notes currently arrive from the Tauri updater, survive relaunch in local storage, render inside one `<p>` with `white-space: pre-wrap`, and are deleted after their automatic modal is dismissed. The home-page version is hardcoded in Paraglide messages, while the editor status bar has no app version.

Essayist's public website and guides are behavioral references for automatic academic page setup, fixed paper geometry, and a paged writing canvas. The public [Start Writing guide](https://www.essayist.app/guides/start-writing) shows a paper-shaped writing surface and describes 12-point, double-spaced text with one-inch margins; the public [Settings guide](https://www.essayist.app/guides/settings) exposes paper-size, margin, and page-count settings. Public Mac screenshots also show a page number in the page's top-right margin. These sources were consulted on 2026-08-08 only to identify observable behavior. This is a clean-room implementation: no Essayist code, text, assets, private behavior, or reverse engineering may be used. Tiptap's proprietary Pages extension is also excluded: it requires a commercial plan and its pagination-safe table kit is not an allowed MIT/Apache-2/ISC/BSD/OFL dependency.

## Goals / Non-Goals

**Goals:**

- Preserve one authored ProseMirror document while presenting automatic US Letter page flow.
- Keep page geometry canonical at 816 by 1056 CSS pixels with 96-pixel margins, independent of fit-to-window scaling.
- Support line-level paragraph flow, heading keep-with-next, list continuity, page-aware tables, atomic figures/equations, derived references, and stable cursor/selection behavior.
- Display sequential, derived APA page numbers on every live sheet, including the title and generated-reference sheets.
- Make the installed version's sanitized Markdown notes available automatically after update and on demand from both primary app surfaces.
- Keep the editor usable and persisted content safe if pagination cannot settle.

**Non-Goals:**

- Manual page-break authoring or stored automatic page nodes.
- Pixel-identical pagination in Microsoft Word; Tesina controls its editor and preview geometry, while Word repaginates the DOCX.
- A release-history browser, release-note editor, or network fetch when opening installed notes.
- Page templates, headers/footers editing, arbitrary paper-size UI, or copying Essayist's visual design.
- Adopting `@tiptap-pro/extension-pages` or any dependency outside the repository's allowed licenses.

## Decisions

### 1. Use a clean-room ProseMirror pagination extension with a proof gate

Create a custom Tiptap extension backed by ProseMirror plugin state and decorations. The plugin owns a derived `PaginationPlan` containing page-start document positions, specialized table-row starts, section page counts, a total authored-page count, and the layout epoch that produced it. It never inserts nodes into the document or adds authored transactions to undo history.

Before production integration, build a narrow native WKWebView proof that demonstrates: one paragraph splitting at a measured line boundary; caret and selection continuity across the visual gap; undo without pagination entries; a page start between table rows; an atomic figure moving as one unit; deterministic removal of a trailing page; and unchanged `editor.getJSON()`. Implementation SHALL stop and revise this design if those behaviors cannot be achieved reliably in WKWebView. This first macOS feasibility gate does not replace the later Windows WebView2 regression gate or packaged-app smoke evidence. A block-only paginator or fake page background is not an acceptable fallback for the approved requirements.

Alternatives rejected:

- Persisted page nodes would make automatic layout mutate essay data and destabilize undo, selections, migrations, and citations.
- One EditorView per page would fragment cross-page selection, input methods, paste, search, and history.
- Paged.js remains appropriate for preview, but its cloned output is not a live contenteditable surface.
- Tiptap Pages is behaviorally relevant but commercially licensed and incompatible with Tesina's dependency policy.

### 2. Separate paper geometry, measurement, planning, and painting

Add focused modules under `apps/desktop/src/lib/editor/pagination/`:

- `geometry.ts`: canonical Letter width `816`, height `1056`, margins `96`, printable width `624`, printable height `864`, and the visual inter-page gap.
- `types.ts`: `MeasuredFragment`, `BreakCandidate`, `PaginationPlan`, `PaginationReason`, and the external environment/callback contracts.
- `plan.ts`: a pure, deterministic greedy planner over measured fragments, including keep rules, widow/orphan constraints, section starts, table-row candidates, oversize progress guarantees, and page counts.
- `measure.ts`: the only browser-layout reader. It maps DOM line rectangles and block/table boundaries back to ProseMirror positions, accounts for generated section headings and table/figure/equation labels that currently come from CSS pseudo-content, excludes existing pagination decoration height, waits for fonts/assets, and cancels stale measurement epochs.
- `extension.ts`: plugin state, invalidation triggers, animation-frame scheduling, decoration creation, cleanup, and `onPageCount` notification.
- `paperScale.ts`: a Svelte attachment/utility that fits a fixed-width sheet stack into the canvas with a transform and compensating outer dimensions, without changing pagination inputs.

Measurement runs at the fixed paper width. Ordinary text exposes line candidates through DOM `Range` rectangles. Headings pair with the first following line. Figures and equations expose atomic block candidates. Lists keep their logical list-item DOM so continuation lines do not gain a second marker. Table rows expose valid positions between `tableRow` nodes; a specialized widget renders a non-editable table gap row with the correct column span and may repeat a visual header without duplicating document data. Generated section labels, body titles, keyword/note prefixes, table and figure numbers, and equation numbers must either become measurable derived DOM or be represented as synthetic measured fragments; they may not be omitted from break calculations.

Page-gap widgets are `contenteditable=false`, `aria-hidden`, excluded from copy/selection and assistive text, and keyed by document position for stable redraws. A section's first and last edges plus gap widgets paint the white sheets, bottom/top margins, canvas gap, borders, and shadows. Each painted sheet also receives a derived, non-selectable top-right page number; the cover is page 1 and authored/reference pages continue the same sequence. A maximum stabilization pass count and an epoch check prevent measurement loops. Oversize atomic content moves once to a fresh page and then uses a visible bounded overflow treatment; it never retries indefinitely.

Plugin state distinguishes `settling`, `stable`, and `fallback`. The status bar reports only the last stable total (or a localized pending/unavailable state before the first stable plan), never the old words-per-page estimate as if it were authoritative. Pagination reads and writes are coalesced outside the authored input transaction; rapid edits cancel stale epochs and commit only the newest settled plan.

### 3. Keep derived references page-aware but outside essay data

Refactor the current reference decoration into a page-aware renderer. It measures the generated reference heading and entries at canonical width, divides them into as many non-editable reference sheets as required, and keeps those sheets at the existing insertion position before appendices. Reference pagination invalidates on citation/library changes, locale changes, font changes, and font readiness. The empty-reference hint still occupies one page. No reference page or continuation marker enters ProseMirror JSON.

The title page remains `CoverSheet.svelte`, visibly carries page number 1, and counts as one page. The pagination extension reports authored section pages; the reference renderer reports reference pages; `EditorScreen.svelte` combines both with the cover to replace the current words-per-page estimate. Opening preview may verify the same count but is no longer required to obtain it.

### 4. Treat fit-to-window as visual scaling

Replace `width: min(100%, 8.5in)` layout shrinkage with a fixed 816-pixel paper coordinate system. Scale the combined cover/editor stack only when the canvas is narrower, using a transformed inner stack and an outer sizing wrapper so scrolling, click coordinates, selections, and the status bar remain correct. ResizeObserver updates the visual scale; it SHALL NOT invalidate pagination unless a canonical layout input changed. Native macOS WKWebView and Windows WebView2 tests cover first paint, resize, focus, selection, and scrolling in both embedded engines because prior WebKit aspect-ratio behavior has regressed and transform geometry can differ across engines.

### 5. Reuse one safe Markdown component

Add `marked@18.0.9` (MIT) and `dompurify@3.4.13` under its Apache-2.0 option. `MarkdownContent.svelte` parses the supported release-note Markdown, sanitizes the produced string with an explicit HTML-only allowlist, forbids style/data attributes and embedded resources, normalizes headings beneath the dialog title, then renders the sanitized result. Marked is never treated as a sanitizer. The component intercepts links: only URLs that parse to the HTTPS protocol are passed to Tauri's opener; malformed, relative, protocol-relative, or other-protocol destinations remain inert readable text.

The component owns release-note typography and spacing so `ReleaseNotesModal.svelte` only provides modal chrome. The shared modal must contain keyboard focus while open, make background content non-interactive to assistive technology, close on Escape/overlay as configured, and restore focus to the exact home/status-bar opener. Tests include scripts, event attributes, raw HTML, SVG/MathML, embedded images, protocol obfuscation, safe links, heading normalization, lists, emphasis, malformed Markdown, Tab/Shift+Tab containment, Escape, and focus restoration.

### 6. Bundle current notes from the canonical changelog

Move the pure changelog-section extraction function into `apps/desktop/src/lib/update/extractReleaseNotes.ts`, with no browser or app imports, so both the release CLI script and desktop bundle can import it. A `bundledReleaseNotes` module statically imports the desktop package version and `CHANGELOG.md?raw`, then extracts exactly that version's section at build time. Tests and release verification SHALL fail if package, Tauri, Cargo/Cargo.lock, the bundled note version, and the changelog section diverge or if the section is empty; the production Vite build must prove the root changelog raw import is included successfully.

This avoids a second hand-maintained notes copy. The matching pending-updater record remains the one-time trigger for automatic post-update presentation, but the bundled current-version body is canonical for both automatic and manual openings. A pending body is untrusted legacy payload and never overrides or changes the bundled body, so reopening always shows the same notes. Stale pending notes are ignored and preserved when necessary to avoid deleting a newer marker.

### 7. Centralize installed-version and modal access in the root layout

Create a layout-scoped release-notes controller exposed through Svelte context. It starts with the packaged version, resolves and validates the Tauri runtime version once, distinguishes automatic-pending from manual-installed presentations, opens installed notes on request, and dismisses only the matching pending marker. A runtime/package mismatch must never label one version's bundled body as another version's notes: show the actual runtime version with a localized unavailable state, log no note/document content, and fail the release contract so production artifacts cannot ship in that state. The existing updater-banner precedence remains intact.

`EssayHome.svelte` and `EditorScreen.svelte` consume the controller. The home footer becomes a real button showing the dynamic version beside the localized APA edition. The editor status bar adds a `v{version}` button beside the unchanged `APA 7` text. Both use localized accessible names/tooltips and open the same current-version modal. Modal focus entry, Escape/overlay behavior, and return-to-opener continue through `Modal.svelte`.

### 8. Verify behavior in layers and release as 0.1.3

Pure planner tests use synthetic fragment geometry and cover exact break decisions without jsdom layout. ProseMirror tests cover decoration mapping and document immutability. Svelte/jsdom tests cover version resolution, canonical note-source precedence, Markdown safety, both launch controls, focus containment/return, page numbers, and status count wiring. One clean-room proof fixture runs through platform-native CI hosts: the proven Swift WKWebView harness on macOS covers WebKit, and a Windows Rust harness reusing Tesina's locked Tauri/Wry WebView2 backend covers its Chromium-based embedded engine. Both hosts run the same line-rectangle, generated-label, table, figure, list, deletion-reflow, scale-invariance, script-driven editing-state, and preview-parity assertions through native script-message bridges; visible-host native/manual evidence separately covers OS-level IME, clipboard, and drag paths that script events cannot prove. The Windows host preflights the system Evergreen WebView2 runtime, records its identity, and fails closed when it is unavailable; the plan does not promise a pinned Chromium version or exact engine-version parity. Both native hosts use condition-based readiness rather than guessed sleeps, enforce bounded inner page-watchdog and outer runner deadlines, and own the complete spawned process tree so a stalled run terminates the direct process and every descendant. A finally-style lifecycle closes the Vite preview server and removes every temporary distribution, profile, and output directory on success, failure, or timeout, including when another cleanup step rejects. The CI hosts add no Playwright or equivalent downloaded-browser package; any direct harness-only crate or SDK input must pass the existing license/security audit. Harness binaries, generated pages, diagnostics, and all test tooling remain test-only and are excluded from shipped Tauri artifacts. A packaged macOS Tauri run separately provides app-level evidence for editing across page boundaries and the two version entry points; the existing installer-build matrix remains a distinct cross-platform packaging gate. The Windows WebView2 job is cross-engine regression evidence and does not change Tesina's current platform-support or publication policy.

Every changed Svelte file runs through the Svelte MCP autofixer. Final gates run from the repository root: `deno task check`, `deno task test`, `deno fmt`, and `deno lint`. Version 0.1.3 is synchronized across package, Tauri, Cargo/Cargo.lock, visible UI, README, and changelog. The exact merged `main` commit is tagged `v0.1.3`; the draft release and updater files are verified before publication.

## Risks / Trade-offs

- **DOM measurement differs between jsdom and embedded webviews** → Keep the solver pure, reuse the same clean-room fixture in macOS WKWebView and Windows WebView2, and make both native-engine gates mandatory before full integration.
- **Decorations can create reflow feedback loops** → Exclude prior decoration height during measurement, cancel stale epochs, cap stabilization passes, and retain the last stable plan on failure.
- **Large tables or atomic blocks can exceed a page** → Split tables only at row boundaries, constrain images to printable height, detect oversize blocks, and guarantee forward progress with a deterministic visible overflow state.
- **Pagination on every keystroke can feel slow** → Batch DOM reads/writes in animation frames, invalidate only affected inputs, cancel superseded work, and benchmark representative 10-, 25-, and 50-page fixtures.
- **Visual transform may affect caret coordinates across embedded-engine revisions** → Test first paint, typing, selection, drag selection, and scroll-to-caret in the minimum supported macOS WKWebView runtime and the Windows WebView2 CI runtime before release.
- **Markdown-to-HTML is an injection surface** → Use a maintained parser plus sanitizer, a strict allowlist, string-input sanitation, safe opener routing, adversarial tests, and pinned dependency versions.
- **Bundled and updater notes may disagree** → Treat the pending record only as the one-time trigger, render the canonical bundled body for both automatic and manual access, and enforce release-source parity in CI.
- **Runtime and packaged versions may disagree** → Never mislabel bundled notes, expose a localized unavailable state, and make metadata/bundle parity a blocking release check.

## Migration Plan

1. Add the pagination proof and pure fixtures without changing persisted data.
2. Integrate derived pagination behind the existing safe continuous fallback and verify existing schema-version 2 essays.
3. Add Markdown rendering, bundled notes, shared version access, and both version controls.
4. Run full automated evidence plus the macOS WKWebView and Windows WebView2 native-engine harnesses; do not release if either pagination proof or any data-identity check fails.
5. Update all version and release-note surfaces to 0.1.3, follow the repository's PR policy, merge, tag the exact `main` commit, verify the draft updater artifacts, and publish.

Rollback does not require data migration because page boundaries are never persisted. If a post-release pagination defect appears, ship a forward patch that activates the continuous safe fallback while preserving essay JSON; do not downgrade or rewrite user documents.

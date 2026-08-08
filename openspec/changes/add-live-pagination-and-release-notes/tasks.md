## Task 1: Baseline, containment, and feasibility gates

- [x] 1.1 Re-read `AGENTS.md`, inspect every worktree/branch/status, preserve the active `features/portable-library-backup-design` worktree and unrelated changes, verify that neither local nor remote tag `v0.1.3` already exists, create `features/live-pagination-release-notes` from current `main` before the first implementation commit, and recheck whether a `dev` branch exists before choosing the eventual PR base.
- [x] 1.2 Run and record the baseline from the repository root with `/Users/andresdominicci/.deno/bin/deno task check`, `/Users/andresdominicci/.deno/bin/deno task test`, `/Users/andresdominicci/.deno/bin/deno fmt --check`, `/Users/andresdominicci/.deno/bin/deno lint`, and `openspec validate add-live-pagination-and-release-notes --strict`; separate pre-existing failures from change failures.
- [x] 1.3 Add deterministic long-document fixtures covering multi-paragraph body text, hard line breaks, block quotes, run-in headings, inline citations, keywords, nested lists, a table spanning rows, a figure, a block equation, generated English/Spanish labels, long references, an appendix, and an oversize atomic block without using copyrighted APA or competitor text.
- [x] 1.4 Build a disposable clean-room ProseMirror/WKWebView pagination proof that demonstrates line-level paragraph continuation, cross-page caret and selection, one-step undo, a valid gap between table rows, atomic figure movement, trailing-page removal, stable first paint, and byte-equivalent `editor.getJSON()` before and after pagination.
- [x] 1.5 Record the proof results and stop implementation for design revision if any required editing behavior needs stored page nodes, multiple EditorViews, block-only pagination, or a fake background that lets text cross page margins.
- [x] 1.6 Audit `marked@18.0.9`, `dompurify@3.4.13`, and the proposed test-only `@playwright/test@1.62.1` candidate for tarball contents, licenses, transitive dependencies, runtime compatibility, and current security advisories; record the accepted Marked MIT and DOMPurify Apache-2.0 paths plus the rejection of the exact Playwright candidate under the existing license/security policy, and add no dependency.
- [x] 1.7 Commit the verified fixtures, proof, and dependency decision as an isolated checkpoint with an English commit message.

## Task 2: Canonical page geometry and pure pagination planner

- [ ] 2.1 Create failing tests for `apps/desktop/src/lib/editor/pagination/geometry.ts` that require Letter geometry of 816 by 1056 CSS pixels, 96-pixel margins, a 624-pixel text width, an 864-pixel printable height, and a visual-only page gap.
- [ ] 2.2 Create `geometry.ts` and `types.ts` with the exact constants and typed contracts for measured fragments, break candidates, section kinds, page starts, table-row starts, invalidation reasons, stable plans, and page-count callbacks.
- [ ] 2.3 Create failing pure tests for `plan.ts` covering exact-fit content, overflow to a second page, backward reflow after deletion, forced section starts, two-line widow/orphan behavior, heading keep-with-next, list continuation, atomic blocks, table-row boundaries, reference-page counts, and total-page accounting.
- [ ] 2.4 Implement the minimal deterministic planner in `plan.ts`, keeping automatic page positions derived and guaranteeing that every planning pass makes forward progress.
- [ ] 2.5 Add adversarial planner tests for zero-height fragments, fractional pixels, an element taller than the printable area, a table row taller than a page, empty sections, stale epochs, and repeated identical input; require a bounded overflow result rather than retry loops.
- [ ] 2.6 Run the focused planner tests, then commit the geometry/types/planner checkpoint with an English commit message.

## Task 3: DOM measurement and ProseMirror decoration engine

- [ ] 3.1 Bootstrap the two test-only native hosts before cross-engine RED tests: preserve the Swift WKWebView harness on macOS and add a Rust harness reusing Tesina's locked Tauri/Wry WebView2 backend on Windows; audit any new direct harness-only crate or SDK input under the existing license/security policy; serve the external-module proof from a readiness-checked loopback origin in a visible native window; require condition-based document/module/visibility/animation-frame readiness with no guessed sleeps; preflight and record the system Evergreen WebView2 runtime identity and fail closed when unavailable without promising a pinned Chromium version; enforce bounded inner page-watchdog and outer runner deadlines; use platform-appropriate process-tree ownership so timeout termination reaches the direct runner and every descendant; guarantee Vite preview shutdown and removal of every temporary `dist`, profile, and output directory on success, failure, and timeout even when another cleanup step rejects; add no Playwright package or separately downloaded browser bundle; and exclude all harness outputs and test tooling from shipped Tauri artifacts.
- [ ] 3.2 Add failing tests in both native hosts that map DOM line rectangles, block boxes, list-item continuations, table rows, figures, and equations back to stable ProseMirror positions at canonical Letter width.
- [ ] 3.3 Implement `measure.ts` as the only layout-reading module, with existing-decoration normalization, `document.fonts.ready`, image-load invalidation, ResizeObserver cleanup, epoch cancellation, and separate read/write animation-frame phases.
- [ ] 3.4 Add failing ProseMirror tests proving pagination state maps through authored transactions without entering document JSON or undo history and that stale asynchronous measurements cannot replace a newer plan.
- [ ] 3.5 Implement `extension.ts` with a named `PluginKey`, immutable `PaginationPlan` plugin state, keyed non-editable/aria-hidden line and block gap widgets, bounded stabilization passes, last-stable-plan fallback, and teardown of observers and scheduled work.
- [ ] 3.6 Implement and test the table-row gap widget as a valid non-editable table row with the correct column span and visual repeated header where required, without cloning logical table rows into document data.
- [ ] 3.7 Test script-driven keyboard input, arrow navigation, selection, formatting, citations, undo/redo, and scroll-to-caret across decoration boundaries in both native hosts; separately capture visible-host native/manual evidence for IME composition, clipboard operations, and mouse/drag selection on macOS WKWebView and Windows WebView2 because script events cannot prove those OS input paths.
- [ ] 3.8 Add dedicated macOS WKWebView and Windows WebView2 CI jobs for the already-audited native hosts, run the same clean-room pagination layout and script-driven editing-state contract in the WebKit and Chromium-based embedded engines, capture engine/runtime identity, and require lifecycle regressions proving condition-based readiness, bounded deadline settlement, stalled descendant-process termination, preview shutdown, and temporary `dist`/profile/output cleanup on success, failure, and timeout; introduce no Playwright package or separately downloaded browser bundle, keep every harness binary/output and all test tooling out of shipped Tauri artifacts, run the focused pagination extension/native-engine suite, and commit the measurement/decorations checkpoint with an English commit message.

## Task 4: Live editor page stack, scaling, references, and page count

- [ ] 4.1 Thread a pagination environment and `onPageCount` callback through `createEditor.ts`, `Editor.svelte`, and `EditorScreen.svelte`, and invalidate it only for authored layout, locale, font, asset, and reference changes.
- [ ] 4.2 Replace section-level `aspect-ratio` growth in `apa.css` with first-page, continuation-page, and final-page painting driven by page-gap decorations; preserve US Letter dimensions, one-inch margins, paper-white surfaces, canvas gaps, borders, shadows, dark-mode isolation, and a derived top-right number on every page.
- [ ] 4.3 Create `paperScale.ts` and the fixed-layout/scaled-viewport wrapper around the combined `CoverSheet` plus editor stack; compensate outer dimensions so resizing changes visual fit but not line wrapping, page boundaries, page count, click coordinates, or scrolling.
- [ ] 4.4 Refactor `referenceDecoration.ts` into a page-aware derived renderer that produces one empty references page or as many measured reference pages as needed before appendices, without adding reference nodes or continuation markers to essay JSON.
- [ ] 4.5 Replace `EditorScreen.svelte`'s words-per-page estimate with pagination status plus the settled live count: one cover page plus authored pagination pages plus derived reference pages; show localized pending/unavailable text before any stable plan and keep preview count as a parity check rather than a prerequisite.
- [ ] 4.6 Add CSS and component regressions for title page number 1, sequential continuation/reference/appendix page numbers, optional abstract, multi-page body, references, multiple appendices, selected document fonts, English/Spanish generated headings and prefixes, narrow and wide canvases, focus mode, and reference-panel visibility; prove page chrome is absent from copied text and the accessibility reading order.
- [ ] 4.7 Run the Svelte MCP autofixer on every changed `.svelte` file, resolve every finding, run focused component/native-engine tests, and commit the integrated live-page stack with an English commit message.

## Task 5: Pagination parity, resilience, performance, and native evidence

- [ ] 5.1 Add deterministic editor-versus-Paged.js fixtures requiring the same page count, section order, Letter dimensions, margins, font, size, and line spacing for stable supported content.
- [ ] 5.2 Add DOCX regression assertions proving that editor page decorations never become manual Word page breaks and that Letter size, one-inch margins, selected font, font size, and double spacing remain unchanged.
- [ ] 5.3 Add save/reopen tests for old and new schema-version 2 essays, asserting no schema bump, no hidden essays, no pagination fields, no duplicated text/references/assets, and exact authored-content identity.
- [ ] 5.4 Exercise measurement failure, missing figure assets, late font/image loads, oversize content, and superseded layout epochs; verify the last stable plan or continuous safe fallback remains editable, autosaves, previews, and exports.
- [ ] 5.5 Before integration, define a recorded responsiveness budget for supported hardware, then benchmark representative 10-, 25-, and 50-page fixtures during rapid typing, deletion, reference refresh, font change, and resize; require coalesced frame work, no stale-plan commits or visible oscillation, and no pagination work inside the authored input transaction.
- [ ] 5.6 Run the same production-pagination fixtures through the macOS Swift WKWebView and Windows WebView2 CI harnesses and capture engine/runtime identity plus evidence for first paint, automatic body flow, paragraph continuation, tables, figures, equations, cursor/selection across pages, deletion reflow, scale invariance, accurate status count, and preview parity; separately smoke-test the packaged macOS Tauri app so engine-harness evidence is never presented as IPC, plugin, persistence, or installer proof.
- [ ] 5.7 Commit the verified pagination resilience/performance evidence and tests with an English commit message.

## Task 6: Safe reusable Markdown renderer

- [ ] 6.1 Add exact desktop dependencies `marked@18.0.9` and `dompurify@3.4.13`, update the Deno lockfile, and extend dependency-license checks to assert the accepted MIT and Apache-2.0 licensing path.
- [ ] 6.2 Create failing `MarkdownContent` tests for normalized heading levels beneath the modal title, paragraphs, strong/emphasis, ordered/unordered lists, inline code, malformed Markdown, and readable fallback for unsupported syntax.
- [ ] 6.3 Add adversarial tests for raw HTML, scripts, event attributes, styles, SVG/MathML, iframes, embedded images/media, encoded `javascript:`, `data:`, `file:`, protocol-relative links, and safe HTTPS links.
- [ ] 6.4 Implement `MarkdownContent.svelte` with Marked parsing, string-input DOMPurify sanitation, an explicit HTML-only tag/attribute allowlist, no styles/data attributes/resources, and delegated safe-link activation through `@tauri-apps/plugin-opener`.
- [ ] 6.5 Replace the plain-text paragraph in `ReleaseNotesModal.svelte` with `MarkdownContent`, add semantic release-note typography that remains contained on narrow screens, and harden shared modal behavior so Tab/Shift+Tab stay contained, background content is inert to modal navigation, Escape/overlay behavior remains configured, and close restores the exact opener; regression-test other modal consumers.
- [ ] 6.6 Run the Svelte MCP autofixer on both Markdown/release-note components, run their focused security/component tests, and commit the renderer checkpoint with an English commit message.

## Task 7: Canonical bundled notes and shared release-note controller

- [ ] 7.1 Move the pure `extractReleaseNotes` logic into `apps/desktop/src/lib/update/extractReleaseNotes.ts` with no app/browser imports, keep `scripts/extract-release-notes.ts` as a thin CLI adapter, and run the existing extraction/release-workflow tests unchanged or stronger.
- [ ] 7.2 Create `bundledReleaseNotes.ts` that statically reads the desktop package version and `CHANGELOG.md?raw`, extracts exactly that version's Markdown, and fails tests/build verification when the section is missing, empty, or mismatched.
- [ ] 7.3 Add tests proving a pending updater record matching the runtime version triggers the one-time automatic modal but cannot override the canonical bundled body, stale notes are ignored, automatic and manual openings render the identical current body, and bundled notes remain available offline after local storage is cleared.
- [ ] 7.4 Create a layout-scoped Svelte release-notes controller/context with immediate packaged-version fallback, validated runtime-version resolution, automatic-versus-manual presentation state, installed-note reopening, mismatch/unavailable handling that never mislabels notes, and dismissal that clears only the exact matching pending marker.
- [ ] 7.5 Refactor `+layout.svelte` to use the controller while preserving updater-banner precedence, persistence barriers, theme handling, startup non-blocking behavior, and one-time automatic notes.
- [ ] 7.6 Run the Svelte MCP autofixer on `+layout.svelte` and any controller harness, run focused layout/updater tests, and commit the bundled-note/controller checkpoint with an English commit message.

## Task 8: Clickable installed version on home and editor surfaces

- [ ] 8.1 Replace hardcoded version literals in `messages/en.json` and `messages/es.json` with parameterized APA-edition/version-control text plus localized tooltips and accessible names; regenerate Paraglide and update the release-policy wording in `AGENTS.md` to identify package/runtime metadata as the visible-version source.
- [ ] 8.2 Convert the home sidebar footer in `EssayHome.svelte` into a keyboard-accessible version button using the shared installed version, while preserving the localized APA 7th-edition label and compact sidebar layout.
- [ ] 8.3 Add a `v{version}` button beside the existing `APA 7` label in `EditorScreen.svelte`'s bottom status bar, preserving save state, export messages, language control, narrow-window layout, and focus mode.
- [ ] 8.4 Add component tests proving both buttons show the actual runtime/package version, open only the installed version's notes, handle malformed/empty/mismatched runtime results without mislabeling notes, reopen after dismissal, contain and return focus to the invoking control, and never navigate away from or mutate the open essay.
- [ ] 8.5 Run the Svelte MCP autofixer on `EssayHome.svelte` and `EditorScreen.svelte`, verify English and Spanish UI copy, and commit the version-entry-point checkpoint with an English commit message.

## Task 9: Full local quality and scenario matrix

- [ ] 9.1 Build a requirement-to-evidence matrix covering every scenario in both OpenSpec capability specs and link each row to a unit, component, macOS WKWebView, Windows WebView2, packaged-app smoke, DOCX, or manual accessibility result.
- [ ] 9.2 Run all focused tests plus `/Users/andresdominicci/.deno/bin/deno task check` and require 0 errors and 0 warnings.
- [ ] 9.3 Run `/Users/andresdominicci/.deno/bin/deno task test`, `/Users/andresdominicci/.deno/bin/deno fmt`, and `/Users/andresdominicci/.deno/bin/deno lint`; review the formatting diff before committing and rerun all four gates after formatting.
- [ ] 9.4 Run `openspec validate add-live-pagination-and-release-notes --strict`, inspect `git diff --check`, audit the final diff for unrelated files/generated artifacts/secrets/competitor copy, and commit the verified implementation with an English commit message.

## Task 10: Version 0.1.3 and plain-language release preparation

- [ ] 10.1 Set version 0.1.3 in `apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml`, and the Tesina package entry in `apps/desktop/src-tauri/Cargo.lock`; verify the dynamic visible-version source resolves to 0.1.3.
- [ ] 10.2 Update all current-version statements in `README.md` and revise `AGENTS.md` where necessary so the canonical release contract reflects changelog-derived bundled notes and runtime/package-derived visible versions.
- [ ] 10.3 Move the completed items from `CHANGELOG.md` Unreleased into `## [0.1.3] - 2026-08-08` with plain-language notes explaining automatic Letter-page flow, formatted notes, and permanent version-button access without technical jargon or internal file names.
- [ ] 10.4 Update changelog comparison links and strengthen the release workflow/version contract to verify package, Tauri, Cargo/Cargo.lock, changelog, and bundled-note parity for 0.1.3; confirm the exact bundled Markdown equals both automatic/manual modal content and the release workflow body.
- [ ] 10.5 Rerun the Svelte autofixer where version/copy changes touch Svelte, then rerun check, test, format, lint, strict OpenSpec validation, both native-engine CI harnesses, packaged-app smoke tests, and the scenario matrix.
- [ ] 10.6 Commit the verified 0.1.3 release preparation with an English commit message.

## Task 11: PR, independent review, and merge policy

- [ ] 11.1 Fetch origin; merge `origin/main` into local `main`; if `origin/dev` and local `dev` exist at execution time, merge `origin/dev` into local `dev`; inspect and resolve conflicts before rebasing/merging the feature branch as appropriate.
- [ ] 11.2 Push `features/live-pagination-release-notes` and create the PR against `dev` only if `dev` exists at that time, otherwise against `main`; include the OpenSpec change, scenario matrix, local gates, native evidence, data-safety proof, and release plan in the English PR description.
- [ ] 11.3 Add exactly the required `@greptile review` PR comment, wait for checks/review, validate findings technically, reply in English, resolve only addressed threads, and rerun affected plus full gates after fixes.
- [ ] 11.4 Confirm the final PR diff contains no unrelated portable-backup worktree changes, no generated native-engine harness artifacts or downloaded browser bundles, no forbidden competitor material, and no unexpected dependency/license changes.
- [ ] 11.5 Merge the feature PR only after required checks and review are green, then sync its base branch and verify local/remote commit parity without closing or deleting `main` or `dev`.
- [ ] 11.6 If the feature PR merged into `dev`, create the required reviewed `dev` to `main` promotion PR, add the required `@greptile review` comment, resolve only validated feedback, merge only when green, and then sync both protected branches. If the feature PR merged directly into `main`, record that no promotion PR was needed.
- [ ] 11.7 Before tagging, require green `main` CI including the macOS WKWebView and Windows WebView2 harness jobs, plus the existing macOS, Windows, and Linux installer-build verification for the exact merged `main` commit.

## Task 12: Tag, verify, publish, and close out version 0.1.3

- [ ] 12.1 Confirm the exact merged `main` commit contains the synchronized 0.1.3 metadata, changelog body, bundled notes, and green gates, then create and push annotated tag `v0.1.3` on that exact commit.
- [ ] 12.2 Wait for the release workflow to create the draft and verify the universal macOS app/DMG, updater archive/signature, `latest.json` version/endpoints/signature, and draft body against the extracted 0.1.3 notes.
- [ ] 12.3 Download and inspect the draft DMG/update artifacts, run the packaged macOS smoke path for pagination, Markdown notes, home version button, editor version button, update-note reopening, and Gatekeeper instructions.
- [ ] 12.4 Publish the verified GitHub Release, then freshly verify the public release page, DMG, updater files, and `releases/latest/download/latest.json` all resolve to 0.1.3 so installed users can receive it.
- [ ] 12.5 Archive the completed OpenSpec change only after implementation, merge, release publication, and live updater verification are complete; retain the forward-fix fallback/runbook and report exact branch, PR, commit, tag, workflow, artifact, and publication evidence.

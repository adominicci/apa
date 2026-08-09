# Requirement-to-evidence matrix

Released implementation audited: `13ff98093259af01a24f8556e1c570604ab6aa37`,
the exact `main` commit tagged and published as `v0.1.3` after PR #26.

This matrix distinguishes implementation evidence from context and future
release work. A `PASS` row has repeatable evidence in the current tree. A
`LIMITED` row records a real boundary that must not be presented as stronger
evidence. A `PENDING` row belongs to a later approved task.

## Evidence boundaries

- [CI run 31317794308](https://github.com/adominicci/apa/actions/runs/31317794308)
  is green at the audited exact SHA. Its
  [WKWebView job](https://github.com/adominicci/apa/actions/runs/31317794308/job/93255747132)
  and
  [WebView2 job](https://github.com/adominicci/apa/actions/runs/31317794308/job/93255747084)
  run the visible native proof with the production pagination measurer and
  extension. Both engines require every positive-area authored text rectangle
  to avoid every real painted page-band marker across production, scale,
  parity, performance, reference, overflow, and oversized editable-text
  states. The Windows job also completes the strict trusted OS mouse,
  clipboard, dead-key `e` composition to exact `é`, and undo path: one Copy,
  one Paste, one trusted Dead key, a one-character document delta, and exact
  document/selection restoration after one Ctrl+Z. These jobs are
  embedded-engine evidence, not packaged-app evidence.
- [Merged-main CI run 31318884771](https://github.com/adominicci/apa/actions/runs/31318884771)
  is green at exact release commit `13ff98093259af01a24f8556e1c570604ab6aa37`,
  including unit, WKWebView, and WebView2 jobs.
- [Merged-main installer run 31318884763](https://github.com/adominicci/apa/actions/runs/31318884763)
  is green at the same release commit on macOS, Windows, and Ubuntu. The macOS
  job includes the narrow packaged launch/metadata/liveness smoke; separate
  manual inspection of the downloaded draft DMG verified the home/editor
  version controls, formatted release notes, an isolated multi-page essay, and
  clean visible page boundaries without claiming broader automated packaged
  interaction coverage.
- [Release workflow 31319176324](https://github.com/adominicci/apa/actions/runs/31319176324)
  created and verified the `v0.1.3` draft from exact tag target `13ff980`,
  including the universal DMG, updater archive/signature, `latest.json`, and
  the canonical changelog-derived release body. The verified release was then
  [published](https://github.com/adominicci/apa/releases/tag/v0.1.3), and the
  public latest-updater manifest and artifact URLs resolved to version 0.1.3.
- A local Chromium/in-app-browser inspection of the current implementation
  started at the first visible sheet and paused at every derived gray page
  band. All four boundaries were visually clear; the live DOM oracle examined
  60 positive-area authored text rectangles and found zero intersections.
  This is additional manual visual evidence, not a substitute for the current
  WKWebView/WebView2 jobs.
- DOCX evidence is generated and inspected by
  [`export.test.ts`](../../../../packages/docx-export/test/export.test.ts).
- The historical macOS manual-input result covered trusted composition,
  drag-across-gap, Copy, and Paste. It remains a separate local audit record;
  it is not substituted for current packaged interaction or a screen-reader
  traversal.
- The public [writing guide](https://www.essayist.app/guides/start-writing) and
  [settings guide](https://www.essayist.app/guides/settings) were freshly
  inspected on 2026-08-09 for functional context only: academic page setup,
  fixed paper geometry, margins, and page count. They are not evidence for
  Tesina. No name, code, text, asset, private behavior, or visual design was
  copied.

## Release closeout

- Implementation branch: `features/live-pagination-release-notes`.
- Reviewed feature PR: [#26](https://github.com/adominicci/apa/pull/26), merged
  directly into `main`; no `dev` branch existed, so no promotion PR was needed.
- Exact merged and released commit:
  `13ff98093259af01a24f8556e1c570604ab6aa37`; local `main` and `origin/main`
  were synchronized before tagging.
- Merged-main validation:
  [CI 31318884771](https://github.com/adominicci/apa/actions/runs/31318884771)
  and
  [installer build 31318884763](https://github.com/adominicci/apa/actions/runs/31318884763),
  both at the exact released commit.
- Annotated tag: `v0.1.3`, targeting the exact merged commit above.
- Release artifact workflow:
  [31319176324](https://github.com/adominicci/apa/actions/runs/31319176324).
  Verified SHA-256 digests were
  `6e8be023ae5dc7116622d7df7aa2a47ff5ba663e371dbee4a69a8eca915f963e`
  for the universal DMG,
  `06cd70e76b17e14016b1199e8f59f1bacd80aa7df31d88e6e41dd25eb1568bc1`
  for the updater archive,
  `a9205bcae572142ff65e3feeb02d4d75ac13ff452cc42f61bee3bb4611870f6d`
  for its signature, and
  `d622fd94ba527ec0b0b9f5fef4ce1624b712227fe6d106f3f911999eb93fe2f1`
  for `latest.json`.
- Publication: public
  [Tesina v0.1.3 release](https://github.com/adominicci/apa/releases/tag/v0.1.3)
  plus the public
  [latest updater manifest](https://github.com/adominicci/apa/releases/latest/download/latest.json),
  freshly verified as version 0.1.3 with live DMG, updater, and signature URLs.
- Forward-fix rule: this archived record does not authorize rewriting the tag
  or published artifacts. A later defect follows the normal patch-release
  path with a new version, CI, installers, tag, and published updater manifest.

## Live editor pagination capability

| ID | OpenSpec scenario | Exact evidence | Status |
|---|---|---|---|
| LP-01 | Body grows beyond one page | [`plan.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/plan.test.ts), “starts a second page at the first overflowing line”; current WKWebView/WebView2 `productionPaginationStack`, `lineLevelContinuation`, `visualGapIsReal`, and `livePagedLetterGeometry` checks; every native stable-state painted band has positive marker coverage and zero authored-text intersections | PASS |
| LP-02 | Content is removed | [`plan.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/plan.test.ts), “reflows backward and removes an unnecessary trailing page after deletion”; both native jobs prove authored deletion reflow and trailing-page removal | PASS |
| LP-03 | New paper opens with cover, body, and empty references pages | [`pageComposition.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/pageComposition.test.ts), “numbers cover, authored pages, and one empty references page in order”; [`CoverSheet.test.ts`](../../../../apps/desktop/src/lib/components/CoverSheet.test.ts); [`referencePages.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/referencePages.test.ts) | PASS — combined creation primitives; no packaged creation walkthrough yet |
| LP-04 | Paginated essay is saved and reopened | [`essays.svelte.test.ts`](../../../../apps/desktop/src/lib/state/essays.svelte.test.ts), “reopens old and current schema-version 2 papers without pagination drift”; [`extension.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/extension.test.ts), “recalculates identical derived flow after authored JSON is saved and reopened” | PASS — persistence identity plus recalculated derived flow |
| LP-05 | Existing schema-version 2 essay opens | Frozen pre-pagination literal in [`essays.svelte.test.ts`](../../../../apps/desktop/src/lib/state/essays.svelte.test.ts) proves authored/reference/asset identity and no pagination fields; the extension reopen test proves the same serialized authored JSON derives the same page plan | PASS |
| LP-06 | Window width changes | [`paperScale.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/paperScale.test.ts) and [`EditorScreen.test.ts`](../../../../apps/desktop/src/lib/components/EditorScreen.test.ts), “fits narrow and wide canvases without repaginating”; both native jobs prove scale-invariant count and transformed hit testing | PASS |
| LP-07 | Long body precedes references | [`pageComposition.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/pageComposition.test.ts), “keeps optional abstract and multi-page body before references”; current native parity section order includes body continuations before references | PASS |
| LP-08 | Long appendix flows, then the next appendix starts | [`plan.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/plan.test.ts), “derives every continuation page of one long appendix before the next appendix”; [`pageComposition.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/pageComposition.test.ts) keeps all reference pages before every appendix page | PASS |
| LP-09 | References change | [`referenceDecoration.test.ts`](../../../../apps/desktop/src/lib/editor/referenceDecoration.test.ts), “commits only the latest measured reference count and repaginates after deletion”; [`extension.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/extension.test.ts) now settles and asserts the changed later page number; current native reference-refresh operation passes | PASS |
| LP-10 | Paragraph crosses a page boundary | [`plan.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/plan.test.ts), two-line widow/orphan cases; both native jobs prove line-level continuation and zero intersection between every positive-area authored text rect and every painted page band | PASS |
| LP-11 | Heading approaches a boundary | [`plan.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/plan.test.ts), “moves a heading with its first following line”; [`measure.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/measure.test.ts) covers normal block headings, oversized block headings, wrapped H4/H5 run-in heading-only lines, terminal-line keep behavior, and shared gap-normalized coordinates; both native engines require oversized block and run-in headings to split at real authored line positions with zero painted-band intersections | PASS |
| LP-12 | Figure or equation does not fit | [`plan.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/plan.test.ts), atomic movement; [`measure.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/measure.test.ts), production figure/equation measurement; both native jobs prove figure movement and equation measurement | PASS |
| LP-13 | Table crosses a boundary | [`plan.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/plan.test.ts), whole-row boundary, complete preamble keep-chain, and repeated-header cases; [`measure.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/measure.test.ts) splits oversized editable titles/notes by real lines; [`extension.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/extension.test.ts) proves valid row gaps and styled inert repeated headers; both native jobs prove title, note, row-overflow, repeated-header, and zero-intersection geometry | PASS |
| LP-14 | Content is taller than one printable page | [`plan.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/plan.test.ts) proves bounded overflow records, repeated-header-aware row limits, forward progress, and deterministic following-page spacing; [`extension.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/extension.test.ts) paints the exact authored atomic/row nodes as bounded outlined local scrollers without changing JSON; [`referencePages.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/referencePages.test.ts) and native proof cover independently bounded oversized references; both native engines require reachable content, bounded geometry, following-sheet separation, and zero painted-band intersections | PASS |
| LP-15 | User types across a boundary | [`extension.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/extension.test.ts), authored transaction mapping without history/JSON; both native jobs prove caret/input traversal and formatting across the gap | PASS |
| LP-16 | User selects across pages | Gap widgets are non-editable and selection-ignored in [`extension.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/extension.test.ts); native drag selection and script selection cross a real gap | PASS |
| LP-17 | User undoes a pagination-changing edit | [`disposablePaginationProof.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/proof/disposablePaginationProof.test.ts) proves one-step authored undo; current Windows native job proves exact OS-input edit plus one real Ctrl+Z restores document and selection identity | PASS |
| LP-18 | Page count changes while typing | [`EditorScreen.test.ts`](../../../../apps/desktop/src/lib/components/EditorScreen.test.ts), “shows localized live pagination lifecycle without a words-based estimate”, now performs an authored edit and proves old count during settling followed by the new stable count | PASS |
| LP-19 | Whole paper is counted | [`plan.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/plan.test.ts), all authored sections plus references; [`pageComposition.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/pageComposition.test.ts), cover/authored/references order; both native jobs prove exact live status count | PASS |
| LP-20 | Whole paper is numbered | [`CoverSheet.test.ts`](../../../../apps/desktop/src/lib/components/CoverSheet.test.ts), [`pageComposition.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/pageComposition.test.ts), and [`referenceDecoration.test.ts`](../../../../apps/desktop/src/lib/editor/referenceDecoration.test.ts) prove sequential inert chrome across cover, authored, reference, and appendix pages | PASS |
| LP-21 | Pagination changes and later numbers update | [`extension.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/extension.test.ts), “numbers authored pages around derived references without changing JSON”, now proves old numbers remain while settling and both reference-driven and authored-edit-driven numbers update only after settlement | PASS |
| LP-22 | Page chrome is copied or read | [`extension.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/extension.test.ts) proves gap/page chrome is `contenteditable=false`, `aria-hidden`, untabbable, selection-ignored, and absent from authored JSON; native Copy/Paste proves authored selection text across a gap | PASS — DOM accessibility and copy contract; a manual VoiceOver/NVDA walkthrough remains additional evidence |
| LP-23 | Deterministic fixture matches preview/Paged.js | [`nativePerformance.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/proof/nativePerformance.test.ts) rejects geometry/type drift; both current native jobs prove Paged.js page-count/section-order parity, Letter geometry, Times New Roman 12, and Georgia 11 | PASS — exact current-SHA native evidence |
| LP-24 | Word export preserves APA geometry without live breaks | [`export.test.ts`](../../../../packages/docx-export/test/export.test.ts), “keeps live pagination chrome out of Word while preserving APA page geometry”, proves Letter, one-inch margins, selected font/size, double spacing, and no automatic manual page breaks | PASS — DOCX XML evidence |
| LP-25 | Layout measurement fails | [`extension.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/extension.test.ts), continuous editable fallback plus autosave/preview/export with a missing asset; [`measure.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/measure.test.ts), late fonts/images and teardown | PASS |
| LP-26 | No stable plan exists yet | [`extension.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/extension.test.ts), first-plan failure and last-stable fallback; [`EditorScreen.test.ts`](../../../../apps/desktop/src/lib/components/EditorScreen.test.ts), localized pending/unavailable state without an estimate | PASS |
| LP-27 | User types rapidly | [`performanceBudget.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/performanceBudget.test.ts) proves transaction isolation/coalescing structurally; both current native jobs run representative 10/25/50-page fixtures and enforce fixed timing, no synchronous reads, stale/duplicate commits, oscillation, or fallback | PASS — exact current-SHA native performance evidence |

## Release-notes access capability

| ID | OpenSpec scenario | Exact evidence | Status |
|---|---|---|---|
| RN-01 | Current changelog notes open as semantic Markdown | [`bundledReleaseNotes.test.ts`](../../../../apps/desktop/src/lib/update/bundledReleaseNotes.test.ts) binds the package version to its exact changelog section; [`Modal.test.ts`](../../../../apps/desktop/src/lib/components/Modal.test.ts) and [`MarkdownContent.test.ts`](../../../../apps/desktop/src/lib/components/MarkdownContent.test.ts) prove semantic headings/lists without literal markers | PASS |
| RN-02 | Unsupported Markdown remains readable without breaking the modal | [`MarkdownContent.test.ts`](../../../../apps/desktop/src/lib/components/MarkdownContent.test.ts), malformed/unsupported readable fallback; [`Modal.test.ts`](../../../../apps/desktop/src/lib/components/Modal.test.ts), width-bounded, viewport-height-bounded, scrolling-body, wrap-anywhere containment contract | PASS at component/source-contract level; packaged narrow layout remains PENDING |
| RN-03 | Raw HTML/event handlers are inert | [`MarkdownContent.test.ts`](../../../../apps/desktop/src/lib/components/MarkdownContent.test.ts), removal of executable/styling/foreign/embed content with no resource load | PASS |
| RN-04 | Unsafe links are inert and readable | [`MarkdownContent.test.ts`](../../../../apps/desktop/src/lib/components/MarkdownContent.test.ts), unsafe and non-absolute destinations have no `href` while labels remain | PASS |
| RN-05 | Safe HTTPS links use the app opener | [`MarkdownContent.test.ts`](../../../../apps/desktop/src/lib/components/MarkdownContent.test.ts), delegated absolute-HTTPS activation calls only the Tauri opener | PASS |
| RN-06 | Installed update relaunches into canonical one-time notes | [`releaseNotesController.test.ts`](../../../../apps/desktop/src/lib/update/releaseNotesController.test.ts), matching marker trigger, canonical-body precedence, exact-marker dismissal; [`LayoutReleaseNotes.test.ts`](../../../../apps/desktop/src/lib/components/LayoutReleaseNotes.test.ts), startup/updater precedence | PASS at controller/layout level |
| RN-07 | Stale pending notes are ignored | Controller and layout tests in the preceding files prove stale markers neither auto-open nor replace installed notes | PASS |
| RN-08 | Automatic notes reopen manually with identical version/body | [`releaseNotesController.test.ts`](../../../../apps/desktop/src/lib/update/releaseNotesController.test.ts), “reopens the exact same version and body after automatic dismissal” | PASS |
| RN-09 | Dismissed notes remain manually available | The same controller test plus [`EssayHome.test.ts`](../../../../apps/desktop/src/lib/components/EssayHome.test.ts), open/dismiss/reopen/focus return | PASS |
| RN-10 | Notes remain available offline and without storage | Controller offline/failure tests and [`LayoutReleaseNotes.test.ts`](../../../../apps/desktop/src/lib/components/LayoutReleaseNotes.test.ts), “exposes bundled installed notes through the layout context without storage” | PASS at local controller/component level; packaged offline walkthrough PENDING |
| RN-11 | Home shows the installed version as a control | [`EssayHome.test.ts`](../../../../apps/desktop/src/lib/components/EssayHome.test.ts), actual shared version, native `button`, localized label/tooltip, APA edition adjacency | PASS |
| RN-12 | Editor status bar shows the installed version as a control | [`EditorScreen.test.ts`](../../../../apps/desktop/src/lib/components/EditorScreen.test.ts), native version button beside APA 7 and retained in focus mode | PASS |
| RN-13 | Runtime lookup failure uses packaged fallback | [`releaseNotesController.test.ts`](../../../../apps/desktop/src/lib/update/releaseNotesController.test.ts), offline and pending runtime cases; parameterized malformed-runtime component coverage in [`EssayHome.test.ts`](../../../../apps/desktop/src/lib/components/EssayHome.test.ts) | PASS |
| RN-14 | Runtime/package mismatch shows actual version and unavailable state | Controller, layout, and editor mismatch tests prove actual runtime label plus localized unavailable copy without mislabeling the bundled body | PASS |
| RN-15 | Home version opens only installed notes | [`EssayHome.test.ts`](../../../../apps/desktop/src/lib/components/EssayHome.test.ts), matching canonical body, no navigation/create/open side effect, dismissal/reopen, focus return | PASS |
| RN-16 | Editor version opens the same current notes without essay mutation | [`EditorScreen.test.ts`](../../../../apps/desktop/src/lib/components/EditorScreen.test.ts), canonical matching-runtime notes plus mismatch-safe notes, exact editor/essay identity, no navigation, focus return | PASS |
| RN-17 | Enter/Space opens notes and focus returns | Both entry points are native `type="button"` controls and the real click path moves focus into the dialog and restores the exact opener in the home/editor tests | PASS — native button keyboard semantics plus real handler/focus lifecycle; a packaged OS-key walkthrough remains additional evidence |
| RN-18 | Tab/Shift+Tab remain in the modal and background is inert | [`Modal.test.ts`](../../../../apps/desktop/src/lib/components/Modal.test.ts), forward/reverse wrapping, no-focusable fallback, exact inert/aria-hidden restoration, opener return | PASS |
| RN-19 | UI switches between English and Spanish without corrupting notes | Separate EN/ES version-control assertions in home/editor tests; [`Modal.test.ts`](../../../../apps/desktop/src/lib/components/Modal.test.ts), full title/Close/Done rebuild in both locales while heading/list structure stays identical; controller mismatch copy refresh test | PASS |

## Explicit conversation and delivery requirements

| ID | Requirement | Evidence or owner | Status |
|---|---|---|---|
| C-01 | The body behaves like a word processor on Letter-sized pages instead of one long sheet | LP-01 through LP-03, canonical [`geometry.test.ts`](../../../../apps/desktop/src/lib/editor/pagination/geometry.test.ts), and current native visual-gap/flow evidence | PASS |
| C-02 | APA text flows automatically page to page; users do not author page breaks | Decoration-derived planner/extension evidence and LP-24 DOCX no-manual-break invariant | PASS |
| C-03 | Notes use a reusable Markdown-rendering component | [`MarkdownContent.svelte`](../../../../apps/desktop/src/lib/components/MarkdownContent.svelte), security/semantic tests RN-01 through RN-05, and modal integration | PASS |
| C-04 | The version is visible and clickable on the main page and editor bottom status bar | RN-11 through RN-16 | PASS |
| C-05 | Both version controls show the same installed-version notes and can reopen them | Shared controller and canonical body evidence RN-08, RN-09, RN-15, RN-16 | PASS |
| C-06 | Use the public academic editor only as functional pagination context | Fresh 2026-08-09 public-guide inspection recorded above; clean-room fixture provenance in [`longDocumentFixture.ts`](../../../../apps/desktop/src/lib/editor/pagination/proof/longDocumentFixture.ts) | CONTEXT ONLY — never implementation evidence |
| C-07 | Specify and track the change with OpenSpec | Proposal, design, both capability specs, this matrix, and [`tasks.md`](./tasks.md) | PASS — all 74 tasks complete; strict validation green before archive |
| C-08 | Execute the approved Superpowers end-to-end flow with independent gap review | Task checkpoints, RED→GREEN tests, independent pagination/release audits, focused native-host correction review, screenshot-blocker diagnosis, slow browser sweep, and exact-head Codex review | PASS — implementation, review, merge, release, and publication complete with no unresolved Critical/Important findings |
| C-09 | Keep implementation isolated in a worktree | Worktree `/Users/andresdominicci/Projects/apa/.worktrees/live-pagination-release-notes`, branch `features/live-pagination-release-notes`; containment/parity rechecked at every checkpoint | PASS |
| C-10 | Test before launching the app for final manual testing | Automated Task 9 gates, merged-main native CI, merged-main installers, and the downloaded draft-DMG walkthrough ran in that order | PASS — manual packaged inspection followed green automated evidence |
| C-11 | Current-version notes are inspectable now; the next release gets synchronized plain-English notes/version | Current package `0.1.3` is bound byte-for-byte to its plain-English changelog body by `bundledReleaseNotes.test.ts`; `verify-release-version.test.ts` proves package, Tauri, Cargo, Cargo.lock, automatic/manual presentation, and workflow-body parity; release workflow 31319176324 and public `v0.1.3` publication close the artifact/update path | PASS |
| C-12 | Do not pause for platform-specific composition-event parity | Windows requires the real composed `é`, authored identity, and exact undo while composition counts are diagnostic; macOS retains trusted composition evidence, as specified in [`tasks.md`](./tasks.md) 3.7 and enforced by current native tests | PASS |

## Honest residual boundaries

1. Page chrome is structurally excluded from editing, selection, authored JSON,
   and accessibility exposure, and copy-across-gap evidence is green. A current
   VoiceOver/NVDA traversal and packaged page-number Copy remain useful
   additional manual evidence rather than scenario blockers.
2. Native buttons provide the platform Enter/Space activation contract and the
   real click/focus lifecycle is tested. Packaged clicking/reopening was
   manually observed, but a packaged OS-key walkthrough for both controls is
   still additional accessibility evidence rather than a release blocker.
3. The automated packaged smoke remains intentionally narrow: it proves
   launch, metadata, and liveness. The separate downloaded-DMG walkthrough is
   manual evidence and does not replace automated IPC, persistence, or
   installer-UX coverage.
4. Release `v0.1.3` is merged, tagged, artifact-verified, published, and exposed
   through the public latest-updater manifest. Any later defect must follow the
   normal forward-fix release path; this archive is evidence, not a rollback or
   hotfix mechanism.

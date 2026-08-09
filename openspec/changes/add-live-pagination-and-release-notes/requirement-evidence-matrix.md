# Requirement-to-evidence matrix

Candidate audited: `c2d98f296eeca3e43bd1ab627c66b67e3fe9bdb8` before the
Task 9 evidence-only test additions.

This matrix distinguishes implementation evidence from context and future
release work. A `PASS` row has repeatable evidence in the current tree. A
`LIMITED` row records a real boundary that must not be presented as stronger
evidence. A `PENDING` row belongs to a later approved task.

## Evidence boundaries

- [CI run 31295571133](https://github.com/adominicci/apa/actions/runs/31295571133)
  is green at the audited exact SHA. Its
  [WKWebView job](https://github.com/adominicci/apa/actions/runs/31295571133/job/93200003970)
  and
  [WebView2 job](https://github.com/adominicci/apa/actions/runs/31295571133/job/93200003956)
  run the visible native proof with the production pagination measurer and
  extension. The Windows job also completes the strict trusted OS mouse,
  clipboard, dead-key, and undo path. These jobs are embedded-engine evidence,
  not packaged-app evidence.
- [Installer run 31293366301](https://github.com/adominicci/apa/actions/runs/31293366301)
  is green at earlier code SHA `64456fe`. Its
  [macOS packaged smoke](https://github.com/adominicci/apa/actions/runs/31293366301/job/93194365934)
  proves the bundle identifier, version metadata, launch, and three-second
  liveness only. It explicitly does not prove editing, release-note
  interaction, IPC/plugin persistence, or installer UX.
- DOCX evidence is generated and inspected by
  [`export.test.ts`](../../../packages/docx-export/test/export.test.ts).
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

## Live editor pagination capability

| ID | OpenSpec scenario | Exact evidence | Status |
|---|---|---|---|
| LP-01 | Body grows beyond one page | [`plan.test.ts`](../../../apps/desktop/src/lib/editor/pagination/plan.test.ts), “starts a second page at the first overflowing line”; current WKWebView/WebView2 `productionPaginationStack`, `lineLevelContinuation`, `visualGapIsReal`, and `livePagedLetterGeometry` checks | PASS |
| LP-02 | Content is removed | [`plan.test.ts`](../../../apps/desktop/src/lib/editor/pagination/plan.test.ts), “reflows backward and removes an unnecessary trailing page after deletion”; both native jobs prove authored deletion reflow and trailing-page removal | PASS |
| LP-03 | New paper opens with cover, body, and empty references pages | [`pageComposition.test.ts`](../../../apps/desktop/src/lib/editor/pagination/pageComposition.test.ts), “numbers cover, authored pages, and one empty references page in order”; [`CoverSheet.test.ts`](../../../apps/desktop/src/lib/components/CoverSheet.test.ts); [`referencePages.test.ts`](../../../apps/desktop/src/lib/editor/pagination/referencePages.test.ts) | PASS — combined creation primitives; no packaged creation walkthrough yet |
| LP-04 | Paginated essay is saved and reopened | [`essays.svelte.test.ts`](../../../apps/desktop/src/lib/state/essays.svelte.test.ts), “reopens old and current schema-version 2 papers without pagination drift”; [`extension.test.ts`](../../../apps/desktop/src/lib/editor/pagination/extension.test.ts), “recalculates identical derived flow after authored JSON is saved and reopened” | PASS — persistence identity plus recalculated derived flow |
| LP-05 | Existing schema-version 2 essay opens | Frozen pre-pagination literal in [`essays.svelte.test.ts`](../../../apps/desktop/src/lib/state/essays.svelte.test.ts) proves authored/reference/asset identity and no pagination fields; the extension reopen test proves the same serialized authored JSON derives the same page plan | PASS |
| LP-06 | Window width changes | [`paperScale.test.ts`](../../../apps/desktop/src/lib/editor/pagination/paperScale.test.ts) and [`EditorScreen.test.ts`](../../../apps/desktop/src/lib/components/EditorScreen.test.ts), “fits narrow and wide canvases without repaginating”; both native jobs prove scale-invariant count and transformed hit testing | PASS |
| LP-07 | Long body precedes references | [`pageComposition.test.ts`](../../../apps/desktop/src/lib/editor/pagination/pageComposition.test.ts), “keeps optional abstract and multi-page body before references”; current native parity section order includes body continuations before references | PASS |
| LP-08 | Long appendix flows, then the next appendix starts | [`plan.test.ts`](../../../apps/desktop/src/lib/editor/pagination/plan.test.ts), “derives every continuation page of one long appendix before the next appendix”; [`pageComposition.test.ts`](../../../apps/desktop/src/lib/editor/pagination/pageComposition.test.ts) keeps all reference pages before every appendix page | PASS |
| LP-09 | References change | [`referenceDecoration.test.ts`](../../../apps/desktop/src/lib/editor/referenceDecoration.test.ts), “commits only the latest measured reference count and repaginates after deletion”; [`extension.test.ts`](../../../apps/desktop/src/lib/editor/pagination/extension.test.ts) now settles and asserts the changed later page number; current native reference-refresh operation passes | PASS |
| LP-10 | Paragraph crosses a page boundary | [`plan.test.ts`](../../../apps/desktop/src/lib/editor/pagination/plan.test.ts), two-line widow/orphan cases; both native jobs prove line-level continuation | PASS |
| LP-11 | Heading approaches a boundary | [`plan.test.ts`](../../../apps/desktop/src/lib/editor/pagination/plan.test.ts), “moves a heading with its first following line”; native proof covers run-in heading geometry | PASS |
| LP-12 | Figure or equation does not fit | [`plan.test.ts`](../../../apps/desktop/src/lib/editor/pagination/plan.test.ts), atomic movement; [`measure.test.ts`](../../../apps/desktop/src/lib/editor/pagination/measure.test.ts), production figure/equation measurement; both native jobs prove figure movement and equation measurement | PASS |
| LP-13 | Table crosses a boundary | [`plan.test.ts`](../../../apps/desktop/src/lib/editor/pagination/plan.test.ts), whole-row boundary and repeated-header cases; [`extension.test.ts`](../../../apps/desktop/src/lib/editor/pagination/extension.test.ts), valid table-row gap; both native jobs prove the table continuation path | PASS |
| LP-14 | Content is taller than one printable page | [`plan.test.ts`](../../../apps/desktop/src/lib/editor/pagination/plan.test.ts) proves one bounded overflow record, forward progress, and deterministic following-page spacing for atomic blocks and rows; fallback/editability coverage is in [`extension.test.ts`](../../../apps/desktop/src/lib/editor/pagination/extension.test.ts) | LIMITED — bounded stable treatment is proved, but no distinct painted overflow indicator is asserted |
| LP-15 | User types across a boundary | [`extension.test.ts`](../../../apps/desktop/src/lib/editor/pagination/extension.test.ts), authored transaction mapping without history/JSON; both native jobs prove caret/input traversal and formatting across the gap | PASS |
| LP-16 | User selects across pages | Gap widgets are non-editable and selection-ignored in [`extension.test.ts`](../../../apps/desktop/src/lib/editor/pagination/extension.test.ts); native drag selection and script selection cross a real gap | PASS |
| LP-17 | User undoes a pagination-changing edit | [`disposablePaginationProof.test.ts`](../../../apps/desktop/src/lib/editor/pagination/proof/disposablePaginationProof.test.ts) proves one-step authored undo; current Windows native job proves exact OS-input edit plus one real Ctrl+Z restores document and selection identity | PASS |
| LP-18 | Page count changes while typing | [`EditorScreen.test.ts`](../../../apps/desktop/src/lib/components/EditorScreen.test.ts), “shows localized live pagination lifecycle without a words-based estimate”, now performs an authored edit and proves old count during settling followed by the new stable count | PASS |
| LP-19 | Whole paper is counted | [`plan.test.ts`](../../../apps/desktop/src/lib/editor/pagination/plan.test.ts), all authored sections plus references; [`pageComposition.test.ts`](../../../apps/desktop/src/lib/editor/pagination/pageComposition.test.ts), cover/authored/references order; both native jobs prove exact live status count | PASS |
| LP-20 | Whole paper is numbered | [`CoverSheet.test.ts`](../../../apps/desktop/src/lib/components/CoverSheet.test.ts), [`pageComposition.test.ts`](../../../apps/desktop/src/lib/editor/pagination/pageComposition.test.ts), and [`referenceDecoration.test.ts`](../../../apps/desktop/src/lib/editor/referenceDecoration.test.ts) prove sequential inert chrome across cover, authored, reference, and appendix pages | PASS |
| LP-21 | Pagination changes and later numbers update | [`extension.test.ts`](../../../apps/desktop/src/lib/editor/pagination/extension.test.ts), “numbers authored pages around derived references without changing JSON”, now proves old numbers remain while settling and both reference-driven and authored-edit-driven numbers update only after settlement | PASS |
| LP-22 | Page chrome is copied or read | [`extension.test.ts`](../../../apps/desktop/src/lib/editor/pagination/extension.test.ts) proves gap/page chrome is `contenteditable=false`, `aria-hidden`, untabbable, selection-ignored, and absent from authored JSON; native Copy/Paste proves authored selection text across a gap | PASS — DOM accessibility and copy contract; a manual VoiceOver/NVDA walkthrough remains additional evidence |
| LP-23 | Deterministic fixture matches preview/Paged.js | [`nativePerformance.test.ts`](../../../apps/desktop/src/lib/editor/pagination/proof/nativePerformance.test.ts) rejects geometry/type drift; both current native jobs prove Paged.js page-count/section-order parity, Letter geometry, Times New Roman 12, and Georgia 11 | PASS — exact current-SHA native evidence |
| LP-24 | Word export preserves APA geometry without live breaks | [`export.test.ts`](../../../packages/docx-export/test/export.test.ts), “keeps live pagination chrome out of Word while preserving APA page geometry”, proves Letter, one-inch margins, selected font/size, double spacing, and no automatic manual page breaks | PASS — DOCX XML evidence |
| LP-25 | Layout measurement fails | [`extension.test.ts`](../../../apps/desktop/src/lib/editor/pagination/extension.test.ts), continuous editable fallback plus autosave/preview/export with a missing asset; [`measure.test.ts`](../../../apps/desktop/src/lib/editor/pagination/measure.test.ts), late fonts/images and teardown | PASS |
| LP-26 | No stable plan exists yet | [`extension.test.ts`](../../../apps/desktop/src/lib/editor/pagination/extension.test.ts), first-plan failure and last-stable fallback; [`EditorScreen.test.ts`](../../../apps/desktop/src/lib/components/EditorScreen.test.ts), localized pending/unavailable state without an estimate | PASS |
| LP-27 | User types rapidly | [`performanceBudget.test.ts`](../../../apps/desktop/src/lib/editor/pagination/performanceBudget.test.ts) proves transaction isolation/coalescing structurally; both current native jobs run representative 10/25/50-page fixtures and enforce fixed timing, no synchronous reads, stale/duplicate commits, oscillation, or fallback | PASS — exact current-SHA native performance evidence |

## Release-notes access capability

| ID | OpenSpec scenario | Exact evidence | Status |
|---|---|---|---|
| RN-01 | Current changelog notes open as semantic Markdown | [`bundledReleaseNotes.test.ts`](../../../apps/desktop/src/lib/update/bundledReleaseNotes.test.ts) binds the package version to its exact changelog section; [`Modal.test.ts`](../../../apps/desktop/src/lib/components/Modal.test.ts) and [`MarkdownContent.test.ts`](../../../apps/desktop/src/lib/components/MarkdownContent.test.ts) prove semantic headings/lists without literal markers | PASS |
| RN-02 | Unsupported Markdown remains readable without breaking the modal | [`MarkdownContent.test.ts`](../../../apps/desktop/src/lib/components/MarkdownContent.test.ts), malformed/unsupported readable fallback; [`Modal.test.ts`](../../../apps/desktop/src/lib/components/Modal.test.ts), width-bounded, viewport-height-bounded, scrolling-body, wrap-anywhere containment contract | PASS at component/source-contract level; packaged narrow layout remains PENDING |
| RN-03 | Raw HTML/event handlers are inert | [`MarkdownContent.test.ts`](../../../apps/desktop/src/lib/components/MarkdownContent.test.ts), removal of executable/styling/foreign/embed content with no resource load | PASS |
| RN-04 | Unsafe links are inert and readable | [`MarkdownContent.test.ts`](../../../apps/desktop/src/lib/components/MarkdownContent.test.ts), unsafe and non-absolute destinations have no `href` while labels remain | PASS |
| RN-05 | Safe HTTPS links use the app opener | [`MarkdownContent.test.ts`](../../../apps/desktop/src/lib/components/MarkdownContent.test.ts), delegated absolute-HTTPS activation calls only the Tauri opener | PASS |
| RN-06 | Installed update relaunches into canonical one-time notes | [`releaseNotesController.test.ts`](../../../apps/desktop/src/lib/update/releaseNotesController.test.ts), matching marker trigger, canonical-body precedence, exact-marker dismissal; [`LayoutReleaseNotes.test.ts`](../../../apps/desktop/src/lib/components/LayoutReleaseNotes.test.ts), startup/updater precedence | PASS at controller/layout level |
| RN-07 | Stale pending notes are ignored | Controller and layout tests in the preceding files prove stale markers neither auto-open nor replace installed notes | PASS |
| RN-08 | Automatic notes reopen manually with identical version/body | [`releaseNotesController.test.ts`](../../../apps/desktop/src/lib/update/releaseNotesController.test.ts), “reopens the exact same version and body after automatic dismissal” | PASS |
| RN-09 | Dismissed notes remain manually available | The same controller test plus [`EssayHome.test.ts`](../../../apps/desktop/src/lib/components/EssayHome.test.ts), open/dismiss/reopen/focus return | PASS |
| RN-10 | Notes remain available offline and without storage | Controller offline/failure tests and [`LayoutReleaseNotes.test.ts`](../../../apps/desktop/src/lib/components/LayoutReleaseNotes.test.ts), “exposes bundled installed notes through the layout context without storage” | PASS at local controller/component level; packaged offline walkthrough PENDING |
| RN-11 | Home shows the installed version as a control | [`EssayHome.test.ts`](../../../apps/desktop/src/lib/components/EssayHome.test.ts), actual shared version, native `button`, localized label/tooltip, APA edition adjacency | PASS |
| RN-12 | Editor status bar shows the installed version as a control | [`EditorScreen.test.ts`](../../../apps/desktop/src/lib/components/EditorScreen.test.ts), native version button beside APA 7 and retained in focus mode | PASS |
| RN-13 | Runtime lookup failure uses packaged fallback | [`releaseNotesController.test.ts`](../../../apps/desktop/src/lib/update/releaseNotesController.test.ts), offline and pending runtime cases; parameterized malformed-runtime component coverage in [`EssayHome.test.ts`](../../../apps/desktop/src/lib/components/EssayHome.test.ts) | PASS |
| RN-14 | Runtime/package mismatch shows actual version and unavailable state | Controller, layout, and editor mismatch tests prove actual runtime label plus localized unavailable copy without mislabeling the bundled body | PASS |
| RN-15 | Home version opens only installed notes | [`EssayHome.test.ts`](../../../apps/desktop/src/lib/components/EssayHome.test.ts), matching canonical body, no navigation/create/open side effect, dismissal/reopen, focus return | PASS |
| RN-16 | Editor version opens the same current notes without essay mutation | [`EditorScreen.test.ts`](../../../apps/desktop/src/lib/components/EditorScreen.test.ts), canonical matching-runtime notes plus mismatch-safe notes, exact editor/essay identity, no navigation, focus return | PASS |
| RN-17 | Enter/Space opens notes and focus returns | Both entry points are native `type="button"` controls and the real click path moves focus into the dialog and restores the exact opener in the home/editor tests | PASS — native button keyboard semantics plus real handler/focus lifecycle; a packaged OS-key walkthrough remains additional evidence |
| RN-18 | Tab/Shift+Tab remain in the modal and background is inert | [`Modal.test.ts`](../../../apps/desktop/src/lib/components/Modal.test.ts), forward/reverse wrapping, no-focusable fallback, exact inert/aria-hidden restoration, opener return | PASS |
| RN-19 | UI switches between English and Spanish without corrupting notes | Separate EN/ES version-control assertions in home/editor tests; [`Modal.test.ts`](../../../apps/desktop/src/lib/components/Modal.test.ts), full title/Close/Done rebuild in both locales while heading/list structure stays identical; controller mismatch copy refresh test | PASS |

## Explicit conversation and delivery requirements

| ID | Requirement | Evidence or owner | Status |
|---|---|---|---|
| C-01 | The body behaves like a word processor on Letter-sized pages instead of one long sheet | LP-01 through LP-03, canonical [`geometry.test.ts`](../../../apps/desktop/src/lib/editor/pagination/geometry.test.ts), and current native visual-gap/flow evidence | PASS |
| C-02 | APA text flows automatically page to page; users do not author page breaks | Decoration-derived planner/extension evidence and LP-24 DOCX no-manual-break invariant | PASS |
| C-03 | Notes use a reusable Markdown-rendering component | [`MarkdownContent.svelte`](../../../apps/desktop/src/lib/components/MarkdownContent.svelte), security/semantic tests RN-01 through RN-05, and modal integration | PASS |
| C-04 | The version is visible and clickable on the main page and editor bottom status bar | RN-11 through RN-16 | PASS |
| C-05 | Both version controls show the same installed-version notes and can reopen them | Shared controller and canonical body evidence RN-08, RN-09, RN-15, RN-16 | PASS |
| C-06 | Use the public academic editor only as functional pagination context | Fresh 2026-08-09 public-guide inspection recorded above; clean-room fixture provenance in [`longDocumentFixture.ts`](../../../apps/desktop/src/lib/editor/pagination/proof/longDocumentFixture.ts) | CONTEXT ONLY — never implementation evidence |
| C-07 | Specify and track the change with OpenSpec | Proposal, design, both capability specs, this matrix, and [`tasks.md`](./tasks.md) | PASS through Task 9; strict validation rerun required before commit |
| C-08 | Execute the approved Superpowers end-to-end flow with independent gap review | Task checkpoints, RED→GREEN tests, current independent pagination/release audits, and the final blocker review required after this matrix | PASS through Task 9 |
| C-09 | Keep implementation isolated in a worktree | Worktree `/Users/andresdominicci/Projects/apa/.worktrees/live-pagination-release-notes`, branch `features/live-pagination-release-notes`; containment/parity rechecked at every checkpoint | PASS |
| C-10 | Test before launching the app for final manual testing | Automated Task 9 gates are the current owner; packaged interactive/manual launch is deliberately not claimed by the narrow smoke | PENDING — final packaged/manual gate is Task 12.3 after release preparation |
| C-11 | Current-version notes are inspectable now; the next release gets synchronized plain-English notes/version | Current package `0.1.3` is bound byte-for-byte to its plain-English changelog body by `bundledReleaseNotes.test.ts`; `verify-release-version.test.ts` proves package, Tauri, Cargo, Cargo.lock, automatic/manual presentation, and workflow-body parity | PASS at local release-preparation scope; tag/artifact/publication evidence remains Tasks 11–12 |
| C-12 | Do not pause for platform-specific composition-event parity | Windows requires the real composed `é`, authored identity, and exact undo while composition counts are diagnostic; macOS retains trusted composition evidence, as specified in [`tasks.md`](./tasks.md) 3.7 and enforced by current native tests | PASS |

## Honest residual boundaries

1. The planner records and bounds oversize atomic/table-row overflow and the
   native proof remains editable and finite, but there is no separate painted
   warning/indicator assertion. LP-14 is intentionally `LIMITED`.
2. Page chrome is structurally excluded from editing, selection, authored JSON,
   and accessibility exposure, and copy-across-gap evidence is green. A current
   VoiceOver/NVDA traversal and packaged page-number Copy remain useful
   additional manual evidence rather than scenario blockers.
3. Native buttons provide the platform Enter/Space activation contract and the
   real click/focus lifecycle is tested. A packaged OS-key walkthrough for both
   controls belongs to Task 12.3 and is not pre-claimed here.
4. The packaged smoke proves only launch/metadata/liveness at an earlier code
   SHA. It is not evidence for pagination editing, Markdown, buttons,
   accessibility, offline notes, persistence, or installer UX.
5. Version `0.1.3` and Cargo.lock/release-body enforcement are locally verified
   in Task 10. Exact-SHA native/package reruns, PR/merge, app launch/manual
   testing, tag, artifact inspection, publication, and updater verification
   remain Tasks 10.5–12 and are not pre-claimed here.

# Task 5 report — parity, resilience, performance, and native evidence

Date: 2026-08-08

Status: complete. Implementation, local verification, exact-SHA visible
WKWebView/WebView2 evidence, and the separate packaged macOS smoke are green.

## Outcomes and RED to GREEN evidence

- 5.1: A stable supported fixture now runs the real production live paginator
  and the real Paged.js previewer. The native proof requires equal total page
  count and ordered cover/abstract/body/references/appendix page sequence,
  direct live-versus-preview 8.5 by 11 inch geometry, 1 inch content geometry,
  and equal double-spaced type metrics for both Times New Roman 12 point and
  Georgia 11 point. RED was the prior static `size: letter` assertion with no
  runtime Paged.js parity. The parity evaluator and integration contract are
  GREEN locally; the real embedded-engine measurements remain part of 5.6's
  visible exact-SHA CI gate because the local desktop session is hidden.
- 5.2: DOCX regressions begin from authored JSON while a real editor pagination
  decoration is painted. They require no manual `w:br` page break, exactly the
  existing four semantic section starts, US Letter 12240 by 15840 twips,
  1440-twip margins, Times New Roman 12 point, and 480-twip double spacing. A
  deliberate 12241-twip production mutation failed the new assertion before it
  was restored.
- 5.3: A frozen serialized pre-pagination schema-version 2 paper and a
  separately factory-created current schema-version 2 paper are enumerated,
  loaded, saved, and reopened. Tests require both papers to stay visible, schema
  version 2, exact authored content/reference identity, one reference, asset
  path, and figure title, and no pagination field. A deliberate persisted
  `pagination` field failed the test before it was removed.
- 5.4: A bounded 5000 ms production readiness deadline prevents stalled fonts or
  images from leaving pagination permanently settling. A 25 ms controlled test
  first remained pending, then failed on the deadline after the fix. Existing
  and expanded tests cover measurement rejection, first-plan continuous
  fallback, retained last-stable state, missing figure asset, late/superseded
  resource epochs, oversize atomic content, and oscillation caps. The integrated
  missing-asset case puts the asset path in authored JSON before editor
  creation, drives a genuinely unresolved image through the production measurer
  deadline, edits through TipTap's real `onUpdate` autosave entry point,
  previews/exports while fallback is active, and observes a late native load
  invalidation. A separate real essay-store test persists and reopens that
  edited/missing-asset shape byte-identically without derived fields.
- 5.5: The fixed budget was written to `task-5-performance-budget.md` before the
  benchmark module existed. Its first test failed on that missing module. The
  local deterministic controller suite proves transaction isolation, frame
  coalescing, stable-epoch uniqueness, and the evaluator's mutation-sensitive
  budget rules; it is intentionally not presented as a browser layout benchmark.
  The expanded visible native proof calibrates exact rendered 10/25/50-page
  documents and measures real ProseMirror transactions, the production measurer
  and pagination plugin, native `requestAnimationFrame`, a real reference
  refresh, an actual selected font change, and scale-only resize. It records
  embedded engine and host runtime identity, requires no read inside the input
  transaction, at most one queued pagination frame, p95 <= 16 ms, max <= 32 ms,
  <= 8 frames per epoch, no stale/fallback or duplicate stable commit, and the
  immutable recorded settlement limits. The real timing values from the passing
  exact-SHA gate are reported below.
- 5.6: The native WKWebView/WebView2 proof retains its full long-document
  production evidence for first paint, body/line continuation, tables, figures,
  equations, caret/selection/input, deletion reflow, scaling and hit testing,
  JSON identity, page chrome, exact count, and adds actual Paged.js parity plus
  engine and geometry metrics. Local execution failed closed before the proof
  because the desktop-hosted document reported `visibilityState=hidden`,
  `animationFrame=false`, and `visibleDocument=false`; this was correctly
  treated as an environmental stop, not a parity result. Exact commit
  `194a709225145ea5814bc44ff75e73c90981ce50` then passed the complete visible
  proof on both macOS WKWebView and Windows WebView2 in CI run `31291649080`.
- 5.6 timeout envelope: the expanded proof originally inherited a 45 second
  page/host and 60 second outer deadline, which could kill a conforming run
  before the fixed workload ceilings plus calibration and two Paged.js passes
  completed. A mutation-sensitive contract now requires the expanded proof's
  route-specific 120 second page deadline, 135 second native-host deadline, and
  150 second outer-process deadline in that order. The independent 45 second
  self-test/driven-input host deadline, 60 second outer deadline, and 300 second
  manual deadline remain unchanged.
- 5.6 packaged smoke: workflow `31291876046` built a separate macOS Tauri
  artifact from exact commit `194a709225145ea5814bc44ff75e73c90981ce50` and
  launched its bundle executable. It proved bundle identifier
  `app.tesina.desktop`, app version `0.1.2`, process launch, and 3000 ms
  liveness on macOS 26.5.2 / WebKit 21624. All macOS, Windows, and Linux
  installer jobs passed. The smoke result explicitly excludes editing, IPC,
  plugin persistence, and installer UX. Shutdown is bounded to the exact owned
  child: SIGTERM, then SIGKILL after 5000 ms, then a final 2000 ms fail-closed
  deadline. The unrelated pre-existing Tesina process was not inspected or
  terminated.

## Performance result boundary

The jsdom suite is deterministic controller-contract evidence only. Its
synthetic fragments and immediate frame scheduler do not establish real layout
or responsiveness and therefore no jsdom timing is reported as a performance
result. These are the authoritative production-measurer timings from the
exact-SHA visible proof. Durations are milliseconds; each row is
`p95 input / max input`, then rapid typing, deletion, reference refresh, font
change, and scale-only resize settlement.

| Engine                  | Pages | Input p95/max | Rapid | Delete | References |  Font | Resize |
| ----------------------- | ----: | ------------: | ----: | -----: | ---------: | ----: | -----: |
| WKWebView 605.1.15      |    10 |         2 / 3 |    89 |     79 |         94 |   132 |     11 |
| WKWebView 605.1.15      |    25 |         2 / 3 |   161 |    202 |        236 |   339 |     42 |
| WKWebView 605.1.15      |    50 |         3 / 4 |   308 |    295 |        266 |   492 |     18 |
| WebView2 150.0.4078.105 |    10 |     0.7 / 0.8 |  90.4 |   77.1 |       93.1 |  90.6 |    3.1 |
| WebView2 150.0.4078.105 |    25 |     1.8 / 2.1 | 127.7 |  117.4 |      103.7 | 167.4 |    3.4 |
| WebView2 150.0.4078.105 |    50 |     1.4 / 2.2 | 286.3 |    222 |        186 | 789.4 |    7.2 |

Every workload authored exactly its target page count, queued at most one
pagination frame, performed zero layout reads during the authored input
transaction, committed one stable causal result for each paginating operation,
and reported zero stale, duplicate, or fallback commits. Scale-only resize
performed zero pagination frames or commits. All timings are below the fixed
pre-implementation limits.

The WKWebView host was macOS arm64 on an Apple M1 virtual CPU with 3 logical
cores, 7 GiB RAM, Deno 2.9.5, and an AppleWebKit 605.1.15 user agent. The
WebView2 host was Windows x64 on an AMD EPYC 9V74 runner with 4 logical cores,
16 GiB RAM, Deno 2.9.5, and Edge/WebView2 150.0.4078.105. Both engines produced
six live and preview pages in the same
cover/abstract/body/body/references/appendix order, exact 816 by 1056 pixel
Letter geometry with 96 pixel margins, and matching Times New Roman 12 and
Georgia 11 double-spaced metrics.

## Verification

- Focused pagination/Task 5 suite: 32 files and 211 tests GREEN.
- `deno task check`: 0 errors, 0 warnings.
- `deno task test`: 92 files and 888 tests GREEN.
- `deno fmt`: GREEN.
- `deno lint`: GREEN.
- `openspec validate add-live-pagination-and-release-notes --strict`: valid.
- `git diff --check`: clean.
- Changed `.svelte` files: none; Svelte autofixer not applicable.
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check`:
  clean.
- Independent final-tree blocker review: PASS; no Critical or Important findings
  remain.
- Exact-SHA CI run `31291649080`: GREEN. WKWebView job `93190351791`, WebView2
  job `93190351061`, and the unit job all passed at
  `194a709225145ea5814bc44ff75e73c90981ce50`.
- The unchanged Windows native-input phase in that run also passed real mouse
  drag across a page gap, OS clipboard Copy/Paste, one US-International
  `SendInput` dead-key path inserting exactly one NFC `é`, and one Ctrl+Z
  restoring the exact authored document and selection.
- Exact-SHA installer workflow `31291876046`: GREEN on macOS, Windows, and
  Linux. The macOS job `93190354288` emitted a passing, SHA-bound packaged-smoke
  record with the narrow claims described above.

## First exact-SHA CI diagnostic

Candidate `6c0d03f` deliberately remained incomplete after CI exposed two
harness defects rather than production-semantic failures:

- The deterministic jsdom controller test still asserted the native 16 ms
  wall-clock budget and varied to 18.83–24.56 ms on shared Linux/Windows
  runners. Its wall-clock assertions are removed; structural isolation and
  coalescing remain locally mutation-sensitive, while the unchanged latency
  limits are enforced by the visible native evaluator using the production
  measurer/plugin and native frames.
- The native proof page imported deadline constants through the host-only
  command module, which pulled `node:path` into the Vite browser graph and
  failed the WKWebView bundle before launch. Deadlines now live in a
  browser-safe module shared by the page and host runner, while path/process
  code remains host-only. A local rerun built the Vite bundle successfully and
  then failed closed at the already-known hidden-document self-test.
- The PR run originally checked out and logged GitHub's synthetic merge SHA.
  Both native jobs now explicitly check out the pull-request head SHA and pass
  that same SHA to the host identity logger so engine evidence is produced by,
  and tied to, the exact candidate commit.

The separate macOS packaged smoke for `6c0d03f` passed, but it was not reused as
proof for a corrected candidate. The packaged workflow was dispatched again for
the final implementation SHA.

Candidate `f26d548` closed both first-run defects: its unit job passed, the
native page built and launched, and both native jobs checked out the exact head
SHA. The macOS proof then exposed a second harness defect at the first 10-page
workload: WKWebView delivered 240 requestAnimationFrame callbacks in about 72
ms, exhausting a frame-count waiter before timer/font/resource queues could
settle. The waiter now uses elapsed time, yields one macrotask plus one native
frame, and remains fail-closed. Initial settlement and every calibration retry
share one absolute 10 second pool per workload; no retry resets that deadline.
The three pools plus the unchanged 25.25 second measured-operation maximum and
55 seconds of legacy/parity headroom total 110.25 seconds, below the 120 second
page watchdog. Rapid typing/deletion and reference/font operations use the
unchanged per-workload limits recorded before implementation. Unit coverage
proves more than 240 fast frames may occur inside the same wall-clock budget,
expiration still rejects, and the shared setup pool only decreases. The packaged
workflow was fully green for `f26d548`, including its narrow macOS smoke, but
that earlier result was not reused; all final evidence refers to
`194a709225145ea5814bc44ff75e73c90981ce50`.

Subsequent visible-engine diagnostics exposed real production hot paths rather
than reasons to weaken the recorded budget. Gap widgets previously changed
identity when their mapped positions changed, and line measurement performed a
Range rectangle read for every character. Stable visual widget keys and one
whole-text-node rectangle enumeration plus bounded binary prefix probes removed
that churn while preserving exact ProseMirror line starts. The native harness
then added a condition-based quiescence barrier so it observes late work without
sleeping or extending any operation limit. Finally, the production
ResizeObserver was narrowed from the whole editor root to authored images, so
derived page chrome cannot recursively invalidate pagination while current and
future image load/error/resize still do.

The first Windows attempt at the final candidate completed the Task 5 payload
successfully but the later, separate Task 3 OS-input phase received no key or
clipboard events after its drag. No Task 5 or production change was made. One
failed-job rerun at the same exact SHA passed the entire unchanged job,
including native drag, clipboard, composed-character insertion, and undo. This
keeps both the Task 5 and Task 3 evidence fail-closed.

## Scope

Only OpenSpec Task 5 is implemented. No schema bump, new runtime dependency,
manual page break, lockfile change, or Task 6+ implementation is included.

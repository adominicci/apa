# Widget-Owned Page Gap Painting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan task by task.

**Goal:** Prevent authored text from ever painting through a derived inter-page gap by making the derived pagination widget own both the reserved geometry and the visible gray band, then prove the invariant in real embedded browsers.

**Architecture:** Remove the independent repeating background that currently paints page bands on a fixed 1,084px cadence. Each derived page-gap widget will contain one inert, queryable canvas-band element positioned at the exact 28px interval between the preceding sheet bottom and the following sheet top. Native proof will compare positive-area authored text client rectangles with those actual painted-band rectangles in the production editor, every 10/25/50-page workload checkpoint, scaled layout, and the final visible parity editor.

**Tech stack:** Deno 2, TypeScript, TipTap/ProseMirror decorations, CSS, Vitest/jsdom contracts, WKWebView and WebView2 native proof.

## Global Constraints

- This is a release blocker. Do not merge or release while any stable editor state can paint positive-area authored text inside a visible derived gap.
- The production editor must remain one ProseMirror document. Gaps, page numbers, reference sheets, and overflow treatment remain derived presentation only and must not alter saved JSON, selection, editing, undo, clipboard, or navigation behavior.
- The visible gray band and its reserved pagination geometry must share the same derived widget; no second fixed-cadence painter may remain.
- The painted band is exactly the canonical 28px inter-page canvas interval across the full 816px Letter sheet width, including at compensated scale. The printable sheet remains 816x1056 with 96px margins.
- Standard line/block gaps and table-row gaps must preserve valid DOM. A table gap remains `table > tbody > tr > td`; its painted marker belongs inside the cell.
- Painted-band DOM is inert: `contenteditable=false`, `aria-hidden=true`, untabbable, pointer-inert, user-select-inert, and excluded from authored measurement/copy.
- Native evidence must inspect the actual painted-band elements, not infer bands from parent gap rectangles or a mathematical cadence.
- Native evidence must cover the initial production stable state, each stable 10/25/50-page operation state, scale resize, and the final visible parity editor. Any intersection fails closed.
- Preserve the already-implemented keep-chain, oversize atomic/table-row treatment, hard-break measurement, page-number ordering, and Windows input proof fixes in the dirty slice.
- No Svelte files, dependency additions, schema-version changes, generated bundles, or unrelated worktree edits.
- Run `deno task check` before full Vitest. Final gates are `deno task check`, `deno task test`, `deno fmt --check`, `deno lint`, strict OpenSpec validation, `git diff --check`, visible WKWebView proof, exact-head WKWebView/WebView2 CI, and independent Critical/Important review.

## Task 1: Build Widget-Owned Painted Gaps Under RED-First Contracts

**Files:**

- Modify: `apps/desktop/src/lib/editor/apaCss.test.ts`
- Modify: `apps/desktop/src/lib/editor/pagination/extension.test.ts`
- Modify: `apps/desktop/src/lib/editor/pagination/proof/disposablePaginationProof.test.ts`
- Modify: `apps/desktop/src/lib/editor/pagination/proof/nativeProofGeometry.test.ts`
- Modify: `apps/desktop/src/lib/editor/pagination/extension.ts`
- Modify: `apps/desktop/src/lib/editor/pagination/proof/disposablePaginationProof.ts`
- Modify: `apps/desktop/src/lib/editor/apa.css`
- Modify: `apps/desktop/src/lib/editor/pagination/proof/nativeProof.css`

**Step 1: Add the production decoration contract**

Require every line/block gap to contain exactly one `[data-pagination-canvas-gap]` child and every table-row gap to contain the same marker inside its single `td`. Assert the marker is inert and that authored gap keys/DOM identity behavior remains unchanged.

**Step 2: Add the CSS ownership contract**

Require `.apa-editor .tiptap` to use a solid paper background and reject `repeating-linear-gradient`. Require `[data-pagination-canvas-gap]` to paint a full-width 816px, 28px canvas band at the canonical offset relative to the derived gap, with edge treatment but no interaction.

**Step 3: Add the oracle mutation contract**

Build a pure geometry fixture where the parent gap rectangle does not intersect authored text but the actual painted marker rectangle does. Require the painted-band oracle to report the intersection. This must fail if the implementation regresses to parent-gap geometry or fixed-cycle arithmetic.

**Step 4: Run the focused RED command**

Run:

```bash
/Users/andresdominicci/.deno/bin/deno run -A npm:vitest run \
  apps/desktop/src/lib/editor/apaCss.test.ts \
  apps/desktop/src/lib/editor/pagination/extension.test.ts \
  apps/desktop/src/lib/editor/pagination/proof/disposablePaginationProof.test.ts \
  apps/desktop/src/lib/editor/pagination/proof/nativeProofGeometry.test.ts
```

Expected: failures identify the absent canvas-band marker, retained repeating background, parent-gap oracle, and missing final-parity assertion.

**Step 5: Add the inert canvas-band element**

Create one helper that appends an inert `[data-pagination-canvas-gap]` marker. For line/block gaps append it to the spacer; for table-row gaps append it inside the gap cell. Keep the existing parent gap attributes and valid table structure.

**Step 6: Couple visual and reserved geometry**

Position the marker relative to its owning gap so its DOM rectangle is the exact 28px full-width gray interval immediately before the next 96px page top margin. Extend from the 624px content column to 816px with the canonical 96px left/right offsets. Ensure marker placement does not change the parent gap's measured height.

**Step 7: Remove the independent painter**

Replace the root editor's repeating gradient with solid paper. Move gray canvas color and sheet-edge border/shadow to the marker so there is exactly one visual source of truth.

**Step 8: Mirror the disposable proof**

Make disposable proof gap DOM use the same marker contract so proof-only feasibility paths cannot diverge from production.

**Step 9: Run focused GREEN tests**

Run the Task 1 command. Expected: all tests pass.

## Task 2: Prove Actual Painted-Band Geometry in Every Stable Native State

**Files:**

- Modify: `apps/desktop/src/lib/editor/pagination/proof/nativeProofGeometry.ts`
- Modify: `apps/desktop/src/lib/editor/pagination/proof/nativeProof.ts`
- Modify: `apps/desktop/src/lib/editor/pagination/proof/nativePerformance.ts`
- Modify: `apps/desktop/src/lib/editor/pagination/proof/nativePerformance.test.ts`
- Modify: `apps/desktop/src/lib/editor/pagination/proof/nativePerformanceHarnessContract.test.ts`
- Modify tests named in Task 1 as required

**Step 1: Capture actual painted marker rectangles**

Collect positive-area DOMRects only from `[data-pagination-canvas-gap]`. Assert marker count matches derived page-gap count where applicable and emit diagnostic rectangles on failure.

Before production edits, add a native source/result RED requiring the marker selector, positive marker coverage, per-state oracle samples, and final parity evidence. Zero intersections with zero samples must fail closed.

**Step 2: Collect authored text rectangles safely**

Walk authored positive-area text Ranges, exclude `contenteditable=false`/`aria-hidden=true` derived chrome, and compare each client rect against each actual painted band. Edge touching is allowed; positive-area overlap fails.

**Step 3: Cover the entire native lifecycle**

Run the oracle after initial production settlement, rapid typing, deletion, reference refresh, font change, resize/scale, every 10/25/50-page workload, and final visible parity settlement. Store counts/coverage in the fail-closed native result.

**Step 4: Reproduce the screenshot class**

Add a deliberate phase-offset mutation fixture where the fixed-cycle/parent-gap method would pass while text visibly overlaps the marker. Confirm the new oracle fails, then restore the correct implementation and rerun GREEN.

**Step 5: Run focused and visible native proof**

Run focused pagination tests followed by the visible WKWebView proof. Require `passed:true`, zero authored-text/painted-band intersections, positive marker coverage in all declared states, and unchanged overflow/performance/interaction checks.

Then open the stable proof in the in-app browser at page 1 and perform a deliberate top-to-bottom visual sweep. Scroll one sheet at a time, pause at every gray band, and verify that no positive-area authored glyph crosses a gray boundary. Record the exact page/boundary if anything overlaps; automated success does not replace this visual release-blocker check.

## Task 3: Final Verification, Review, and PR Evidence

**Files:**

- Preserve only the intended dirty slice plus this plan
- Update the ignored Task 11 report/checkpoint with RED/GREEN/native evidence

**Step 1: Restore incidental lock churn**

Restore any unrequested `deno.lock` resolver churn if package manifests did not change, then verify the exact tracked scope.

**Step 2: Run final local gates**

```bash
/Users/andresdominicci/.deno/bin/deno task check
/Users/andresdominicci/.deno/bin/deno task test
/Users/andresdominicci/.deno/bin/deno fmt --check
/Users/andresdominicci/.deno/bin/deno lint
/Users/andresdominicci/.deno/bin/deno run -A npm:@fission-ai/openspec@latest validate add-live-pagination-and-release-notes --strict
git diff --check
```

Expected: all green with zero Svelte warnings/errors and no unrelated files.

**Step 3: Obtain independent review**

Package the exact dirty diff and request a Critical/Important review focused on visual/geometry ownership, valid table DOM, authored-data identity, mutation sensitivity, native lifecycle coverage, and containment. Fix every valid blocker under fresh RED evidence.

**Step 4: Commit and push only after review**

Stage the exact intended scope, create one English commit, push the feature branch, reply in English to the originating review thread with evidence, and resolve only addressed threads.

**Step 5: Require exact-head external evidence**

Post the required current-head review commands without duplicates. Require exact-head test, WKWebView, and WebView2 jobs green and inspect their semantic payloads for zero authored-text/painted-band intersections before merge.

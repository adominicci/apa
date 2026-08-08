# Windows Native Input Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture fail-closed Windows WebView2 evidence that real Win32 input reaches the visible Tesina editor as an exact composed `é` edit with correct one-step undo, clipboard Copy/Paste, and a mouse drag across a derived pagination gap.

**Architecture:** Keep the existing visible Wry host and native-manual proof page. The page reports strict geometry, trusted OS-key provenance, and derived ProseMirror outcome identity over dedicated IPC; the test-only native host uses `SendInput`, Win32 clipboard APIs, and the built-in US-International keyboard layout. The ordered state machine rejects incomplete evidence, sends one real Ctrl+Z after the exact `é` delta, and restores native state on every bounded exit. macOS keeps its trusted composition-event proof; Windows composition-event metrics are diagnostic rather than a cross-engine success requirement.

**Tech Stack:** Deno 2, Vitest, TipTap/ProseMirror, Rust 2021, Tao/Wry WebView2, exact locked `windows-sys 0.61.2`, GitHub Actions.

## Global Constraints

- Keep one ProseMirror `EditorView`; pagination remains derived and absent from essay JSON/history.
- Do not dispatch JavaScript input, composition, clipboard, or mouse events.
- Accept direct browser-event evidence only from `Event.isTrusted === true` paths; accept derived document outcomes only after the matching trusted OS key path.
- Preserve the automated native proof and the human-driven macOS manual proof.
- Add no browser bundle or Playwright dependency. Keep every host/output test-only and out of shipped artifacts.
- Use exact already-locked MIT OR Apache-2.0 `windows-sys 0.61.2` only.
- Use the built-in US-International `00020409` dead-key path only. Require trusted `Dead`, an exact one-character NFC `é` authored delta, one trusted Ctrl+Z, and exact prior JSON/selection restoration; keep WebView2 composition-event metrics diagnostic.
- Do not install a language pack or custom IME, forge `IMM`/`WM_IME` messages, or add a synthetic-input fallback.
- Do not push, change app versions, or modify production editor integration.

---

### Task 1: Strict browser protocol and trusted evidence

**Files:**
- Create: `apps/desktop/src/lib/editor/pagination/proof/nativeManualInputProtocol.ts`
- Create: `apps/desktop/src/lib/editor/pagination/proof/nativeManualInputProtocol.test.ts`
- Modify: `apps/desktop/src/lib/editor/pagination/proof/nativeBridge.ts`
- Modify: `apps/desktop/src/lib/editor/pagination/proof/nativeBridge.test.ts`
- Modify: `apps/desktop/src/lib/editor/pagination/proof/nativeManualProof.ts`
- Modify: `apps/desktop/src/lib/editor/pagination/proof/nativeManualProofContract.test.ts`

**Interfaces:** Produces `NativeManualInputMessage`, `parseNativeManualInputMessage(value)`, and `NativeProofBridge.postNativeInput(value): boolean`. The ordered stages are `ready`, `drag`, `copy`, `paste`, `caret`, `dead-keydown`, `dead-key`, and `undo`; the caret acknowledgement separates the real ArrowRight from the dead key, and the trusted `Dead` keydown acknowledgement separates that renderer-processed key from the authored character. The raw DOM `code` is diagnostic because the audited Win32 virtual-key path does not expose `Quote` on hosted WebView2, and a page-level dead-key release is not required because that engine does not dispatch it.

- [x] **Step 1: Write failing tests.** Require Wry-only `native-input` envelopes, strict finite/in-bounds geometry, nonempty selection/clipboard payloads, paste document growth, trusted `Dead`, exact `é`/one-character document growth at the captured selection, trusted Ctrl+Z, and exact prior JSON/selection restoration. Preserve trusted macOS composition evidence and assert the source contains no `dispatchEvent`, `execute_script`, or constructed input event.
- [x] **Step 2: Record RED.** Run `/Users/andresdominicci/.deno/bin/deno run -A npm:vitest run apps/desktop/src/lib/editor/pagination/proof/nativeBridge.test.ts apps/desktop/src/lib/editor/pagination/proof/nativeManualInputProtocol.test.ts apps/desktop/src/lib/editor/pagination/proof/nativeManualProofContract.test.ts`. Expected: missing protocol/bridge and trusted-only behavior.
- [x] **Step 3: Implement minimal browser behavior.** On Wry, use `EditorView.coordsAtPos` in the test page to report points straddling the 180-pixel gap. Advance only after trusted native events, require the selection to span `gapPos`, and require copied/pasted text equality and ProseMirror document growth. On trusted `Dead`, capture JSON, document size, and selection; accept the next authored transaction only when removing its exact `é` restores the captured JSON, then accept the real Ctrl+Z transaction only when JSON and selection both return exactly. Auto-finish only the Windows driver path; retain the human Finish button and composition listeners on WKWebView.
- [x] **Step 4: Record GREEN.** Rerun Step 2 and require all focused tests to pass.

---

### Task 2: Fail-closed Win32 state machine

**Files:**
- Create: `apps/desktop/src-tauri/examples/support/windows-native-input.rs`
- Modify: `apps/desktop/src-tauri/examples/webview2-proof-host.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/Cargo.lock`
- Modify: `apps/desktop/src/lib/editor/pagination/proof/nativeManualProofContract.test.ts`

**Interfaces:** Consumes the eight ordered `native-input` stages and produces driver actions plus final provenance metrics. A result is accepted for Windows manual mode only after the exact acknowledged caret advance, trusted `Dead` keydown from the host-controlled OEM7 stage, composed-character outcome, and one-step undo restoration complete.

- [x] **Step 1: Write failing tests.** Require source references to `SendInput`, `OpenClipboard`, `GetClipboardData`, `LoadKeyboardLayoutW`, and `00020409`, plus exact `windows-sys = "=0.61.2"`. Add pure Rust tests for ordered advancement, duplicate/out-of-order rejection, coordinate normalization, partial input writes, stuck-key/button release, and layout restoration.
- [x] **Step 2: Record RED.** Run focused Vitest, then `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --example webview2-proof-host --features native-proof-host`. Expected: missing native driver contracts/state.
- [x] **Step 3: Implement minimal native behavior.** Validate an interactive foreground desktop and target window, convert CSS coordinates with WebView2 bounds/DPI plus `ClientToScreen`, and use absolute `SendInput` for start/down/intermediate moves/up. Fail closed unless the starting clipboard is empty so restoration is exact; use Ctrl+C, verify `CF_UNICODETEXT` through `OpenClipboard`/`GetClipboardData`, collapse the selection, and use Ctrl+V. Activate `00020409`, send apostrophe then E, require the exact browser-authored outcome, send one Ctrl+Z, require exact JSON/selection restoration, and restore the prior layout, cursor, pressed modifiers/button, and empty clipboard on success/error/deadline/window-close. Fail on short input counts or any API/protocol error.
- [x] **Step 4: Record GREEN.** Rerun Step 2. Local Rust tests prove pure/state behavior; only Windows CI may prove Win32 execution.

---

### Task 3: Bounded single-build CI experiment and Task 3.8 evidence

**Files:**
- Modify: `scripts/native-pagination-workflow.test.ts`
- Modify: `apps/desktop/src/lib/editor/pagination/proof/runNativeProof.ts`
- Modify: `apps/desktop/src/lib/editor/pagination/proof/nativeHostCommand.ts`
- Modify: `apps/desktop/src/lib/editor/pagination/proof/nativeHostCommand.test.ts`
- Modify: `openspec/changes/add-live-pagination-and-release-notes/tasks.md`
- Modify: `.superpowers/sdd/tasks/task-3-report.md` (ignored evidence record)

**Interfaces:** Bundles `nativeManualProof.html` into `runNativeProof.ts` and, on Windows only, launches it after the existing 25-check proof with the already-built host and an isolated profile subdirectory. `nativeHostCommand` adds an explicit Windows-only driver flag. The workflow keeps one Cargo build, one runner command, and its existing 10-minute bound.

- [x] **Step 1: Write failing runner/workflow tests.** Require the Windows command flag to be rejected off Windows, require `runNativeProof.ts` to bundle and launch `nativeManualProof.html` only on Windows after the automated proof, require the workflow to retain one `runNativeProof.ts` command and one Cargo build, and require the macOS execution path to remain unchanged.
- [x] **Step 2: Record RED.** Run `/Users/andresdominicci/.deno/bin/deno run -A npm:vitest run apps/desktop/src/lib/editor/pagination/proof/nativeHostCommand.test.ts scripts/native-pagination-workflow.test.ts`. Expected: no native-input host mode or bundled Windows phase.
- [x] **Step 3: Implement minimal runner/evidence changes.** Reuse the existing host binary, preview server, temp roots, cleanup lifecycle, 60-second outer host bound, and a third profile subdirectory. Record run `31276007016`, job `93149504669`, WebView2 `150.0.4078.105`, 25/25 checks, 3m16 Cargo build, clean cleanup, and 4m46 success. Mark OpenSpec 3.8 complete; keep 3.7 unchecked pending a green visible-input rerun against the approved outcome contract.
- [x] **Step 4: Record GREEN.** Rerun the workflow and focused proof contracts.

---

### Task 4: Outcome-based Windows input and review hardening

**Files:**
- Modify: `apps/desktop/src/lib/editor/pagination/proof/nativeManualEvidence.ts`
- Modify: `apps/desktop/src/lib/editor/pagination/proof/nativeManualEvidence.test.ts`
- Create: `apps/desktop/src/lib/editor/pagination/proof/nativeManualHistory.test.ts`
- Modify: `apps/desktop/src/lib/editor/pagination/proof/nativeManualInputProtocol.ts`
- Modify: `apps/desktop/src/lib/editor/pagination/proof/nativeManualInputProtocol.test.ts`
- Modify: `apps/desktop/src/lib/editor/pagination/proof/nativeManualProof.ts`
- Modify: `apps/desktop/src-tauri/examples/support/windows-native-input.rs`

**Interfaces:** Replaces the rejected identical-composition-event assumption with trusted per-engine provenance and exact authored outcomes. Also makes clipboard safety empty-only and routes real cleanup through the same tested executor.

- [x] **Step 1: Record RED.** Focused Vitest reports seven failures for absent dead-key/undo stages and the old WebView2 composition requirement; Rust compilation reports missing `DriverAction::DeadKey` and `DriverAction::Undo`.
- [x] **Step 2: Implement minimal GREEN.** Capture trusted `Dead`, exact `é` delta, trusted Ctrl+Z, and exact JSON/selection restoration; keep composition metrics diagnostic on Windows. Accept only an empty initial clipboard, and invoke the tested cleanup plan from production cleanup.
- [x] **Step 3: Run focused GREEN.** Require browser reducer/protocol/source contracts, a pure ProseMirror history regression for the one-position move/dead-key/undo sequence, the source contract for real Win32 ArrowRight and Ctrl+Z, and pure Rust protocol/cleanup tests to pass.
- [ ] **Step 4: Run the draft-PR Windows experiment.** Require automated WebView2 25/25, native drag, OS clipboard Copy/Paste, trusted `Dead`, exact `é` delta, trusted Ctrl+Z, exact JSON/selection restoration, and clean teardown before checking OpenSpec 3.7.

---

### Task 5: Verification and local checkpoint

**Files:** Review only the files above. Stage no generated `dist`, profile, Cargo target, `.svelte-kit`, or `graphify-out` output.

**Interfaces:** Produces a clean local commit suitable for a draft-PR Windows experiment.

- [ ] **Step 1: Run focused/native gates.** Run `deno task check`, focused pagination/workflow Vitest, and `runNativeProof.ts`; require Svelte 0/0, focused green, and macOS WKWebView 25/25.
  - Focused and Svelte gates are green. The fresh local WKWebView rerun is blocked because the current Mac GUI session is locked; the supplied current macOS CI job and earlier local 25/25 result remain recorded in the Task 3 report.
- [x] **Step 2: Run full gates.** Run `deno task test`, `deno fmt --check`, `deno lint`, `openspec validate add-live-pagination-and-release-notes --strict`, and `git diff --check`; require every command to exit 0.
- [x] **Step 3: Inspect containment.** Inspect `git status --short`, full/cached diffs, Cargo manifest/lock delta, and tracked generated files. Require the lock delta to add only the already-present `windows-sys 0.61.2` edge.
- [x] **Step 4: Append the report.** Record RED/GREEN output, license/lock audit, trusted-event/protocol/lifecycle proof, exact 3.8 evidence, and the pending outcome-based Windows 3.7 rerun.
- [x] **Step 5: Commit.** Stage only approved files, run `git diff --cached --check`, then commit the verified outcome-based native-input contract with an English message. Do not push.

## Self-Review

- Spec coverage: 3.7 remains open until Windows CI observes native drag, OS clipboard Copy/Paste, the trusted dead-key `é` outcome, and exact one-step undo restoration; 3.8 closes only from the supplied fully green native CI evidence.
- Placeholder scan: there is no synthetic fallback or deferred behavior hidden behind a success claim.
- Type consistency: browser messages and native states share the same eight-stage order, including the renderer-acknowledged `dead-keydown` barrier before E.
- Data safety: every implementation edit is proof/test/workflow/docs-only; production editor JSON, history, schema, and integration are untouched.

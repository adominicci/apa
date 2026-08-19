---
handoff_version: "1"
created_at: "2026-08-18T10:02:55.967685+00:00"
updated_at: "2026-08-18T10:05:05.998429+00:00"
from_agent: "Claude Code (Opus 5)"
to_agent: "Next implementation agent"
project_root: "/Users/andresdominicci/Projects/apa"
git_branch: "main"
git_head: "e881879f14d4c54eabb2355a2619176ee791fc5b"
status: "ready"
continues_from: ""
---

# Cross-Agent Handoff: Fix production-readiness blockers found in the v0.1.16 review

## Objective

A read-only production-readiness review of Tesina v0.1.16 found one proven
data-visibility bug, one broken CI job on `main`, and three smaller hardening
gaps. Fix the two blockers (P1 and P2) and, if scope allows, the three secondary
items (P3-P5). No fix has been started. The repository is clean at `e881879`.

The user's stated goal is to reach a state where Tesina can be called
production-ready for students on macOS. The user was advised to fix P1 and P2
before the next release and accepted that recommendation by requesting this
handoff.

## Current State

Nothing has been implemented. The review was read-only. The only file written
during the review was a throwaway test, which was created, run, and deleted;
`git status` is clean.

### P1 - BLOCKER - One corrupt essay file hides every paper (proven)

- File:
  `/Users/andresdominicci/Projects/apa/apps/desktop/src/lib/state/essays.svelte.ts`
- Method: `EssaysStore.loadIndex()`, lines 34-52.

`readJson()` in `apps/desktop/src/lib/persist/atomic.ts` ends with
`return JSON.parse(await readTextFile(target)) as T;` and does not catch.
`loadIndex()` wraps the whole `for` loop in a single `try`. If any one essay
file contains malformed JSON, the loop aborts, `this.summaries` is never
assigned, and the home screen renders the empty state. The only signal is
`console.error("No se pudo cargar el índice de ensayos:", err)`, which a student
never sees. The user's papers are still on disk, but the app presents them as
gone.

This is a visibility bug, not disk data loss. It is rated a blocker because the
observable behavior is indistinguishable from total data loss for the user, and
Tesina's core promise is local ownership of the student's paper.

Existing tests cannot catch this: the `readJson` mock in
`apps/desktop/src/lib/state/essays.svelte.test.ts` (lines 26-31) resolves `null`
for unknown paths and never rejects.

### P2 - BLOCKER - Linux installer build broken on `main` for 4 commits

- File:
  `/Users/andresdominicci/Projects/apa/apps/desktop/src-tauri/src/pdf_export.rs`
- Line: 533.

```rust
#[cfg(not(any(target_os = "macos", windows)))]
let started = {
    let _ = (&platform_webview, &target, paper);
    Err(UNSUPPORTED_PLATFORM.to_string())
};
```

`rustc` error `E0282`:
`type annotations needed for Result<_, std::string::String>`. On macOS and
Windows the sibling `#[cfg]` branches infer `Result<(), String>` from
`platform::start_print` (signatures at `pdf_export.rs:267` and
`pdf_export.rs:363`, both returning `Result<(), String>`). The Linux branch has
only an `Err` arm, so the `Ok` type parameter is unconstrained.

The `Installer build verification` workflow
(`.github/workflows/build-artifacts.yml`) has failed on every push to `main`
since PR #40. The `ubuntu-22.04 installers` job fails at the
`Compile installer bundles` step. The `macos-latest` and `windows-latest` jobs
pass.

Secondary consequence: `README.md` states Linux builds "are checked in CI but
are not published yet". They are checked and currently failing, so that line is
inaccurate as written.

### P3 - Two flaky tests make the local gate red

- File:
  `/Users/andresdominicci/Projects/apa/apps/desktop/src/lib/editor/pagination/proof/proofProcess.test.ts`
- Failing tests: "settles at the deadline and kills descendants that retain its
  pipes" and "uses Windows tree termination semantics when the selected host is
  win32".
- Failure: `ENOENT ... /descendant.pid` - the spawned parent has not yet written
  the pid file when the assertion reads it.

Reproduced on macOS (darwin 25.6.0) under the full suite. Passed 3 of 3 runs in
isolation. This is test-harness code for the CI pagination proof, not shipped
application code. It makes `deno task test` exit 1 locally.

### P4 - No CSP, plus wildcard HTTP scope

- `apps/desktop/src-tauri/tauri.conf.json` sets `app.security.csp` to `null`.
- `apps/desktop/src-tauri/capabilities/default.json` grants `https://*/*` and
  `http://*/*` under `http:default`.

Current exploitability is low and was checked, not assumed: scraped page HTML
goes through the Rust `plugin-http` client
(`apps/desktop/src/lib/autofill/client.ts`, 10s timeout, 4 MB streaming cap) and
is never injected into the DOM. The only `innerHTML` sinks are
`MarkdownContent.svelte` (DOMPurify allowlist plus href scrubbing to https) and
Temml MathML rendering. This is a missing defense in depth, not a live
vulnerability.

### P5 - CI never compiles or tests the Rust crate on pull requests

`.github/workflows/ci.yml` runs `deno fmt --check`, `deno lint`,
`deno task check`, and `deno task test`. No job runs `cargo check`,
`cargo test`, `cargo clippy`, or `cargo fmt`. Rust unit tests exist in
`backup_directory.rs`, `external_files.rs`, and `pdf_export.rs` and never run.
This is the root cause of P2: a Rust compile error reached `main` and only
`build-artifacts.yml` (which runs on push to `main`, after merge) caught it.

### Housekeeping (not blockers)

- GitHub releases `v0.1.15` and `v0.1.11` are stuck in `Draft` state.
- Tag `v0.1.13` is missing, though commit `8044309` released v0.1.13.

## Plan

1. Fix P1 with a per-file guard plus a user-visible signal, covered by a test.
2. Fix P2 with the one-line type annotation, verified by a real Linux compile.
3. Fix P3 by making the pid-file read wait for the file instead of racing it.
4. Optionally address P5 by adding a Rust job to `ci.yml`; this prevents P2 from
   recurring and is the highest-value secondary item.
5. Treat P4 and the housekeeping items as separate follow-up work; confirm scope
   with the user before starting them.

Ask the user whether P1+P2 ship as one PR or two. The repository uses one
version bump per change merged to `main` (see `AGENTS.md`, "Version and
release"), so two PRs means two version bumps.

## Decisions and Rationale

- **P1 is a blocker, P4 is not.** P1 was reproduced with a runnable test and its
  user-facing symptom is "all my papers are gone". P4 has no reachable exploit
  path in the current code. Evidence outranks category severity.
- **P1's fix must include a user-visible message, not only a `catch`.** Silently
  skipping a damaged file would still make a paper disappear with no
  explanation. The student needs to know which file is damaged so the file can
  be recovered from `backups/`.
- **P2 is fixed with a type annotation, not by deleting the Linux branch.** The
  branch exists so every build stays honest about platform support, per the
  comment at `pdf_export.rs:517-520`. Removing it would break the Linux build
  differently.
- **P5 is named as the root cause of P2.** Fixing P2 alone leaves the same hole
  open for the next Rust change.
- **The review deliberately ran the real gates** rather than trusting CI badges.
  `deno task check`, `deno fmt --check`, and `deno lint` all pass at `e881879`;
  `deno task test` does not.

## Rejected Alternatives

- **Rejected: ship v0.1.16 as-is and patch P1 later.** Presented to the user as
  option B. Rejected because a student who opens Tesina to an empty library has
  no way to tell a display bug from lost work, and the fix is small.
- **Rejected: wrap the whole `loadIndex` body in a broader `catch` and show a
  generic error.** That still hides every good paper. The guard belongs inside
  the loop so undamaged papers keep loading.
- **Rejected: mark `proofProcess.test.ts` as skipped to make the suite green.**
  That hides a real race in the proof harness the CI pagination jobs depend on.
- **Rejected: setting a CSP as part of this handoff.** A CSP change can break
  the webview at runtime in ways the unit suite will not catch, and it needs a
  manual pass over the editor, preview, PDF export, and Temml rendering. It is
  real work, not a config line, and it does not belong bundled with two
  blockers.

## Repository State

- Project root: `/Users/andresdominicci/Projects/apa`
- Branch at handoff: `main`
- HEAD at handoff: `e881879f14d4c54eabb2355a2619176ee791fc5b` ("Adopt Tesina
  Design System v2 (v0.1.16) (#43)")
- Working tree: clean
- Current version: 0.1.16, published as the latest GitHub release
- Open GitHub issues: none

Key files:

- `/Users/andresdominicci/Projects/apa/apps/desktop/src/lib/state/essays.svelte.ts`
  (P1)
- `/Users/andresdominicci/Projects/apa/apps/desktop/src/lib/state/essays.svelte.test.ts`
  (P1 coverage)
- `/Users/andresdominicci/Projects/apa/apps/desktop/src/lib/persist/atomic.ts`
  (`readJson`, the throwing call)
- `/Users/andresdominicci/Projects/apa/apps/desktop/src-tauri/src/pdf_export.rs`
  (P2, line 533)
- `/Users/andresdominicci/Projects/apa/apps/desktop/src/lib/editor/pagination/proof/proofProcess.test.ts`
  (P3)
- `/Users/andresdominicci/Projects/apa/.github/workflows/ci.yml` (P5)
- `/Users/andresdominicci/Projects/apa/.github/workflows/build-artifacts.yml`
  (P2 gate)
- `/Users/andresdominicci/Projects/apa/apps/desktop/messages/es.json` and
  `en.json` (new P1 string)

## Constraints and Invariants

From `AGENTS.md`, which is canonical for this repository:

- UI and chrome strings use Paraglide and the UI locale. Document content uses
  `essay.settings.documentLanguage`. Never mix those two axes in one surface. A
  new "this paper file is damaged" message is chrome, so it goes in Paraglide
  and needs both `messages/es.json` and `messages/en.json`.
- Do not bump `essay.schemaVersion` from 2.
- Preserve atomic writes, autosave, rotating backups, and relative figure
  assets.
- Pure packages (`packages/apa-engine`, `packages/docx-export`) never import
  Tauri APIs.
- A change intended to merge to `main` follows the per-change version policy.
  Keep desktop package, Tauri, Cargo, README, and CHANGELOG versions in sync.
  The CHANGELOG section is the single release-note source.
- Tagging, publishing, or releasing is a separate external action and requires
  explicit authorization. **This handoff grants no authorization to commit,
  push, merge, tag, publish, or release.** Ask the user.
- The dev task owns the process it starts. Record that PID and stop only that
  verified PID. Never clear port 1420 or kill Vite/Tauri by name.
- Do not rerun unchanged full checks after every small correction.

Repository-specific gotchas confirmed during the review:

- A version bump touches roughly 14 tests that assert the version and CHANGELOG
  text. Budget for that if you bump.
- Merging is blocked by a ruleset; only
  `gh pr merge --squash --delete-branch --admin` passes. That is the user's
  action, not yours.
- `timeout` is not installed on this macOS host. Do not wrap commands in it; the
  shell reports "command not found" and a piped exit code hides the real result.
  Use the tool's own timeout instead.
- Piping a test command into `tail` masks its exit code in zsh. Redirect to a
  file and read `$?` directly.

## Evidence and Verification

All of the following was run at `e881879` on macOS (darwin 25.6.0).

Passing:

| Command            | Result                                              |
| ------------------ | --------------------------------------------------- |
| `deno task check`  | exit 0 - `COMPLETED 1654 FILES 0 ERRORS 0 WARNINGS` |
| `deno fmt --check` | exit 0 - `Checked 390 files`                        |
| `deno lint`        | exit 0 - `Checked 307 files`                        |

Failing:

| Command                                                                                        | Result                                                                                     |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `deno task test`                                                                               | exit 1 - `Test Files 1 failed \| 133 passed (134)`, `Tests 2 failed \| 1447 passed (1449)` |
| `deno run -A npm:vitest run apps/desktop/src/lib/editor/pagination/proof/proofProcess.test.ts` | exit 0, 4 passed - 3 of 3 runs. Confirms P3 is a load-dependent flake, not a logic error.  |

P1 proof. A throwaway test was written, run, and deleted. It mocked
`$lib/persist/atomic` so `readJson` **rejects** with
`SyntaxError("Unexpected end of JSON input")` for exactly one of three essay
files, then called `essays.loadIndex()`:

```
No se pudo cargar el índice de ensayos: SyntaxError: Unexpected end of JSON input
SUMMARIES AFTER CORRUPT FILE: 0
AssertionError: expected +0 to be 2
```

Two undamaged papers were expected. Zero were listed. Reproduce it by adding a
rejecting `readJson` path to the existing mock in
`apps/desktop/src/lib/state/essays.svelte.test.ts`; that rejecting case is the
regression test the fix needs.

P2 proof, from `gh run view --job 95654686207 --log-failed` on run
`32118935464`:

```
error[E0282]: type annotations needed for `Result<_, std::string::String>`
  --> src/pdf_export.rs:533:17
533 |             let started = {
534 |                 let _ = (&platform_webview, &target, paper);
535 |                 Err(UNSUPPORTED_PLATFORM.to_string())
    |                 ------------------------------------- type must be known at this point
help: consider giving `started` an explicit type
```

`gh run list --branch main --limit 8` shows `Installer build verification`
failing on the four most recent pushes to `main` (runs 32118935464, 32070833229,
32013955060, 31972773089) while `CI` passes on all four.

Verified as sound during the review, so do not re-audit these:

- Atomic save path: `writeJsonAtomic` writes `<target>.tmp`, then
  `installReplacement` swaps it in, with a Windows WebView recovery path
  (`apps/desktop/src/lib/persist/atomicReplace.ts`).
- Autosave failure handling in
  `apps/desktop/src/lib/components/EditorScreen.svelte`: `reportPersistError`
  sets `status = "error"`, and `leaveEditor` refuses to navigate away when the
  flush rejects.
- Release-note sanitizing in `MarkdownContent.svelte`: DOMPurify with an
  explicit `ALLOWED_TAGS` / `ALLOWED_ATTR` allowlist, `FORBID_ATTR: ["style"]`,
  and a post-pass that drops any href that is not https.
- Autofill network layer: Rust `plugin-http`, 10s `AbortSignal.timeout`, 4 MB
  cap, no personal data in the UA string, no DOM injection of fetched HTML.
- 134 test files, 1449 tests.

## Open Questions and Blockers

1. **How should P1 tell the user?** Two reasonable options, and this is a
   product decision, not a technical one. Ask the user.
   - (a) A banner on the home screen: "N paper files could not be read", with
     the filenames.
   - (b) A placeholder row in the essay list per damaged file, which keeps the
     paper visible and offers recovery from `backups/`. Option (b) fits Design
     Principle 3 ("preserve user ownership") better, but it is more work. Do not
     guess; the user is available.
2. **One PR or two?** P1 and P2 are unrelated. Two PRs is cleaner but costs two
   version bumps under this repository's per-change version policy.
3. **Is P5 in scope for this handoff?** It is the root cause of P2 and is a
   small `ci.yml` addition, but it is a workflow change the user has not
   explicitly asked for.
4. **No Linux host is available here.** P2's fix cannot be compile-verified
   locally on macOS. Verification must come from CI, which means either pushing
   a branch (needs user authorization) or `workflow_dispatch` on
   `build-artifacts.yml`. State clearly that the fix is unverified until CI
   confirms it. Do not claim it compiles.

## Next Actions

1. Confirm the starting state. Run these from
   `/Users/andresdominicci/Projects/apa`: `git status --short` (expect clean),
   `git rev-parse HEAD` (expect `e881879f14d4c54eabb2355a2619176ee791fc5b`). If
   HEAD moved, re-read the three files named in P1 and P2 before trusting any
   line number here.
2. Ask the user Open Question 1 (how to surface a damaged file) and Question 2
   (one PR or two). Everything else can proceed under stated assumptions; these
   two change what you build.
3. Write the failing test first. In
   `apps/desktop/src/lib/state/essays.svelte.test.ts`, extend the
   `$lib/persist/atomic` mock so a named path makes `readJson` reject, then
   assert that `loadIndex()` still lists every undamaged essay. Confirm it fails
   for the right reason before touching the implementation.
4. Fix P1 in `apps/desktop/src/lib/state/essays.svelte.ts`. Move the
   `try`/`catch` inside the `for` loop in `loadIndex()` so one bad file is
   skipped and the rest load. Record the damaged filenames on the store, and
   surface them per the user's answer to Question 1. Add the new Paraglide key
   to both `apps/desktop/messages/es.json` and `apps/desktop/messages/en.json`.
   Also review `EssaysStore.load(id)` (line 76) and `rename`/`duplicate`, which
   call `readJson` with no guard and can reject into their callers.
5. Verify P1 focused: `deno run -A npm:vitest run apps/desktop/src/lib/state`
   plus `deno task check`.
6. Fix P2 in `apps/desktop/src-tauri/src/pdf_export.rs:533`. Annotate only the
   non-macOS, non-Windows branch: `let started: Result<(), String> = { ... };`.
   The type matches both `platform::start_print` signatures (`pdf_export.rs:267`
   and `:363`). Keep the `let _ = (&platform_webview, &target, paper);` line; it
   suppresses the unused-variable warnings.
7. Verify P2. There is no Linux host here, so `cargo check` on macOS will not
   exercise the branch. Either compile-check the branch under a Linux target if
   a toolchain is available, or state plainly that the fix is unverified until
   `Installer build verification` runs. Do not report it as fixed without CI
   evidence.
8. Fix P3 in `proofProcess.test.ts`. Poll for `descendant.pid` to exist and be
   non-empty, with a bounded deadline, instead of reading it once. The file is
   written by the spawned parent, so the read races the spawn under suite load.
9. Run the final gate on the finished diff: `deno task check`, `deno task test`,
   `deno fmt --check`, `deno lint`. `deno task test` must reach exit 0. Redirect
   output to a file and read `$?`; do not pipe into `tail`.
10. Update `CHANGELOG.md` under a new version section and keep the desktop
    `package.json`, `tauri.conf.json`, `Cargo.toml`, and `README.md` versions in
    sync per `AGENTS.md`. Expect roughly 14 version-asserting tests to need
    updating. If P2 is included, correct the `README.md` sentence claiming Linux
    builds are checked in CI.
11. Stop and report. Do not commit, push, open a PR, tag, or release without the
    user's explicit authorization.

## Receiver Start Prompt

You are taking over a production-readiness fix for Tesina, a local-first APA 7
desktop word processor at `/Users/andresdominicci/Projects/apa`.

Read
`/Users/andresdominicci/Projects/apa/.ai/handoffs/2026-08-18-100255-fix-production-readiness-blockers-found-in-the-v0-1-16-revie.md`
in full, then read `AGENTS.md` in the repository root. `AGENTS.md` is canonical;
ignore `CLAUDE.md`.

A read-only review of v0.1.16 found two blockers. Nothing has been fixed yet.

P1: in `apps/desktop/src/lib/state/essays.svelte.ts`, `loadIndex()` wraps its
whole read loop in one `try`. One essay file with malformed JSON makes
`readJson` throw, aborts the loop, and leaves the home screen showing zero
papers with no message to the user. This was reproduced with a test that was run
and then deleted; the handoff contains the exact output.

P2: `apps/desktop/src-tauri/src/pdf_export.rs:533` fails to compile on Linux
with `E0282` because the non-macOS, non-Windows branch has only an `Err` arm, so
the `Ok` type is unconstrained. The `Installer build verification` workflow has
been red on `main` for four commits.

Start with "Next Actions" item 1: confirm `git status --short` is clean and HEAD
is `e881879f14d4c54eabb2355a2619176ee791fc5b`. Then ask the user the two open
questions in item 2 before writing code, because both change what you build.

Constraints: write the failing test before the fix. New UI strings go in
Paraglide, in both `apps/desktop/messages/es.json` and `en.json`. Do not bump
`essay.schemaVersion`. `timeout` is not installed on this host, and piping a
test command into `tail` hides its exit code in zsh. **You have no authorization
to commit, push, merge, tag, or release.** Stop and report when the fixes pass
`deno task check`, `deno task test`, `deno fmt --check`, and `deno lint`.

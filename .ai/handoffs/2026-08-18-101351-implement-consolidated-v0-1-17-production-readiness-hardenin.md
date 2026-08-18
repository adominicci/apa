---
handoff_version: "1"
created_at: "2026-08-18T10:13:51.678583+00:00"
updated_at: "2026-08-18T10:13:51.678583+00:00"
from_agent: "Codex"
to_agent: "Next implementation agent"
project_root: "/Users/andresdominicci/Projects/apa"
git_branch: "main"
git_head: "363bf3dad4600da0a346d47a021324110cda069e"
status: "ready"
continues_from: "/Users/andresdominicci/Projects/apa/.ai/handoffs/2026-08-18-100255-fix-production-readiness-blockers-found-in-the-v0-1-16-revie.md"
---

# Cross-Agent Handoff: Implement consolidated v0.1.17 production readiness hardening

## Objective

Provide one evidence-backed implementation brief for a single Tesina v0.1.17
production-readiness PR. The PR may consolidate the repository changes below,
but this handoff does not authorize implementation, pushing, merging, tagging,
publishing, deleting releases, or changing remote GitHub state. Wait for the
owner to explicitly request implementation.

The release goal is macOS production readiness while preserving the README's
current description of Windows as experimental. Linux should at least build
successfully if the repository continues to advertise and generate Linux
artifacts.

## Current State

The predecessor handoff is technically sound on its five central findings, but
it is stale and incomplete:

- Its recorded HEAD is `e881879`; current `main` is `363bf3d`. The intervening
  commit adds only the predecessor handoff, so the application code it reviewed
  is unchanged.
- P1 (one malformed essay hides the library), P2 (Linux E0282), P3
  (`proofProcess.test.ts` timing race), P4 (CSP disabled), and P5 (no Rust CI)
  are all present.
- The predecessor handoff itself is not Deno-formatted. Commit `363bf3d` now
  fails the primary CI job at `deno fmt --check` before lint, Svelte checks, or
  unit tests can run.
- The same CI run exposed an additional Windows-only timeout in
  `windowsHostContract.test.ts`.
- It says the owner accepted an implementation recommendation; the current
  evidence only establishes that the owner asked for verification, a complete
  handoff, and advice on using one PR. Do not infer implementation authority.
- Its statement that only an admin squash merge can pass protection is not
  established by the live ruleset. The ruleset requires a PR and reports that
  the current user can bypass; no merge method was attempted in this review.

Production-readiness conclusion: v0.1.16 is not ready for an unqualified
production declaration. The macOS release pipeline is healthy, but the library
visibility defect, red CI, Linux build failure, incomplete packaged backup
evidence, and remaining release hardening need resolution or explicit scope
decisions.

### Confirmed repository blockers

1. **P0 - current `main` is red because the predecessor handoff is not
   formatted.** `deno fmt --check` reports exactly one unformatted file:
   `.ai/handoffs/2026-08-18-100255-fix-production-readiness-blockers-found-in-the-v0-1-16-revie.md`.
   CI run `32125164183`, job `95673980138`, fails at Format check and skips the
   remaining primary gates.
2. **P1 - a malformed essay can make all valid papers appear missing.**
   `apps/desktop/src/lib/state/essays.svelte.ts` wraps migration, directory
   listing, and every essay read in one outer `try`. `readJson` in
   `apps/desktop/src/lib/persist/atomic.ts` lets `JSON.parse` throw. On a fresh
   load, one malformed essay aborts the loop before `summaries` is assigned, so
   the UI shows an empty library even though valid files remain on disk. On a
   later reload it can leave stale summaries. The current test mock never
   rejects for malformed JSON. This is a visibility/recovery defect, not
   confirmed on-disk data loss.
3. **P2 - Linux installers do not compile.** In
   `apps/desktop/src-tauri/src/pdf_export.rs`, the non-macOS/non-Windows branch
   declares `let started = { Err(...) }`, leaving the success type ambiguous.
   Ubuntu artifact runs fail with Rust `E0282` at line 533. The smallest fix is
   `let started: Result<(), String> = { ... };`. Current artifact run
   `32125164159`, Ubuntu job `95673980095`, confirms the same error; macOS and
   Windows installer jobs pass.
4. **P3 - the full unit suite has a load-dependent process-test race.** A fresh
   full local run at the application commit produced 1,447 passes and 2 failures
   in `proofProcess.test.ts`, both reading `descendant.pid` before the child
   wrote it (`ENOENT`). Three focused reruns passed 4/4. Replace the immediate
   read with a bounded wait tied to a clear deadline; do not add an arbitrary
   sleep.
5. **P4 - Windows pagination CI has a separate timeout.** CI run `32125164183`,
   job `95673980157`, passed 251 tests, skipped 1, and failed
   `windowsHostContract.test.ts` because `cargoMetadata()` exceeded the test's
   5-second timeout. The test took about 6.8 seconds. Diagnose whether cold
   Cargo metadata is the intended operation, then give that contract a bounded,
   platform-realistic timeout or remove unnecessary work. Do not mask an
   unbounded process.
6. **P5 - primary CI does not compile or test the Tauri Rust crate.**
   `.github/workflows/ci.yml` has no `cargo fmt --check`,
   `cargo check --locked`, or `cargo test --locked` gate. That gap allowed P2 to
   reach `main`. Add a focused Rust job; keep installer builds as the platform
   packaging proof.

### Confirmed hardening, evidence, and UX gaps

7. **CSP is disabled.** `apps/desktop/src-tauri/tauri.conf.json` sets
   `app.security.csp` to `null`. No reachable exploit was confirmed: fetched
   metadata uses the Rust HTTP plugin with a 10-second timeout and 4 MB cap, and
   the reviewed HTML/MathML sinks are sanitized or generated. Treat this as
   defense in depth, not as a proven vulnerability. A restrictive CSP must be
   smoke-tested against the editor, preview, Temml equations, DOCX/PDF flows,
   updater, and plugin IPC. The current HTTP capability intentionally permits
   user-supplied `http://` and `https://` URLs; narrowing it is a
   product-contract change and must not be done casually.
8. **Dependency advisories require triage.** `deno audit --frozen` reports 7
   advisories: 3 high, 3 moderate, 1 low, and 0 critical, involving SvelteKit,
   cookie, nanoid, postcss, and yaml. Most appear in build/development paths;
   runtime reachability was not proven. Upgrade compatible direct/locked
   dependencies where safe, or document why an advisory is not shipped or
   reachable. Dependabot alerts are disabled for the repository, so they are not
   a substitute for this gate.
9. **Portable backup/import acceptance evidence is incomplete.** The active
   `openspec/changes/add-portable-library-backups/tasks.md` still leaves
   packaged application smoke, native restart persistence, app-level
   export/import, macOS/Windows/provider matrices, durable evidence, and
   closeout tasks unchecked. The evidence matrix records an older app version
   and explicitly defers packaged macOS, Windows, and provider scenarios. The
   automated macOS package smoke only checks metadata, launch, and brief
   liveness; it does not exercise editing, IPC, backup persistence,
   import/export, or installer UX. For macOS GA, run and record the exact
   v0.1.17 candidate scenarios. Keep Windows limitations explicit rather than
   silently claiming Windows GA.
10. **The editor Add menu does not dismiss.** In `EditorScreen.svelte`, the add
    popover lacks the shared `dismissable` behavior and remains open across
    editor/preview changes. Add outside-click and Escape dismissal using the
    existing shared pattern.
11. **Fresh backup settings use re-enable copy.** `BackupSettings.svelte`
    presents "Set up backups again" / "Turning back on" for any unconfigured
    state, including a first-time user. Distinguish never configured from
    explicitly disabled, or use neutral initial setup copy. Keep strings in
    Paraglide and aligned in `en.json` and `es.json`.
12. **Repository guidance points to missing canonical docs.** The referenced
    `docs/runbooks/font-delivery.md`, `docs/runbooks/release.md`, and
    `docs/architecture/editor-renderers.md` do not exist. Create them from
    currently verified guidance before removing equivalent detail from
    `AGENTS.md`; do not invent release facts.
13. **Release documentation is stale.** `CHANGELOG.md` link definitions stop at
    v0.1.12 and `[Unreleased]` still compares v0.1.12 to HEAD. Add links for
    v0.1.13 through v0.1.17 and make the v0.1.17 CHANGELOG section the single
    release-note source. Synchronize version 0.1.17 across desktop package,
    Tauri, Cargo, README, and CHANGELOG once implementation is authorized.
14. **The portable-backup OpenSpec change is still active after shipping.**
    Reconcile its unchecked evidence honestly, complete the authorized evidence,
    and archive only when its acceptance criteria are actually met. Do not mark
    deferred Windows/provider proof as executed.

### Confirmed external release hygiene

- GitHub releases v0.1.15 and v0.1.11 are drafts. Other inspected releases,
  including v0.1.16, are published.
- A GitHub release named v0.1.13 exists, but the `v0.1.13` Git tag is absent
  both locally and from `git ls-remote --tags origin v0.1.13`.
- These are remote-state actions, not PR contents. Cleaning drafts, creating or
  repairing a tag, publishing a release, or deleting anything requires explicit
  owner authorization after the exact targets are reconfirmed.
- The active default-branch ruleset requires a PR, signed commits, an up-to-date
  branch, and code-quality checks. It allows the current user to bypass. No live
  merge attempt was made, so do not claim that `--admin` or one merge method is
  uniquely required.

## Plan

Use one PR named around **v0.1.17 production-readiness hardening**, with small,
reviewable commits in this order:

1. Restore a trustworthy baseline: format the predecessor handoff, fix P1 with
   focused tests and localized UI recovery messaging, fix the Linux type error,
   and stabilize both timing-sensitive tests.
2. Add the focused Rust CI gate and confirm that it would catch the Linux
   regression without duplicating full packaging work.
3. Add and validate CSP hardening, then triage dependency advisories. If either
   requires a broad dependency migration or causes unresolved runtime breakage,
   stop and propose splitting only that risky slice.
4. Fix the two confirmed UX defects using existing shared primitives and
   Paraglide conventions.
5. Reconcile portable-backup acceptance evidence and run the authorized macOS
   packaged candidate matrix. Record observed results, including failures or
   deferred Windows/provider coverage.
6. Create the missing runbooks/architecture doc, update CHANGELOG links and the
   v0.1.17 release section, archive the OpenSpec change only if complete, and
   perform one synchronized version bump to 0.1.17.
7. Run the final gates once on the final diff: `deno fmt --check`, `deno lint`,
   `deno task check`, `deno task test`, and from `apps/desktop/src-tauri`,
   `cargo fmt --check`, `cargo check --locked`, and `cargo test --locked`.
   Confirm the CI, pagination, and installer matrices on the PR. Run packaged
   macOS evidence on the exact candidate, not an older build.

Do not perform the external release-hygiene actions as part of ordinary PR
implementation. They can be handled in a separate, explicitly authorized
closeout after the PR is merged and the candidate is approved.

## Decisions and Rationale

- **One repository PR is appropriate.** The findings share one release boundary,
  one version bump, and one final validation story. Sequential commits keep the
  review legible without multiplying cross-dependent PRs.
- **P1 must isolate failures per file and tell the user.** Silently skipping a
  corrupt essay avoids an empty library but still hides a paper without recovery
  guidance. Load every valid summary, retain the unreadable file identity where
  possible, show a localized non-destructive banner/status with count and backup
  recovery guidance, and cover both fresh load and later refresh behavior.
- **Corruption handling should be reused by library scans.** `essaysCiting` also
  scans files and can abort on malformed JSON, weakening reference-deletion
  safety. Keep deletion guards conservative when a dependency scan is
  incomplete.
- **P2 is a type annotation, not removal of Linux behavior.** The unsupported
  branch is legitimate and should compile honestly.
- **Timing fixes must be bounded and causal.** Wait for the actual readiness
  condition or give cold tool startup a justified deadline; arbitrary sleeps
  create new flakes.
- **CSP is hardening, not evidence of compromise.** Its test burden comes from
  Tauri/plugin compatibility, not a confirmed exploit path.
- **Mac production readiness and Windows GA are separate claims.** The README
  already calls Windows experimental and unsigned. Preserve that boundary while
  still keeping Windows CI green.
- **Release state is not source code.** A PR cannot clean draft releases or
  manufacture historical remote tag state.

## Rejected Alternatives

- Do not catch the entire library load and return an empty array; that preserves
  the dangerous "all papers disappeared" symptom.
- Do not silently skip corrupt files without a visible recovery path.
- Do not delete the non-macOS/non-Windows print branch to make Linux compile.
- Do not fix flaky tests with unconditional sleeps or merely rerun CI until it
  turns green.
- Do not remove wildcard HTTP access without validating the user-pasted URL
  autofill contract.
- Do not claim dependency advisories are exploitable solely from severity, or
  dismiss them solely because they appear transitive.
- Do not mark packaged, Windows, or provider backup evidence complete unless it
  was run on the stated candidate.
- Do not split the work preemptively into many PRs. Split CSP or dependency work
  only if implementation reveals a genuinely independent, high-risk migration.
- Do not alter GitHub drafts, tags, releases, or branch protection under the
  authority of this handoff.

## Repository State

- Project: `/Users/andresdominicci/Projects/apa`
- Branch: `main`, tracking `origin/main`
- HEAD reviewed: `363bf3dad4600da0a346d47a021324110cda069e`
  (`Add production-readiness fix handoff`)
- Application baseline: parent `e881879f14d4c54eabb2355a2619176ee791fc5b`
  (`Adopt Tesina Design System v2 (v0.1.16) (#43)`)
- The only committed diff between those SHAs is the predecessor handoff.
- The worktree was clean before this new handoff was generated. This handoff is
  intentionally the only new local file from this review. No application code,
  commit, push, PR, merge, deployment, tag, or release was created.

## Constraints and Invariants

- Follow the repository `AGENTS.md`; do not load the duplicative `CLAUDE.md`.
- UI/chrome messages use Paraglide and the UI locale. Essay content uses
  `essay.settings.documentLanguage`; do not mix them.
- Preserve atomic writes, autosave, rotating backups, and relative figure
  assets. A corrupt file must not be overwritten during recovery.
- New ProseMirror behavior must stay aligned across schema, CSS, preview, DOCX,
  and focused golden coverage. This PR should not introduce unrelated editor
  behavior.
- Pure packages must not import Tauri APIs or receive data URLs.
- Keep `essay.schemaVersion` at 2 for additive changes.
- Use only repository-compatible licenses; do not add AGPL code or copied APA
  manual fixtures.
- Preserve unrelated user files and changes. Never stop unowned processes or
  clear port 1420.
- Release/tag/publish operations remain separate and require explicit authority.
- Make one v0.1.17 version update after behavior is settled; avoid intermediate
  version churn.

## Evidence and Verification

Fresh evidence gathered during this review:

- The cross-agent handoff validator reports the predecessor handoff structurally
  valid but stale because HEAD moved from `e881879` to `363bf3d`.
- `git diff --stat e881879..363bf3d` contains only the 399-line predecessor
  handoff.
- Local `deno fmt --check` checks 391 files and reports exactly the predecessor
  handoff as unformatted.
- CI run `32125164183` at `363bf3d`:
  - primary test job fails Format check;
  - WKWebView pagination proof passes;
  - WebView2 focused suite fails 1 of 253 tests at the 5-second
    `windowsHostContract.test.ts` deadline.
- Artifact run `32125164159` at `363bf3d`:
  - macOS installer compile, verification, and basic package smoke pass;
  - Windows installer compile and verification pass;
  - Ubuntu fails at `pdf_export.rs:533` with Rust E0282.
- Before the docs-only commit, local `deno task check` passed with 0 errors and
  warnings, `deno lint` passed, `deno fmt --check` passed, `cargo test` passed
  54/54, and a local macOS application build passed.
- The full local unit suite was red only at the two `proofProcess.test.ts`
  races: 1,447 passed and 2 failed. Three subsequent focused runs passed all 4
  tests.
- `deno audit --frozen` reports 7 advisories: 3 high, 3 moderate, 1 low, 0
  critical.
- `gh issue list --state open` returned no open issues; absence of issues is not
  evidence that the code findings are fixed.
- Exact remote release/tag checks confirm draft releases v0.1.15 and v0.1.11,
  and no local or remote `v0.1.13` tag.

Expected final proof is all applicable local gates green plus green PR CI,
pagination, and installer matrices, followed by recorded macOS packaged
backup/import scenarios on the exact v0.1.17 candidate. Classify any failure as
code, environment, or external-state evidence rather than rerunning blindly.

## Open Questions and Blockers

- The owner has not yet authorized implementation. The immediate next action is
  to obtain that authorization, not to start changing code from this handoff.
- Decide the exact macOS packaged backup/import scenarios and evidence location
  before running them. Use the existing OpenSpec acceptance language as the
  starting point.
- Decide whether v0.1.17 is macOS GA only (recommended, consistent with current
  docs) or whether the owner wants Windows GA. Windows GA would add signing and
  platform evidence outside the smallest production-ready scope.
- If a restrictive CSP breaks a required Tauri/plugin flow and cannot be fixed
  within the release slice, report the exact incompatibility and propose a
  separately bounded hardening PR instead of weakening or guessing.
- External draft-release cleanup and the missing v0.1.13 tag remain separate
  approval questions after the source PR; they do not block starting the PR.

## Next Actions

1. Ask the owner to explicitly authorize the single v0.1.17 PR implementation
   and confirm macOS GA scope.
2. Revalidate branch, HEAD, worktree, current CI, and the named source lines.
3. Create a `features/` branch only after authorization and implement the Plan
   in reviewable commits, preserving unrelated state.
4. Stop and report if CSP/dependency work becomes a broad migration or if
   packaged evidence requires credentials or external actions not authorized.
5. Open, merge, publish, tag, or clean remote releases only when each action is
   explicitly requested and the exact target is reconfirmed.

## Receiver Start Prompt

Read this handoff and its `continues_from` predecessor, then revalidate
`git status --short`, `git rev-parse HEAD`, CI runs `32125164183` and
`32125164159`, and the P1/P2 source paths. Do not mutate the repository until
the owner explicitly authorizes implementing the single v0.1.17
production-readiness PR. Once authorized, start by formatting the predecessor
handoff and writing the focused failing P1 regression tests before changing
production code.

<!-- Repository status captured at creation:
clean
-->

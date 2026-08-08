---
handoff_version: "1"
created_at: "2026-08-08T08:33:46.200896+00:00"
updated_at: "2026-08-08T08:36:03+00:00"
from_agent: "Codex"
to_agent: "Next implementation agent"
project_root: "/Users/andresdominicci/Projects/apa"
git_branch: "features/portable-library-backup-design"
git_head: "3dc455cabf24ec4ef5eccfb14636c7be13bf32b4"
status: "ready"
continues_from: ""
---

# Cross-Agent Handoff: Implement portable library archives and folder backups

## Objective

Hand the accepted `add-portable-library-backups` OpenSpec change to a fresh
implementation agent with enough repository, product, architecture, security,
test, and release context to execute it without access to the originating chat.
The target outcome is a complete-library `.tesina` archive, lossless Merge
import/recovery, and an optional user-friendly five-step backup wizard for one
user-selected local or cloud-synced folder. Preserve Tesina's JSON-plus-assets
working storage; do not add SQLite.

## Current State

- Planning is complete and implementation has not started: OpenSpec reports
  `ready`, 83 total tasks, 0 complete, 83 remaining.
- The proposal was created in commits `991d939` and `dc2e851`, then hardened
  after five independent product, archive-security, Tauri, OpenSpec, and
  release/testing audits in commit `ad4d27b`.
- Current HEAD `3dc455c` is a separate cleanup commit that removed obsolete
  `.playwright-mcp` artifacts and added that directory to `.gitignore`; it did
  not change the feature design.
- The worktree was clean when this handoff was created and immediately before
  the final verification run.
- No feature code, dependency, schema, UI, version, release, push, PR, or deploy
  work has been performed for this change.
- The user authorized creation and hardening of the proposal and this handoff.
  This document alone grants no implementation, commit, push, PR, merge,
  release, deployment, database, secret, or other external-write authority.

## Plan

Use the executable checklist at
`/Users/andresdominicci/Projects/apa/openspec/changes/add-portable-library-backups/tasks.md`.
Its 12 ordered groups are the authoritative implementation plan:

1. Establish representative safety fixtures, select concrete limits, prove the
   ZIP parser can expose required metadata, and audit dependency licenses.
2. Implement deterministic pure archive types, canonical JSON, manifests,
   checksums, fixtures, and round trips.
3. Implement bounded hostile-input validation, canonical IDs, typed contained
   paths, JSON/image limits, and adversarial tests.
4. Add an exclusive persistence snapshot/maintenance lease, immutable app-data
   staging, one archive service, and restart-recoverable destination writes.
5. Implement pure Merge planning, semantic identity, asset normalization,
   document-language copy labels, remapping, and consistency checks.
6. Implement redundant journaled import, validated rollback, hash-aware removal,
   startup fail-closed recovery, operation coordination, and rollback retention.
7. Wire persistent manual Export library and Import library entry points plus
   the shared accessible Merge modal.
8. Add the purpose-specific Rust backup-directory adapter and Rust-owned native
   authorization/ownership records; prove scope isolation across restart.
9. Add exact-snapshot scheduling, single flight, daily eligibility, provider
   failure handling, and ledger-proven seven-version retention.
10. Build the bilingual five-step wizard, deterministic optional card, status,
    next-backup explanation, Turn off/Re-enable, and Restore by merging UX.
11. Complete deterministic integration, crash/restart, packaged macOS/Windows,
    provider, permission-negative, and privacy-redacted evidence.
12. Run every gate, build a scenario-evidence matrix, update the next version,
    changelog/release enforcement, follow PR policy, publish the verified macOS
    updater release, and retain a forward-fix rollback runbook.

## Decisions and Rationale

- **Keep JSON plus separate assets.** The current storage is appropriate for a
  local-first editor; portability is an archive concern and does not justify a
  SQLite migration.
- **One versioned `.tesina` ZIP contract.** It contains `manifest.json`,
  `library.json`, `essays/<uuid>.json`, and reachable `assets/...`; device
  preferences, backup settings, deleted backups, and orphan assets stay local.
- **Checksums are integrity-only.** SHA-256 detects corruption and incomplete
  copies. The unsigned archive is not authenticated and version one is
  unencrypted; UI copy must never imply otherwise.
- **Capture under an exclusive staged snapshot lease.** `flushPending()` alone
  does not freeze later saves. Flush, stage one generation, retry/abort on a
  mutation, and package only staged bytes. Record only the digest returned by
  the exact validated snapshot.
- **Validate attacker-controlled input before planning or paths.** Bound ZIP
  bytes/entries/expansion, JSON structure, identifiers, and decoded images.
  Require canonical lowercase UUIDs, filename/payload binding, and final native
  containment checks.
- **Feasibility before ZIP dependency lock-in.** `fflate` is available but its
  public streaming API does not expose every central-directory attribute needed
  for symlink/non-regular rejection. Select a bounded parser/native crate only
  after adversarial fixtures prove the required surface.
- **Merge only; never replace.** New items are added, semantic duplicates are
  skipped, and same-ID conflicts become remapped imported copies. Asset targets
  are resolved before essay semantic comparison. Imported title suffixes follow
  document language; modal/chrome copy follows UI language.
- **Redundant restart recovery.** Persist and reopen-validate journal evidence
  before live writes. Rollback deletes only paths whose current bytes match
  expected import output. If resume and rollback are both unsafe, fail closed
  and preserve evidence instead of guessing.
- **One native folder authority, not global persisted-scope.** Tauri's
  persisted-scope serializes the whole filesystem scope, including manual dialog
  selections. Rust purpose-specific commands own exactly one active backup
  directory; old and transient paths must be denied after restart.
- **Split native and UI settings ownership.** Rust exclusively owns atomic
  `$APPDATA/backup-directory.json` and `$APPDATA/backup-ledger.json`; Svelte
  owns UI/status fields in `settings.json`. This prevents cross-writer races.
- **Prove retention ownership.** Filename plus manifest cannot distinguish two
  devices using one synced folder. Prune only a ledger-recorded file whose
  `backupSetId` and current hash match. Missing/disagreeing evidence means keep.
- **Test and Back up now are retained backups.** Both count toward the newest
  seven. Manual Export library files are never pruned.
- **Provider-neutral local success.** Tesina reports only that the selected
  folder file is closed, visible, reopened, and valid. Google Drive/iCloud/etc.
  own remote-upload reporting.
- **Wizard remains explicit and reversible.** Five steps are Why, Choose
  location, Review privacy, Test backup with affirmative consent, and Success.
  Users can Turn off/Re-enable; changing/disabling leaves old archive bytes.

## Rejected Alternatives

- SQLite now: adds migration risk without solving the immediate portability and
  recovery problem.
- Provider SDKs, Tesina accounts, hosted storage, or live multi-device sync:
  unnecessary for provider-neutral folder backup and explicitly deferred.
- Global Tauri persisted-scope: persists unrelated and prior dialog grants and
  cannot enforce the promised one-folder boundary.
- `flushPending()` followed by live multi-file reads: can mix revisions.
- Blind use of `fflate` streaming APIs: cannot inspect every required ZIP entry
  attribute through the public interface.
- Copying app data verbatim: would leak device settings/backups and orphan data.
- `unzipSync` then validate: a compression bomb can allocate before checks.
- Newest-timestamp-wins or replace-library import: timestamps do not express
  user intent and replacement can destroy newer local work.
- Filename-only retention: one device could delete another device's backup.
- Calling a reopen-validated write “power-loss durable”: unsupported without
  verified file and parent-directory synchronization on each platform.

## Repository State

- Project root: `/Users/andresdominicci/Projects/apa`
- Branch: `features/portable-library-backup-design`
- HEAD: `3dc455cabf24ec4ef5eccfb14636c7be13bf32b4`
- Proposal-hardening commit: `ad4d27bd98f2a89015478a8c6e6e8bc50f70dfc4`
- `main` and `origin/main` both: `6ff3b23ca68edf99d76131cc139d04587c56d6c7`
- Feature branch position at handoff: 4 commits ahead of `main`, 0 behind.
- Neither local nor remote `dev` exists; PR policy therefore uses `main` unless
  repository state changes before PR creation.
- Current application version: `0.1.1`.
- Critical files:
  - `/Users/andresdominicci/Projects/apa/AGENTS.md`
  - `/Users/andresdominicci/Projects/apa/openspec/changes/add-portable-library-backups/proposal.md`
  - `/Users/andresdominicci/Projects/apa/openspec/changes/add-portable-library-backups/design.md`
  - `/Users/andresdominicci/Projects/apa/openspec/changes/add-portable-library-backups/tasks.md`
  - `/Users/andresdominicci/Projects/apa/openspec/changes/add-portable-library-backups/specs/portable-library-archive/spec.md`
  - `/Users/andresdominicci/Projects/apa/openspec/changes/add-portable-library-backups/specs/library-merge-import/spec.md`
  - `/Users/andresdominicci/Projects/apa/openspec/changes/add-portable-library-backups/specs/automatic-library-backups/spec.md`
  - `/Users/andresdominicci/Projects/apa/docs/plans/2026-08-08-portable-library-backup-design.md`
  - `/Users/andresdominicci/Projects/apa/arch-portable-first-cloud-sync.html`

## Constraints and Invariants

- Read `/Users/andresdominicci/Projects/apa/AGENTS.md` before acting; repository
  evidence overrides this handoff if they differ.
- Preserve `essay.schemaVersion === 2`; do not bump it because the current
  loader hides every essay with another version.
- Keep `packages/apa-engine` and `packages/docx-export` pure. The sanctioned
  DOCX input contract must not import app/Tauri code.
- Any new editor block must update schema, editor CSS, preview, DOCX, and golden
  tests together; this feature is not expected to add a block.
- UI/chrome strings use current UI locale. Persisted document content, including
  an imported-copy title suffix, uses the essay's document language.
- Never hardcode user-facing text; update both Paraglide message files.
- Every changed `.svelte` file must pass the Svelte MCP autofixer before commit.
- Dependencies must be MIT, Apache-2, ISC, BSD, or OFL; no AGPL. Record the
  exact lockfile delta and SPDX licenses.
- Do not broaden filesystem access to `$HOME`, provider roots, or network APIs.
- Do not persist manual import/export grants. Backup native commands must not
  accept arbitrary paths after configuration.
- Do not claim remote provider upload, archive authenticity, confidentiality, or
  power-loss durability.
- Import remains additive and Merge-only. Never overwrite a local essay/asset or
  delete a path whose bytes are not proven to be import-created output.
- Preserve unrelated dirty files/worktrees. Never close/delete local or remote
  `main` or `dev`.
- If a `dev` branch exists when a PR is created, base the feature PR on `dev`;
  otherwise follow current repository policy. PR comments must be English and
  must include `@greptile review` as required by `AGENTS.md`.
- Every merged user-facing change requires the next app version, dated changelog
  notes, exact-main tag, verified updater artifacts/signatures, and published
  release. Windows runtime evidence is separate from the currently shipping
  macOS updater contract unless supported Windows publication is added.

## Evidence and Verification

Verified at current HEAD `3dc455c` on 2026-08-08:

```text
openspec validate add-portable-library-backups --strict
  Change 'add-portable-library-backups' is valid

openspec instructions apply --change add-portable-library-backups --json
  state: ready; total: 83; complete: 0; remaining: 83

deno task check
  svelte-check found 0 errors and 0 warnings

deno task test
  57 test files passed; 648 tests passed

deno fmt --check
  Checked 208 files

deno lint
  Checked 151 files
```

The three specs contain 25 requirements and 71 scenarios. Task identifiers were
checked for uniqueness: 83 tasks, no duplicates. `git diff --check` passed for
the proposal amendments before commit. No implementation/native E2E or release
evidence exists yet; those remain planned tasks, not verified outcomes.

## Open Questions and Blockers

- No planning blocker remains; strict validation is green and the change is
  apply-ready.
- Concrete numeric ZIP/JSON/image safety limits must be selected from measured
  representative fixtures during task group 1.
- The ZIP parser/native crate must be selected only after the task 1 feasibility
  fixtures prove metadata exposure and bounded output.
- Final component placement within the existing home/Settings layout may move as
  long as the optional deterministic card, persistent Settings entry, and five
  observable wizard steps remain.
- Windows runtime support requires a real packaged-app/native E2E environment;
  compilation or installer creation cannot satisfy that acceptance gate.
- macOS cloud-folder acceptance must cover iCloud Drive and one third-party File
  Provider, including timeout/offline/rehydration/conflict behavior.
- Implementation authorization is not conveyed by this handoff. Confirm the
  user's requested next operation before editing code or changing Git state.

## Next Actions

1. From `/Users/andresdominicci/Projects/apa`, validate this handoff and compare
   it with current Git state:
   `python3 /Users/andresdominicci/.codex/skills/cross-agent-handoff/scripts/handoff.py validate /Users/andresdominicci/Projects/apa/.ai/handoffs/2026-08-08-083346-implement-portable-library-archives-and-folder-backups.md`
   and then the same command with `stale` instead of `validate`.
2. Read `AGENTS.md` and every OpenSpec artifact listed under Repository State.
   Run `git status --short --branch`, `git rev-parse HEAD`,
   `openspec validate add-portable-library-backups --strict`, and
   `openspec instructions apply --change add-portable-library-backups --json`.
   Report any mismatch before acting.
3. Confirm the user has explicitly authorized implementation. If authorized,
   invoke the `openspec-apply-change` skill and begin at task 1.1. If not, stop
   after the read-only verification and request direction.
4. Execute tasks in dependency order with RED/GREEN/REFACTOR evidence. Make the
   ZIP feasibility decision before selecting dependencies and the snapshot lease
   before any export/backup wiring.
5. Keep each slice independently reviewable and verified. Preserve unrelated
   changes, use English commits, and do not push/open a PR/merge/release without
   matching user authorization.
6. Before claiming completion, satisfy every scenario in the evidence matrix,
   run all four root gates, Svelte-autofix every changed component, complete
   native macOS/Windows/provider evidence, version/release work, and the current
   repository PR/publication policy.

## Receiver Start Prompt

Resume the cross-agent handoff at
`/Users/andresdominicci/Projects/apa/.ai/handoffs/2026-08-08-083346-implement-portable-library-archives-and-folder-backups.md`.
Validate it and run its stale check first, then verify the branch, HEAD, clean
worktree, AGENTS.md, and OpenSpec status directly. Treat repository evidence as
authoritative and report mismatches. Do not assume the handoff itself grants
write, commit, push, PR, merge, release, or deployment permission. If the user
explicitly authorizes implementation, use the `openspec-apply-change` skill and
begin with Next Actions item 1/task 1.1, following the 83 tasks in dependency
order with test-first evidence. Preserve JSON-plus-assets storage, schema
version 2, Merge-only import, the narrow Rust backup-folder boundary,
exact-snapshot digests, ledger-proven retention, bilingual wizard requirements,
and all release invariants.

<!-- Repository status captured at creation:
clean
-->

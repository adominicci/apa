# Requirement–evidence matrix — add-portable-library-backups

Task 12.2: every spec requirement mapped to named automated tests, durable
native evidence, or an explicit deferred justification. Test names refer to
files under `apps/desktop/src/lib/` (Vitest) and
`apps/desktop/src-tauri/src/backup_directory.rs` (cargo).

Legend: ✅ automated · 📦 packaged-app evidence · ⏸ deferred with justification.

## portable-library-archive

| Requirement | Evidence |
| --- | --- |
| Complete content-library export | ✅ `portable/archive.test.ts` "content scope" suite (exact entry set, orphan/device exclusion); fail-closed invalid-source: `archive.test.ts` "fails the whole export…" + `persist/librarySnapshot.test.ts` "fails closed naming the offending invalid essay file" |
| Versioned and checksummed manifest | ✅ `portable/archive.test.ts` "manifest contract" suite (records, byte lengths, SHA-256, forward-version rejection) |
| Stable snapshot before archive creation | ✅ `persist/librarySnapshot.test.ts` (flush-before-read, flush-rejection abort, mutation retry with no mixed revision, unstable abort) |
| Strict archive validation | ✅ `portable/validate.test.ts` (grammar, counts, schemas, identifiers, images, relationships) + `portable/zip.feasibility.test.ts` (container attacks) + `portable/limits.test.ts` (declared/observed limits) + mutation sweep "rejects every archive with one corrupted entry payload" |
| Safe destination write | ✅ `persist/portableFiles.test.ts` (exclusive create, collision, replacement journal, crash recovery at every boundary, no-guess on unexpected bytes) |
| Provider-neutral and unencrypted version-one archive | ✅ copy audited in `messages/en.json`/`es.json` (`lib_export_scope`, `lib_export_privacy_note` — checksums described as corruption-detection only); no-account export is structural (no account system exists) — asserted by the absence of any credential dependency in `portable/*` (pure modules) |

## library-merge-import

| Requirement | Evidence |
| --- | --- |
| Validate before planning or writing | ✅ `persist/importFlow.test.ts` (validation precedes preview; invalid archive leaves state untouched via `validate.test.ts` rejections) |
| Explicit Merge preview | ✅ `components/LibraryImportModal.test.ts` (counts, consequences, cancel-no-writes, no replace operation) |
| Plan freshness at apply | ✅ `persist/importJournal.test.ts` "aborts before any live write when the library changed after planning"; `persist/importFlow.test.ts` replan-transparent and replan-needed paths |
| Cross-process exclusion | ✅ `tauri-plugin-single-instance` registered first in `lib.rs` (second launch focuses the first instance and exits before any plugin/state); ⏸ exact-candidate packaged double-launch proof remains pending |
| Lossless essay identity handling | ✅ `portable/importPlan.test.ts` matrix (same-title/different-id, identical skip, conflicting copy with document-language suffix) + `portable/semantic.test.ts` |
| Consistent reference and collection remapping | ✅ `portable/importPlan.test.ts` + `portable/remap.test.ts` (never mutates local essays, deep-freeze proofs) |
| Safe asset deduplication and remapping | ✅ `portable/importPlan.test.ts` (byte-identical reuse, colliding-path allocation) + self-import skip test (5.8) |
| Validated rollback before merge | ✅ `persist/importJournal.test.ts` (rollback created and validated before live writes; retention keeps unfinished rollbacks) |
| Idempotent journaled apply and startup recovery | ✅ fault-injection sweep (crash at every fs operation → resumed/rolled-back/complete, byte-exact, no duplicates); fail-closed with both journals corrupt; unexpected-bytes preservation |
| Final consistency gate | ✅ `applyImport` post-apply verification tests + `assertPlanConsistent` unit tests |
| Restore uses Merge semantics | ✅ `LibraryImportModal.test.ts` restore-mode consequence text (incl. deleted-content re-add disclosure); restore shares the exact import modal/planner/journal |

## automatic-library-backups

| Requirement | Evidence |
| --- | --- |
| Discoverable but optional setup | ✅ `BackupStatusCard` component tests (dismissal persistence, non-blocking) |
| Step-by-step bilingual backup wizard | ✅ `BackupSetupWizard` component tests (five steps, EN+ES, cancel at every step) |
| Persist only the selected folder scope | ✅ cargo tests: v0.1.16 renderer-writable authority is rejected without migration; only validated renderer-nonwritable cache records restore a v0.1.17 folder; AppData metadata is inert; missing/malformed/oversized/inconsistent authority evidence is preserved and fails closed to `requiresReauthorization` without blocking app setup; symlink + both-direction app-data/cache containment rejections; re-canonicalization denial after folder replacement. ⏸ exact-candidate packaged restart proof remains pending. |
| Validated test before enabling backup | ✅ cargo tests (pending isolation, native pending set identity, activation requires test write, cancel removes only its own file, `Tesina Backups` subfolder creation) + `backupRuntime.test.ts`/wizard tests proving the real test filename and manifest use the same pending `backupSetId` |
| Changed-content daily scheduling | ✅ `state/backup.svelte.test.ts` (first changed session, unchanged skip, local-day gating incl. timezone boundary, Back up now bypass, failure retry, mutation-during-write digest) |
| Observable backup state | ✅ `BackupSettings`/`BackupStatusCard` component tests (running preserves previous success, turn off revokes without deleting, re-enable requires new test, one-time bilingual reauthorization explains v0.1.17 hardening and untouched old files) |
| Backup failure never blocks writing | ✅ `backup.svelte.test.ts` stable error codes with local writing untouched (store never touches essay persistence); non-blocking UI asserted in component tests |
| Safe seven-version retention | ✅ `portable/retention.test.ts` (ledger-first, never parses unowned files, set-identity, oldest-first beyond seven, missing-ledger retain-all, warning at 15 before the native cap of 16) + cargo pre-delete hash recheck tests + `backup.svelte.test.ts` prune-failure-as-warning and one bounded retention-then-write retry at the native cap |
| Provider-neutral folder operation | ✅ message copy names providers without integration claims (`bk_*`, `lib_export_*`); success wording is local-validation-only; ⏸ exact-candidate iCloud/provider proof remains pending |
| Restore routes through safe Merge | ✅ settings Restore opens the shared Merge modal (component test); bounded listing enforced by `readTesinaBounded` + full validation before preview |

## Native / packaged evidence (task 11.4–11.8, 8.2)

| Item | Status |
| --- | --- |
| Packaged macOS build (task 4.6/11.4 precondition) | ⏸ no current package satisfies this gate. Earlier package evidence predates the final v0.1.17 trust-anchor and safe-write fixes; rebuild from the exact reviewed commit and record its digest before acceptance. |
| Packaged macOS interactive scenario matrix (export/import round trip, folder configure, restart re-auth, Back up now, 8→7 retention, Restore) | ⏸ manual pre-publication gate: requires interactive native dialogs on the exact reviewed v0.1.17 package. Include first-upgrade reauthorization, a normal subsequent restart without reprompt, and cache-anchor-loss fail-closed proof. Do not adopt or delete pre-v0.1.17 metadata/archives. |
| Windows packaged run (11.5) | ⏸ deferred: no Windows runtime available in this environment. Per amended task text this remains a release gate for supported Windows publication; the currently shipping updater contract is macOS-only, and the PR documents this explicitly. |
| iCloud + third-party File Provider matrix (11.7) | ⏸ deferred to a manual pass before release publication; scenarios listed in tasks.md; local-validation-only wording verified by automated copy tests. |
| Power-loss durability | Not claimed anywhere (spec: interruption contract covers close/restart/crash after reopen-validated journal writes; wording audited). |

## Pre-commit gates

The prior gate block was stale and referred to the base HEAD. This matrix
satisfies task 12.2 by mapping each requirement to automated evidence or an
explicit deferred justification. Exact test counts, immutable commit/package
identifiers, and package-digest evidence for tasks 11.8 and 12.8 remain pending
the final reviewed commit and packaged acceptance run.

# Requirement–evidence matrix — add-portable-library-backups

Task 12.2: every spec requirement mapped to named automated tests, durable
native evidence, or an explicit deferred justification. Test names refer to
files under `apps/desktop/src/lib/` (Vitest) and
`apps/desktop/src-tauri/src/backup_directory.rs` (cargo).

Legend: ✅ automated · 📦 packaged-app evidence · ⏸ deferred with justification.

## portable-library-archive

| Requirement | Evidence |
| --- | --- |
| Complete content-library export | ✅ `portable/archive.test.ts` "content scope" suite (exact entry set, orphan/device exclusion); fail-closed invalid-source: `archive.test.ts` "fails the whole export…" + `persist/librarySnapshot.test.ts` "fails closed naming the offending invalid essay file"; 📦 `PKG-PORTABLE-5012250-20260819` builds an isolated release-mode smoke app, seeds the full persisted library fixture, exports through the production archive/native-safe-write path, independently reopens it, and verifies 16 essays, 30 references, 1 collection, 38 assets, 54 citation nodes, 63 citation items, and all 95,818 figure bytes |
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
| Cross-process exclusion | ✅ `tauri-plugin-single-instance` registered first in `lib.rs` (second launch focuses the first instance and exits before any plugin/state); 📦 `MAC17-SINGLE-INSTANCE-01` launched the exact executable while the first window was hidden, reopened the guarded window, and left one process |
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
| Persist only the selected folder scope | ✅ cargo tests: v0.1.16 renderer-writable authority is rejected without migration; only validated renderer-nonwritable cache records restore a v0.1.17 folder; AppData metadata is inert; missing/malformed/oversized/inconsistent authority evidence is preserved and fails closed to `requiresReauthorization` without blocking app setup; symlink + both-direction app-data/cache containment rejections; re-canonicalization denial after folder replacement. 📦 `MAC17-BACKUP-RESTART-01` restored the exact folder without a reprompt, while `MAC17-REAUTH-01` proved cache-authority loss fails closed and leaves external archives untouched until a new picker/test succeeds. |
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
| Earlier packaged macOS manual matrix (11.4) | 📦 `MAC17-DD0B188-20260818`: app version 0.1.17 from `dd0b188810ed0ecfbc101b5ccef8ff94e5a10f17`; package SHA-256 `535cabcc8c854264c1f0ccffefdbe81d60d6e4bce42babdf208fc02e045b14ae`; manual export/import, native folder selection, restart, retention, restore, single-instance, launch, and strict on-disk code-sign verification passed. See `v0.1.17-macos-native-acceptance.md`. This record remains manual behavioral evidence and is not presented as the current candidate package. |
| Exact-candidate automated macOS package (11.8) | 📦 `MAC17-AUTOMATED-5012250-20260819`: source `501225075df4fe216fead7fe4d9576d55c2b407e`, app version 0.1.17, package SHA-256 `e7305f2221d92e0954da3d33eba8d8977ed68ded24a1436362b02018b57a6ea4`, executable SHA-256 `8f294fe4bec07673da882b723f00102f126396645fde2a3ddf299b594dc401bb`; four launches, restart scope, safe manual replacement, seven-version retention, and exact fixture restore passed. See `v0.1.17-automated-packaged-smoke.md`. |
| Automated packaged export/reopen harness (4.6) | 📦 `PKG-PORTABLE-5012250-20260819`: the exact `501225075df4fe216fead7fe4d9576d55c2b407e` candidate passed `deno task smoke:portable:packaged` under bundle identifier `app.tesina.desktop.portable-smoke.2ef5a917f0d84af8be02578d5bb25337`; exact counts and relationships matched the full-library fixture, every figure byte matched after independent reopen, asset bytes totaled 95,818, and asset aggregate SHA-256 was `54e5c06f621dcce65778ca15595505259f09220a92a1a91e74b39f8e94583e71`. The compile-time smoke flavor is isolated from the shipping bundle, and success is emitted only after required task-owned cleanup. |
| Packaged macOS interactive scenario matrix (export/import round trip, folder configure, restart re-auth, Back up now, 8→7 retention, Restore) | 📦 complete under the earlier manual record `MAC17-IMPORT-01` through `MAC17-SINGLE-INSTANCE-01`. Restore proved 16 identical essays and zero conflicts. A normal restart restored authorization without a prompt; cache-anchor loss required a fresh picker/test and preserved all seven prior-set archive names. The exact-candidate automated package record above separately exercises the current post-selection native pipeline and full fixture restore. |
| Windows packaged acceptance (11.5, pending) | ⏸ An exact-feature-SHA `windows-latest` PR/main gate builds the non-shipping smoke flavor, silently installs its generated NSIS artifact into a run-owned directory, launches that installed executable through four bounded processes, and independently checks restart scope, real plugin-fs denial of parent/sibling/old/transient paths, archive retention, and restored fixture bytes. The feature-only environment selectors exercise the shared post-selection native pipeline but do not prove the shipping Windows folder/save dialogs. Task 11.5 remains pending until the Windows job actually passes and literal dialog behavior is recorded. Capability diff: `capabilities/default.json` adds deny-only renderer exclusions for `$APPDATA/.tesina-native`, `$APPDATA/.tesina-native/**`, `$APPCACHE/.tesina-native`, and `$APPCACHE/.tesina-native/**`; it adds no broad external grant, persisted scope, provider permission, or network permission. The smoke commands are compile-time-only. Signing/updater and provider-sync proof remain separate release evidence. |
| iCloud + third-party File Provider matrix (11.7) | ⏸ deferred to a manual pass before release publication; scenarios listed in tasks.md; local-validation-only wording verified by automated copy tests. |
| Power-loss durability | Not claimed anywhere (spec: interruption contract covers close/restart/crash after reopen-validated journal writes; wording audited). |

## Pre-commit gates

This matrix satisfies task 12.2 by mapping each requirement to automated
evidence or an explicit deferred justification. Exact tested application commit,
package-digest, scenario, archive, restart, and log-attachment evidence for
task 11.8 is recorded in `v0.1.17-automated-packaged-smoke.md`; the earlier
manual dialog and screenshot record remains in
`v0.1.17-macos-native-acceptance.md`. Task 12.8 remains pending PR, Windows,
release-workflow, updater-publication, and final branch/tag evidence.

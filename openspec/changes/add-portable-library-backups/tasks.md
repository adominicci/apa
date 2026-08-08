## 1. Handoff baseline and security limits

- [x] 1.1 Read `AGENTS.md`, this change's `proposal.md`, all three capability
      specs, `design.md`, and
      `docs/plans/2026-08-08-portable-library-backup-design.md`; confirm the
      active change is `add-portable-library-backups` and do not expand the
      deferred scope.
- [x] 1.2 Record `git status --short --branch`, current commit, current version,
      and pre-existing worktree changes before editing; preserve unrelated files
      and use independently reviewable English commits.
- [x] 1.3 Build representative fixtures for an empty library, a large text
      library, and a figure-heavy library; use their measured sizes to choose
      and document maximum archive bytes, entry count, single expanded entry,
      total expanded bytes, compression ratio, JSON depth/node/string/entity
      counts, image dimensions/frames, and cumulative decoded pixels in
      `apps/desktop/src/lib/portable/limits.ts`.
- [x] 1.4 Add failing tests proving the chosen limits reject oversized declared
      and observed input while accepting the representative supported fixtures.
- [x] 1.5 Run a failing feasibility spike against data-descriptor ZIP, ZIP64,
      encrypted-bit, Unix-symlink-mode, unsupported-compression, and missing-size
      fixtures; select a bounded central-directory parser plus inflater or a
      native ZIP crate that exposes every required field before dependency
      lock-in. Do not assume `fflate` alone can reject non-regular entries.
- [x] 1.6 Add the selected direct dependencies, regenerate Deno/Cargo lock data,
      and record exact resolved versions and SPDX licenses for the full new
      transitive dependency delta; every license must satisfy `AGENTS.md`.

## 2. Pure archive contract and deterministic bytes

- [x] 2.1 Add failing tests for manifest version one, stable JSON ordering,
      UTF-8 encoding, SHA-256 file records, content counts, `encryption: null`,
      and forward-version rejection.
- [x] 2.2 Implement `portable/types.ts`, `canonicalJson.ts`, and digest helpers
      with injected clock/version/UUID dependencies; keep the modules free of
      Svelte, runes, Tauri, and filesystem paths.
- [x] 2.3 Add failing fixtures for complete content scope: multiple essays,
      document settings, references, collections, nested citations, figure
      assets, device settings, deleted backups, and an orphan asset.
- [x] 2.4 Implement pure snapshot assembly and archive normalization so only
      valid schema-version-2 essays, schema-version-1 library content, and
      reachable assets enter `manifest.json`, `essays/`, `library.json`, and
      `assets/`.
- [x] 2.5 Add failing round-trip and golden tests proving deterministic archive
      output across separate processes when injected metadata and ZIP entry
      order, UTF-8 flags, compression settings, OS attributes, and modification
      times are fixed; prove device settings, deleted backups, and orphan assets
      are absent.
- [x] 2.6 Implement ZIP creation in `portable/archive.ts` and make every
      produced archive reopen through the group-2 structural reader (manifest
      parse plus checksum verification) before its bytes can be returned as a
      successful result; task 3.4 upgrades this reopen gate to the full
      validator.

## 3. Bounded untrusted archive validation

- [x] 3.1 Add adversarial tests for malformed ZIP bytes, encrypted entries,
      absolute paths, parent/dot traversal, backslashes, NULs, duplicate
      normalized paths, unknown top-level paths, entries violating the exact
      allowed-path grammar (uppercase, non-ASCII, multi-dot, or overlong
      extensions), symlinks/non-regular entries, checksum and length
      mismatches, missing manifest, duplicate manifest, and unsupported
      versions.
- [x] 3.2 Implement bounded streaming ZIP intake in `portable/archive.ts` with a
      declared-size preflight at the pure intake boundary plus authoritative
      observed counters before parsing expanded payloads; when
      `persist/portableFiles.ts` is created in task 4.4, wire the native
      file-size check there. Do not use unbounded `unzipSync` on imported
      files.
- [x] 3.3 Add failing JSON-shape tests for invalid manifest fields, essay schema
      versions other than 2, malformed shared-library schema, invalid reference
      and collection arrays, non-canonical/overlong IDs, filename/payload ID
      mismatches, JSON complexity limits, image signature/media-type mismatch,
      image dimension/frame/pixel limits, unsupported figure extensions,
      missing referenced assets, and citations, reference snapshots, or
      collection members that reference identifiers absent from the archive.
- [x] 3.4 Implement `portable/validate.ts` with discriminated localized error
      codes and relationship validation; never write an archive entry path
      directly to disk.
- [x] 3.5 Add mutation tests that corrupt each golden archive entry one at a
      time and prove validation fails before import planning.
- [x] 3.6 Add typed local-path constructors and native canonical-containment
      checks; test separators, traversal, Unicode lookalikes, reserved names,
      symlinks/reparse points, and every attacker-controlled identifier before
      any app-data path is derived.

## 4. Stable app-data snapshot and recoverable archive writes

- [x] 4.1 Add tests that hold pending essay and library writes open, start a
      snapshot, and prove snapshot reading waits for
      `persistence.flushPending()` and aborts if the barrier rejects; then race
      essay/library/asset mutations and concurrent export, backup, rollback,
      import, and retention work at every enumeration/read boundary and prove no
      mixed revision is returned.
- [x] 4.2 Extend persistence coordination with an exclusive snapshot/maintenance
      lease and generation tracking. Implement `persist/librarySnapshot.ts` to
      flush, stage every valid essay, `library.json`, and reachable asset under a
      UUID app-data snapshot, retry/abort on mutation, reject rather than skip
      invalid source data, and release only after staging is immutable.
- [x] 4.3 Add tests for cancelled save dialogs, failed destination writes,
      existing destination preservation, temporary-file cleanup, and validation
      of the written file before success.
- [x] 4.4 Implement `persist/portableFiles.ts` with native `.tesina` open/save
      and folder dialogs, UUID-named sibling temporary files, reopen validation,
      direct same-filesystem replacement where safe, exclusive no-replace
      creation for new automatic-backup filenames (a collision selects a new
      unused name and never overwrites a file this operation did not create),
      and a journaled fallback that preserves the previous destination until
      the new file reopens and validates. Add startup/next-access recovery and
      termination tests at every rename and cleanup boundary.
- [x] 4.5 Create one injected `LibraryArchiveService` used by manual export,
      rollback creation, test backup, scheduled backup, and Back up now;
      return the digest of the exact archived snapshot and prohibit duplicate
      packaging implementations.
- [ ] 4.6 Add a packaged-app smoke harness that exports a real current library,
      reopens it, and checks manifest counts, citations, references,
      collections, and figure bytes.

## 5. Pure Merge planning and identity remapping

- [x] 5.1 Extend `model/essay.ts` with optional `importedAt` and `sourceEssayId`
      while retaining `schemaVersion: 2`; add load/persist/summarize regressions
      for old essays and imported copies.
- [x] 5.2 Add semantic-hash tests proving `updatedAt`, `importedAt`, and
      `sourceEssayId` do not create false essay conflicts while title-page,
      settings, document, creation date, and reference-snapshot changes do.
- [x] 5.3 Add failing `portable/remap.ts` tests covering citation IDs and figure
      paths inside body sections, abstracts, appendices, paragraphs, nested
      lists, tables, and any supported block container, plus
      `referencesSnapshot`.
- [x] 5.4 Implement pure citation/reference/collection/asset remappers and prove
      they never mutate a pre-existing local essay object.
- [x] 5.5 Add import-plan matrix tests for new essays, same-title/different-ID
      essays, semantically identical same-ID essays, conflicting same-ID essays,
      identical/conflicting references, identical/conflicting collections,
      same-byte assets, and path-colliding different-byte assets.
- [x] 5.6 Implement `portable/importPlan.ts` with injected transaction/UUID/time
      dependencies, stable operation IDs, imported-copy labels selected from
      each essay's document language, and explicit preview/result counts. Keep
      preview/chrome explanations on the current UI language axis.
- [x] 5.7 Add final pure consistency checks proving every planned citation,
      snapshot reference, collection membership, and figure path resolves after
      the plan is applied to an in-memory fixture.
- [x] 5.8 Resolve the asset checksum-to-local-path plan before semantic essay
      comparison; add a self-import fixture with an identical illustrated essay
      and prove it is skipped rather than copied because archive-normalized and
      local figure paths differ.

## 6. Journaled import, rollback, and startup recovery

- [x] 6.1 Define and test a versioned import-journal schema containing
      transaction ID, archive hash, rollback path/hash, staged/final operations,
      expected final hash/length/type, proof that additive targets did not exist,
      per-operation completion, terminal status, and a redundant checksummed
      operation manifest or independently validated journal copy.
- [x] 6.2 Add fault-injection tests for failure before the journal, after each
      asset/essay move, before and after `library.json` replacement, during
      final consistency validation, and during staging cleanup; include a case
      where the live library revision changes between preview confirmation and
      apply and prove the import replans or aborts without writing.
- [x] 6.3 Implement `persist/importJournal.ts` to stage under
      `$APPDATA/imports/<transaction>/`, validate a full rollback archive under
      `$APPDATA/backups/imports/`, persist the journal before live writes, and
      apply only additive unused essay/asset paths plus one atomic library
      replacement built from the revision current at apply after verifying the
      live library revision still matches the plan-time revision.
- [x] 6.4 Implement idempotent resume that verifies staged/final hashes and
      skips completed stable operation IDs without producing duplicate essays,
      references, collections, or assets.
- [x] 6.5 Implement rollback that restores the previous library and removes only
      new final paths whose current bytes match the journaled expected output;
      preserve/quarantine mismatches and enter manual recovery rather than
      deleting an unlisted, changed, or pre-existing path.
- [x] 6.6 Add startup recovery before normal essay/library interactivity: resume
      a valid transaction, otherwise restore the validated rollback, surface a
      localized recovery result, and start backup eligibility only afterward.
      Add missing/corrupted journal, stage, and rollback combinations proving an
      unrecoverable case fails closed with Retry, privacy-safe diagnostic export,
      and quit guidance while preserving evidence.
- [x] 6.7 Add a distinct `OperationCoordinator`: persistence flush precedes its
      token; close/updater restart await safe points; export/backup cancels and
      cleans temporary output; import reaches a persisted recoverable journal
      state. Test every phase without recursive flush deadlock.
- [x] 6.8 Define rollback retention by count/age and transaction status, apply
      restrictive app-data permissions where supported, disclose the complete
      unencrypted recovery copy, and prove cleanup never removes an unfinished
      transaction's rollback.
- [x] 6.9 Add cross-process exclusion: install and configure
      `tauri-plugin-single-instance` (or an equivalent exclusive app-data lock
      acquired before recovery) so import apply, startup recovery, automatic
      backup, and retention run only in the guarded instance; record its SPDX
      license in the task 1.6 dependency report. Prove a second launch focuses
      the first instance without running recovery, and that a live journal,
      staged directory, ledger, or in-flight file is never treated as
      interrupted state by another process.

## 7. Manual library export and Merge user interface

- [x] 7.1 Add English and Spanish Paraglide messages for complete-library
      export, the unencrypted privacy notice, validation/progress/errors, Merge
      categories, document-language imported-copy suffixes, restore-by-merging
      consequences including that locally deleted content may be re-added,
      rollback-copy privacy, recovery, cancellation, and results;
      do not hardcode user-facing strings or mix UI/document locale axes.
- [x] 7.2 Add a separate Export library action and confirmation flow that
      flushes persistence, explains archive scope/privacy, opens the native save
      dialog, and reports success only after destination reopen validation;
      leave DOCX Export behavior unchanged.
- [x] 7.3 Create `LibraryImportModal.svelte` with explicit validating, invalid,
      preview, confirming, applying, recovering, success, and failure states;
      version one exposes Merge and Cancel but no replace-library operation.
- [x] 7.4 Add component tests for new/identical/conflicting preview counts,
      reference/collection/asset consequences, cancel-with-no-writes, disabled
      apply during validation, error focus/announcements, and successful
      home/library refresh. Cover UI language changes while open, UI language
      differing from imported document language, modal focus trap/restoration,
      live progress announcements, and safe/non-cancellable apply messaging.
- [x] 7.5 Wire Import library and Restore entry points to the same modal,
      validator, planner, journal, and result contracts.
- [x] 7.6 Run the Svelte MCP autofixer on every new or changed `.svelte` file
      and resolve all valid findings before committing this slice.

## 8. Narrow selected-folder authorization and settings durability

- [x] 8.1 Add a Rust backup-directory adapter with purpose-specific
      configure/test/write/list/read/reveal/revoke commands. Do not install
      global persisted-scope and do not accept arbitrary caller paths after
      configuration. Use a recursive native folder selection only during setup,
      canonicalize it, reject symlinks/reparse points and any selection that is
      or contains the application data directory, create and test the dedicated
      `Tesina Backups` subfolder before activation, and add no broad `$HOME`,
      provider, or network scope. Implement
      `apps/desktop/src-tauri/src/backup_directory.rs`, register commands in
      `lib.rs`, and make Rust exclusively own an atomic versioned
      `$APPDATA/backup-directory.json` authorization record.
- [ ] 8.2 Add native negative and restart proof on macOS and Windows: the active
      folder supports child creation/reopen/replace/list/removal after process
      restart, while its parent/sibling, an old backup folder, and manual
      import/export selections are denied. Record the exact capability diff.
- [ ] 8.3 Extend schema-version-1 `settings.json` additively with validated
      backup UI/status fields and keep authoritative path/backup-set state in
      the native record, whose presence means configured (Turn off deletes the
      record; there is no pause flag). Add a Rust-owned atomic
      `$APPDATA/backup-ledger.json` keyed by the native `backupSetId`; prove
      older settings load with backup disabled and every configuration/ledger
      file is excluded from `.tesina` archives.
- [x] 8.4 Refactor `UiSettingsStore` writes into serialized requested/persisted
      revisions with `flushPending()`, failure retry, and
      persistence-coordinator registration so close/restart cannot lose or
      reorder backup success state.
- [x] 8.5 Add tests for initial configuration, test-before-enable, rapid status
      updates, failed write retry, folder change only after a successful new
      test, and preservation of the previous configuration when the new folder
      test fails. Prove successful change/disable revokes old authority while
      leaving existing archives untouched and explaining that outcome.

## 9. Backup eligibility, retention, and failure behavior

- [x] 9.1 Add a lightweight persistence-activity subscription or adjacent
      app-lifetime revision signal; test subscribe/unsubscribe, coalescing, and
      no movement of essay data into the coordinator.
- [x] 9.2 Implement and test a content digest over sorted essay semantic
      digests, shared-library content, and reachable asset hashes; prove
      timestamps, UI settings, backup state, orphan assets, and deleted backups
      do not change it.
- [x] 9.3 Create `state/backup.svelte.ts` with injected archive/files/clock
      dependencies, a debounced eligibility check, one active run,
      local-calendar-day gating, manual override, and last-success fields
      updated only with the digest returned from the validated archived
      snapshot.
- [x] 9.4 Add scheduler tests for first changed session, no changes, a second
      change after today's success, failed attempt and next-launch retry,
      timezone day boundary, concurrent manual/automatic requests, and Back up
      now bypassing only the daily limit. Race a mutation during archive write
      and prove the later content remains eligible.
- [x] 9.5 Implement `portable/retention.ts` and tests for the exact automatic
      filename grammar (including the installation backup-set component) inside
      the `Tesina Backups` subfolder, ledger-first classification that never
      opens or parses a file the ledger does not list, matching backup-set
      identity, immediate pre-delete hash recheck, creation-time ordering, Test
      backup and Back up now counting toward seven, manual Export library and
      other-device/invalid/temp entries untouched, missing-ledger retain-all,
      prune failure as a warning rather than backup failure, and a persistent
      accumulation warning when owned archives grow well beyond seven.
- [x] 9.6 Wire selected-folder offline, moved, full, and unauthorized failures
      to stable error codes and non-blocking Retry/Choose another folder
      behavior while local autosave and editing remain functional.
- [x] 9.7 Run selected-folder operations off the UI-critical path with bounded
      unavailable/timeout/permission/full/conflict outcomes; test provider hang,
      placeholder hydration, folder replacement, and concurrent rename without
      claiming remote upload success.

## 10. Five-step wizard, home status, and Settings controls

- [x] 10.1 Create `BackupSetupWizard.svelte` with separate Why, Choose location,
      Review privacy, Test backup, and Success steps; name Google Drive, iCloud
      Drive, OneDrive, Dropbox, and ordinary folders without claiming provider
      integration or remote-upload verification. Before Test writes, show the
      exact destination, state that the complete unencrypted library is being
      copied now, and require affirmative consent.
- [x] 10.2 Add wizard tests for keyboard/focus flow, English and Spanish text,
      cancellation at every step, folder-picker cancellation, test failure and
      cleanup/retry/change-destination, success details, local-versus-provider
      status disclosure, and no configuration before validated test completion.
- [x] 10.3 Create `BackupStatusCard.svelte` for the optional/dismissible home
      card shown deterministically until dismissal and configured healthy,
      running, warning, retention-warning, and retry states without blocking
      essay actions; display next expected backup as dependent on Tesina running,
      idle eligibility, and changed content.
- [x] 10.4 Create `BackupSettings.svelte` with location, last successful time,
      next expected backup, Back up now, Restore by merging, Open backup folder,
      Change folder, Turn off/Re-enable, Retry, and setup-card preference
      controls. Disclose that folder change/disable leaves old archive files
      and that re-enabling requires authorizing a folder and passing a new test
      backup.
- [x] 10.5 Add component tests proving a started backup preserves the previous
      success time, a validated completion updates it, a failed backup remains
      eligible, Turn off revokes access without deleting files, and Restore by
      merging explains its consequences before opening the shared Merge preview.
- [x] 10.6 Integrate the backup coordinator at app lifetime after import
      recovery and normal data load; cleanly unsubscribe/finalize on layout
      destruction.
- [x] 10.7 Run the Svelte MCP autofixer on every new or changed `.svelte` file
      and resolve all valid findings before committing this slice.
- [x] 10.8 Add accessibility tests for modal semantics, focus trap/restoration,
      keyboard-only wizard/status actions, live announcements for every long
      operation and recovery state, semantic progress/status, and non-color-only
      healthy/warning indicators in both UI languages.

## 11. End-to-end recovery and cross-platform acceptance

- [x] 11.1 Add a deterministic full-library fixture with Spanish and English
      essays, collections, nested citations, same-ID conflicts, identical and
      colliding assets, and at least one figure in every supported image format.
- [ ] 11.2 Add an application-level integration test that exports the fixture,
      imports it into a non-empty destination, checks preview counts, applies
      Merge, restarts state, and proves all
      essays/citations/references/collections/assets resolve with no local
      overwrite.
- [x] 11.3 Add crash-restart E2E cases at journal fault points and prove each
      run resumes or rolls back to a consistent library without duplicates.
- [ ] 11.4 In a packaged macOS app, complete manual export/import, configure a
      real local or synced folder, restart, run Back up now, create eight dated
      test backups, verify only seven recognized backups remain, and restore
      through Merge; record paths and screenshots without exposing essay
      content.
- [ ] 11.5 Repeat native folder selection, child access, process restart without
      reprompt, negative old/transient-path checks, archive round-trip,
      retention, and restore on a packaged Windows app or native E2E job that
      actually launches the packaged app. Compilation, installer creation, and
      unit tests cannot satisfy this task; evidence must target the exact feature
      SHA before merge.
- [ ] 11.6 Verify Google Drive, iCloud Drive, OneDrive, and Dropbox wording is
      provider-neutral: Tesina proves the local selected-folder file only and
      never claims remote synchronization succeeded. Also audit every surface
      so checksums are never presented as proof of origin, authenticity, or
      encryption.
- [ ] 11.7 Manually exercise iCloud Drive and one third-party macOS File Provider
      with offline placeholder, rehydration, concurrent provider activity,
      rename conflict, timeout, and restart cases; record privacy-redacted
      outcomes without treating provider upload as a Tesina assertion.
- [ ] 11.8 Store durable privacy-redacted native evidence tied to the exact
      commit and package digest: OS/app version, scenario/result, archive
      hash/counts, restart proof, and screenshot/log attachment IDs—never essay
      content, usernames, or private folder names.

## 12. Required verification, version, and publication

- [ ] 12.1 Run focused portable/archive/import/backup unit and component suites
      after each slice, then from the repository root run `deno task check`,
      `deno task test`, `deno fmt`, and `deno lint`; require 0 Svelte
      errors/warnings and preserve unrelated snapshot/worktree changes.
- [ ] 12.2 Run `openspec validate add-portable-library-backups --strict` and
      `git diff --check`; maintain a requirement-evidence matrix mapping every
      scenario to a named automated test, durable packaged-native evidence ID,
      or explicit deferred/not-applicable justification.
- [ ] 12.3 Bump the next patch version consistently in
      `apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json`,
      `apps/desktop/src-tauri/Cargo.toml`, the Tesina package entry in
      `Cargo.lock`, both message files, README current-version statements, and
      exact release-verifier/tests. Add failing release-contract tests first and
      extend automation so every listed surface is enforced.
- [ ] 12.4 Move completed `CHANGELOG.md` items from Unreleased into a dated
      version section, advance its comparison links, and add plain-language
      English changelog notes describing behavior visible in both UI languages:
      portable library files, optional daily backups, the
      seven-version history, unencrypted privacy, and safe Merge restore without
      internal jargon.
- [ ] 12.5 Re-run the full gates after version/release-note changes, inspect the
      final diff and lockfile-derived dependency/license report, validate the
      capability schema and negative permission evidence, and commit each
      verified slice in English. Update PR CI to enforce root `deno fmt --check`
      and `deno lint`, not only package paths.
- [ ] 12.6 Follow repository PR policy: synchronize protected branches without
      closing them, target `dev` when it exists, request `@greptile review` on
      the PR commit comment, address only validated feedback, and merge only
      with required checks green.
- [ ] 12.7 After the change reaches `main`, synchronize local protected
      branches, tag the exact main commit with the matching `v` version, let the
      release workflow create the draft, verify the current macOS shipping
      contract—DMG, updater archive, `.sig`, `latest.json`, signature validity,
      matching version/notes/URLs—and publish the release so users receive the
      feature. Track Windows runtime/installer proof as a separate gate unless
      supported Windows publication is explicitly added.
- [ ] 12.8 Record final handoff evidence: change/commit/PR/version/tag, test
      counts, slice-level RED/GREEN/REFACTOR proof, Svelte autofixer result,
      durable macOS/Windows native evidence IDs, narrow-folder restart/negative
      proof, archive checksum/round-trip proof, release workflow run, public
      updater availability, clean worktree/feature disposition, exact local
      `main` equals `origin/main`, tag and published target equal that SHA, and
      `dev` parity only when that branch exists (otherwise record its absence).
- [x] 12.9 Add an operational rollback runbook: stop before draft publication on
      verification failure; after publication ship a higher patch version that
      disables entry points while retaining archive readability and startup
      recovery; preserve user `.tesina` files and unfinished journals; record
      supported journal/archive versions and prove old settings still load.

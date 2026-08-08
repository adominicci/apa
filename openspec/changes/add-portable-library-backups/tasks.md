## 1. Handoff baseline and security limits

- [ ] 1.1 Read `AGENTS.md`, this change's `proposal.md`, all three capability
      specs, `design.md`, and
      `docs/plans/2026-08-08-portable-library-backup-design.md`; confirm the
      active change is `add-portable-library-backups` and do not expand the
      deferred scope.
- [ ] 1.2 Record `git status --short --branch`, current commit, current version,
      and pre-existing worktree changes before editing; preserve unrelated files
      and use independently reviewable English commits.
- [ ] 1.3 Build representative fixtures for an empty library, a large text
      library, and a figure-heavy library; use their measured sizes to choose
      and document maximum archive bytes, entry count, single expanded entry,
      total expanded bytes, and compression ratio in
      `apps/desktop/src/lib/portable/limits.ts`.
- [ ] 1.4 Add failing tests proving the chosen limits reject oversized declared
      and observed input while accepting the representative supported fixtures.
- [ ] 1.5 Add `fflate` as a direct MIT-licensed dependency of
      `apps/desktop/package.json`, regenerate `deno.lock`, and verify no package
      imports it transitively through `@tesina/docx-export`.

## 2. Pure archive contract and deterministic bytes

- [ ] 2.1 Add failing tests for manifest version one, stable JSON ordering,
      UTF-8 encoding, SHA-256 file records, content counts, `encryption: null`,
      and forward-version rejection.
- [ ] 2.2 Implement `portable/types.ts`, `canonicalJson.ts`, and digest helpers
      with injected clock/version/UUID dependencies; keep the modules free of
      Svelte, runes, Tauri, and filesystem paths.
- [ ] 2.3 Add failing fixtures for complete content scope: multiple essays,
      document settings, references, collections, nested citations, figure
      assets, device settings, deleted backups, and an orphan asset.
- [ ] 2.4 Implement pure snapshot assembly and archive normalization so only
      valid schema-version-2 essays, schema-version-1 library content, and
      reachable assets enter `manifest.json`, `essays/`, `library.json`, and
      `assets/`.
- [ ] 2.5 Add failing round-trip and golden tests proving deterministic archive
      output when injected metadata is fixed and proving device settings,
      deleted backups, and orphan assets are absent.
- [ ] 2.6 Implement ZIP creation in `portable/archive.ts` and make every
      produced archive reopen through the validator before its bytes can be
      returned as a successful result.

## 3. Bounded untrusted archive validation

- [ ] 3.1 Add adversarial tests for malformed ZIP bytes, encrypted entries,
      absolute paths, parent/dot traversal, backslashes, NULs, duplicate
      normalized paths, unknown top-level paths, symlinks/non-regular entries,
      checksum and length mismatches, missing manifest, duplicate manifest, and
      unsupported versions.
- [ ] 3.2 Implement bounded streaming ZIP intake in `portable/archive.ts`; check
      native file size before load and enforce declared and observed counters
      before allocating or parsing expanded payloads. Do not use unbounded
      `unzipSync` on imported files.
- [ ] 3.3 Add failing JSON-shape tests for invalid manifest fields, essay schema
      versions other than 2, malformed shared-library schema, invalid reference
      and collection arrays, unsupported figure extensions, and missing
      referenced assets.
- [ ] 3.4 Implement `portable/validate.ts` with discriminated localized error
      codes and relationship validation; never write an archive entry path
      directly to disk.
- [ ] 3.5 Add mutation tests that corrupt each golden archive entry one at a
      time and prove validation fails before import planning.

## 4. Stable app-data snapshot and recoverable archive writes

- [ ] 4.1 Add tests that hold pending essay and library writes open, start a
      snapshot, and prove snapshot reading waits for
      `persistence.flushPending()` and aborts if the barrier rejects.
- [ ] 4.2 Implement `persist/librarySnapshot.ts` to enumerate persisted essays,
      read `library.json`, collect reachable figure bytes, reject invalid source
      data, and return the pure snapshot contract after the barrier.
- [ ] 4.3 Add tests for cancelled save dialogs, failed destination writes,
      existing destination preservation, temporary-file cleanup, and validation
      of the written file before success.
- [ ] 4.4 Implement `persist/portableFiles.ts` with native `.tesina` open/save
      and folder dialogs, UUID-named sibling temporary files, reopen validation,
      and recoverable replacement that preserves the previous destination until
      the new file is safely installed.
- [ ] 4.5 Create one injected `LibraryArchiveService` used by manual export,
      rollback creation, test backup, scheduled backup, and manual backup;
      prohibit duplicate packaging implementations.
- [ ] 4.6 Add a packaged-app smoke harness that exports a real current library,
      reopens it, and checks manifest counts, citations, references,
      collections, and figure bytes.

## 5. Pure Merge planning and identity remapping

- [ ] 5.1 Extend `model/essay.ts` with optional `importedAt` and `sourceEssayId`
      while retaining `schemaVersion: 2`; add load/persist/summarize regressions
      for old essays and imported copies.
- [ ] 5.2 Add semantic-hash tests proving `updatedAt`, `importedAt`, and
      `sourceEssayId` do not create false essay conflicts while title-page,
      settings, document, creation date, and reference-snapshot changes do.
- [ ] 5.3 Add failing `portable/remap.ts` tests covering citation IDs and figure
      paths inside body sections, abstracts, appendices, paragraphs, nested
      lists, tables, and any supported block container, plus
      `referencesSnapshot`.
- [ ] 5.4 Implement pure citation/reference/collection/asset remappers and prove
      they never mutate a pre-existing local essay object.
- [ ] 5.5 Add import-plan matrix tests for new essays, same-title/different-ID
      essays, semantically identical same-ID essays, conflicting same-ID essays,
      identical/conflicting references, identical/conflicting collections,
      same-byte assets, and path-colliding different-byte assets.
- [ ] 5.6 Implement `portable/importPlan.ts` with injected transaction/UUID/time
      dependencies, stable operation IDs, localized imported-copy labels
      supplied by the caller, and explicit preview/result counts.
- [ ] 5.7 Add final pure consistency checks proving every planned citation,
      snapshot reference, collection membership, and figure path resolves after
      the plan is applied to an in-memory fixture.

## 6. Journaled import, rollback, and startup recovery

- [ ] 6.1 Define and test a versioned import-journal schema containing
      transaction ID, archive hash, rollback path/hash, staged/final operations,
      per-operation completion, and terminal status.
- [ ] 6.2 Add fault-injection tests for failure before the journal, after each
      asset/essay move, before and after `library.json` replacement, during
      final consistency validation, and during staging cleanup.
- [ ] 6.3 Implement `persist/importJournal.ts` to stage under
      `$APPDATA/imports/<transaction>/`, validate a full rollback archive under
      `$APPDATA/backups/imports/`, persist the journal before live writes, and
      apply only additive unused essay/asset paths plus one atomic library
      replacement.
- [ ] 6.4 Implement idempotent resume that verifies staged/final hashes and
      skips completed stable operation IDs without producing duplicate essays,
      references, collections, or assets.
- [ ] 6.5 Implement rollback that restores the previous library and removes only
      new final paths listed by the journal; never delete an unlisted or
      pre-existing path.
- [ ] 6.6 Add startup recovery before normal essay/library interactivity: resume
      a valid transaction, otherwise restore the validated rollback, surface a
      localized recovery result, and start backup eligibility only afterward.
- [ ] 6.7 Register import/export/backup finalization with the app persistence
      barrier so close and updater restart wait until an operation is either
      complete or durably journaled and recoverable.

## 7. Manual library export and Merge user interface

- [ ] 7.1 Add English and Spanish Paraglide messages for complete-library
      export, the unencrypted privacy notice, validation/progress/errors, Merge
      categories, imported-copy suffixes, recovery, cancellation, and results;
      do not hardcode user-facing strings.
- [ ] 7.2 Add a separate Export library action and confirmation flow that
      flushes persistence, explains archive scope/privacy, opens the native save
      dialog, and reports success only after destination reopen validation;
      leave DOCX Export behavior unchanged.
- [ ] 7.3 Create `LibraryImportModal.svelte` with explicit validating, invalid,
      preview, confirming, applying, recovering, success, and failure states;
      version one exposes Merge and Cancel but no replace-library operation.
- [ ] 7.4 Add component tests for new/identical/conflicting preview counts,
      reference/collection/asset consequences, cancel-with-no-writes, disabled
      apply during validation, error focus/announcements, and successful
      home/library refresh.
- [ ] 7.5 Wire Import library and Restore entry points to the same modal,
      validator, planner, journal, and result contracts.
- [ ] 7.6 Run the Svelte MCP autofixer on every new or changed `.svelte` file
      and resolve all valid findings before committing this slice.

## 8. Persisted selected-folder authorization and settings durability

- [ ] 8.1 Add the official Tauri persisted-scope plugin to Cargo dependencies
      and initialize it immediately after `tauri-plugin-fs`; update generated
      lock data and the minimum capability permissions without adding broad
      `$HOME`, provider, or network scopes.
- [ ] 8.2 Add native integration proof that a folder selected through the dialog
      can be written, the packaged app can restart, and the same folder remains
      authorized on macOS and Windows.
- [ ] 8.3 Extend schema-version-1 `settings.json` additively with validated
      `BackupSettings`; prove older settings load with backup disabled and
      backup configuration is excluded from `.tesina` archives.
- [ ] 8.4 Refactor `UiSettingsStore` writes into serialized requested/persisted
      revisions with `flushPending()`, failure retry, and
      persistence-coordinator registration so close/restart cannot lose or
      reorder backup success state.
- [ ] 8.5 Add tests for initial configuration, test-before-enable, rapid status
      updates, failed write retry, folder change only after a successful new
      test, and preservation of the previous configuration when the new folder
      test fails.

## 9. Backup eligibility, retention, and failure behavior

- [ ] 9.1 Add a lightweight persistence-activity subscription or adjacent
      app-lifetime revision signal; test subscribe/unsubscribe, coalescing, and
      no movement of essay data into the coordinator.
- [ ] 9.2 Implement and test a content digest over sorted essay semantic
      digests, shared-library content, and reachable asset hashes; prove
      timestamps, UI settings, backup state, orphan assets, and deleted backups
      do not change it.
- [ ] 9.3 Create `state/backup.svelte.ts` with injected archive/files/clock
      dependencies, a debounced eligibility check, one active run,
      local-calendar-day gating, manual override, and last-success fields
      updated only after validated completion.
- [ ] 9.4 Add scheduler tests for first changed session, no changes, a second
      change after today's success, failed attempt and next-launch retry,
      timezone day boundary, concurrent manual/automatic requests, and Back up
      now bypassing only the daily limit.
- [ ] 9.5 Implement `portable/retention.ts` and tests for the exact automatic
      filename grammar, valid-manifest classification, creation-time ordering,
      seven retained files, unrelated/invalid/manual/temp entries untouched, and
      prune failure as a warning rather than backup failure.
- [ ] 9.6 Wire selected-folder offline, moved, full, and unauthorized failures
      to stable error codes and non-blocking Retry/Choose another folder
      behavior while local autosave and editing remain functional.

## 10. Five-step wizard, home status, and Settings controls

- [ ] 10.1 Create `BackupSetupWizard.svelte` with separate Why, Choose location,
      Review privacy, Test backup, and Success steps; name Google Drive, iCloud
      Drive, OneDrive, Dropbox, and ordinary folders without claiming provider
      integration or remote-upload verification.
- [ ] 10.2 Add wizard tests for keyboard/focus flow, English and Spanish text,
      cancellation at every step, folder-picker cancellation, test failure and
      retry, success details, and no configuration before validated test
      completion.
- [ ] 10.3 Create `BackupStatusCard.svelte` for the optional/dismissible home
      card and configured healthy, running, warning, and retry states without
      blocking essay actions.
- [ ] 10.4 Create `BackupSettings.svelte` with location, last successful time,
      Back up now, Restore, Open backup folder, Change folder, Retry, and
      setup-card preference controls.
- [ ] 10.5 Add component tests proving a started backup preserves the previous
      success time, a validated completion updates it, a failed backup remains
      eligible, and Restore opens the shared Merge preview.
- [ ] 10.6 Integrate the backup coordinator at app lifetime after import
      recovery and normal data load; cleanly unsubscribe/finalize on layout
      destruction.
- [ ] 10.7 Run the Svelte MCP autofixer on every new or changed `.svelte` file
      and resolve all valid findings before committing this slice.

## 11. End-to-end recovery and cross-platform acceptance

- [ ] 11.1 Add a deterministic full-library fixture with Spanish and English
      essays, collections, nested citations, same-ID conflicts, identical and
      colliding assets, and at least one figure in every supported image format.
- [ ] 11.2 Add an application-level integration test that exports the fixture,
      imports it into a non-empty destination, checks preview counts, applies
      Merge, restarts state, and proves all
      essays/citations/references/collections/assets resolve with no local
      overwrite.
- [ ] 11.3 Add crash-restart E2E cases at journal fault points and prove each
      run resumes or rolls back to a consistent library without duplicates.
- [ ] 11.4 In a packaged macOS app, complete manual export/import, configure a
      real local or synced folder, restart, run Back up now, create eight dated
      test backups, verify only seven recognized backups remain, and restore
      through Merge; record paths and screenshots without exposing essay
      content.
- [ ] 11.5 Repeat the native filesystem-scope, archive round-trip, retention,
      and restore acceptance on a packaged Windows app or CI runner; do not mark
      the task complete from unit tests alone.
- [ ] 11.6 Verify Google Drive, iCloud Drive, OneDrive, and Dropbox wording is
      provider-neutral: Tesina proves the local selected-folder file only and
      never claims remote synchronization succeeded.

## 12. Required verification, version, and publication

- [ ] 12.1 Run focused portable/archive/import/backup unit and component suites
      after each slice, then from the repository root run `deno task check`,
      `deno task test`, `deno fmt`, and `deno lint`; require 0 Svelte
      errors/warnings and preserve unrelated snapshot/worktree changes.
- [ ] 12.2 Run `openspec validate add-portable-library-backups --strict` and
      `git diff --check`; confirm every requirement scenario has direct
      automated or explicitly recorded packaged-native evidence.
- [ ] 12.3 Bump the next patch version consistently in
      `apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json`,
      `apps/desktop/src-tauri/Cargo.toml`, the Tesina package entry in
      `Cargo.lock`, both message files, README current-version statements, and
      any release verification fixtures.
- [ ] 12.4 Move completed `CHANGELOG.md` items from Unreleased into a dated
      version section with plain-English English/Spanish-visible release notes
      that explain portable library files, optional daily backups, the
      seven-version history, unencrypted privacy, and safe Merge restore without
      internal jargon.
- [ ] 12.5 Re-run the full gates after version/release-note changes, inspect the
      final diff for scope and licensing, and commit each verified slice in
      English.
- [ ] 12.6 Follow repository PR policy: synchronize protected branches without
      closing them, target `dev` when it exists, request `@greptile review` on
      the PR commit comment, address only validated feedback, and merge only
      with required checks green.
- [ ] 12.7 After the change reaches `main`, synchronize local protected
      branches, tag the exact main commit with the matching `v` version, let the
      release workflow create the draft, verify updater
      manifest/signature/archive/DMG or Windows artifacts, and publish the
      release so users receive the feature.
- [ ] 12.8 Record final handoff evidence: change/commit/PR/version/tag, test
      counts, Svelte autofixer result, macOS and Windows native paths,
      persisted-scope restart proof, archive checksum/round-trip proof, release
      workflow run, public updater availability, and exact `main...origin/main`
      and `dev...origin/dev` parity.

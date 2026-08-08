## Why

Tesina stores essays, references, and figures safely on one device, but users
cannot yet move or restore their complete library as one dependable unit. A
portable, provider-neutral archive is needed now to protect user ownership and
enable cloud-folder backups without introducing accounts, hosted storage, or a
SQLite migration.

## What Changes

- Add a versioned `.tesina` complete-library archive containing essays, document
  metadata, references, collections, and figure assets, with a checksummed
  manifest and strict validation.
- Add safe full-library import through a read-only Merge preview. New content is
  added, identical content is skipped, and conflicting content is preserved as
  remapped imported copies rather than overwriting local data.
- Add a validated local rollback archive and resumable import journal so an
  interrupted import cannot silently corrupt the library.
- Add an optional bilingual setup wizard for daily backups to a user-selected
  Google Drive, iCloud Drive, OneDrive, Dropbox, or ordinary folder.
- Add Back up now, Merge-based restore, status, retry, turn off/re-enable
  (re-enabling requires authorizing a folder and passing a new test backup),
  folder-change, and open-folder actions, with seven-version retention
  restricted to backups proven to belong to this Tesina installation.
- Preserve the existing JSON-plus-assets working storage. Device preferences,
  deleted-essay backups, password encryption, provider APIs, accounts, live
  multi-device sync, and SQLite are outside this change.

## Capabilities

### New Capabilities

- `portable-library-archive`: Complete-library `.tesina` export format, manifest
  integrity, content scope, validation, and safe destination writes.
- `library-merge-import`: Previewed, lossless library merge with deterministic
  identity mapping, rollback protection, and interrupted-import recovery.
- `automatic-library-backups`: User-guided cloud-folder setup, changed-content
  daily backup scheduling, observable status and recovery actions, and safe
  seven-version retention.

### Modified Capabilities

None.

## Impact

- Adds pure TypeScript archive, validation, import-planning, remapping, and
  retention modules under the desktop application library.
- Adds a narrow native Tauri backup-directory adapter that persists exactly one
  configured folder authorization while leaving ordinary import/export dialog
  grants temporary; also adds recoverable temporary output, rollback archives,
  and import journals.
- Adds cross-process exclusion (single running instance or an equivalent
  exclusive lock) so import apply, startup recovery, automatic backup, and
  retention never run in two Tesina processes at once.
- Adds Svelte wizard, Merge preview, home status card, and Settings controls;
  all user-facing text requires English and Spanish Paraglide messages.
- Extends persistence coordination with an exclusive snapshot lease so export
  and backup operate on one immutable essay/reference/asset revision.
- May add a ZIP dependency only if the existing dependency set cannot provide
  safe browser/Tauri byte generation and extraction; any dependency must comply
  with the repository license policy.
- Requires deterministic fixtures, unit/component/native integration coverage, a
  packaged-app export/restore smoke test, a patch version bump, plain-English
  release notes, and publication through the existing Tesina updater workflow.

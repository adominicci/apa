# Portable Library and Cloud-Folder Backup Design

**Date:** 2026-08-08
**Status:** Approved design
**Scope:** Complete-library export, merge import, and optional automatic backup
to a user-selected folder

## Goal

Give users a dependable way to move, back up, and restore their complete Tesina
library without requiring an account or replacing Tesina's local-first storage.
The same portable data contract should support manual files today and optional
cloud-folder backup later.

## Approved product decisions

- Keep the existing JSON-plus-assets working storage. Do not add SQLite now.
- Export the complete content library only: essays, title-page data, document
  settings, references, collections, and figure assets.
- Exclude device preferences such as interface language, theme, and toolbar
  position.
- Use Merge as the only version-one import behavior. Never silently replace the
  existing library.
- When the same essay ID has different content, retain both copies. Give the
  imported copy a new ID and an "imported copy" title suffix.
- Keep version-one archives unencrypted. Clearly explain that they contain the
  user's complete library, and reserve encryption metadata in the manifest for
  a future format revision.
- Make the first cloud step automatic backup to a user-selected folder. This
  supports Google Drive, iCloud Drive, OneDrive, Dropbox, or any ordinary
  folder without provider APIs or a Tesina account.
- Run at most one automatic backup per day and only when content changed since
  the last successful backup. Also provide "Back up now."
- Retain the seven newest valid daily backups inside a dedicated
  `Tesina Backups` folder. Prove ownership with an installation backup-set ID
  and successful-write ledger; never infer ownership from filename or delete
  another device's or unrelated files.
- Offer backup setup through an optional home-screen card and Settings. It must
  never block writing.
- Let users turn automatic backup off and re-enable it. Revoking a folder stops
  future access but never deletes existing archives.

## Archive architecture

Tesina continues using its existing JSON files and separate image assets as
live working storage. A `.tesina` file is a ZIP-based, versioned archive:

```text
manifest.json
essays/<essay-id>.json
assets/<asset-id>.<extension>
library.json
```

`manifest.json` records the archive format version, producing Tesina version,
creation time, content counts, and a checksum for every included file. It also
reserves optional encryption metadata without enabling encryption in version
one. Deleted-essay backups and device preferences are not included.

Before export, Tesina takes an exclusive snapshot lease, flushes pending essay
and reference-library saves, and stages one immutable revision of every required
JSON file and reachable asset. A concurrent mutation is queued or forces a full
retry; mixed revisions are forbidden. Tesina builds from staging, validates the
completed archive against its manifest, and only then writes the selected
destination through a restart-recoverable replacement. A failed export must not
modify live data or leave a file that appears complete.

Import reverses that path. Tesina opens the archive in temporary storage,
validates its format, rejects unsafe paths and unsupported versions, verifies
every checksum, parses every JSON document, and confirms that every referenced
asset exists. It must enforce declared and uncompressed resource limits so a
malformed archive cannot exhaust the device. Validation completes before any
live data changes. Validation also bounds JSON complexity, canonicalizes every
identifier used for a local path, and limits decoded image dimensions/frames.
Checksums detect corruption but do not authenticate the file's author.

## Merge planning and identity

After validation, Tesina builds a read-only import plan and presents a preview:

- New essays will be added.
- Identical essays will be skipped.
- Same-ID essays with different content will be retained as imported copies.
- References and collections being added or remapped will be summarized.
- Duplicate figure assets will be reused.

Identity uses stable IDs and content checksums, not titles. Two unrelated essays
may have the same title without being treated as duplicates.

When a conflicting essay is copied, Tesina assigns it a new ID and appends an
"imported copy" suffix to its title. The original creation date remains
available, while import time is recorded separately.

Identical reference IDs with identical content are reused. If the same
reference ID has different content, Tesina creates a new imported reference ID
and rewrites citations inside imported essays to that ID. Imported collection
membership follows the same mapping.

Assets are compared by checksum. Identical bytes are reused even when filenames
differ. Different assets never overwrite each other; imported essay paths are
rewritten when needed.

## Import recovery

Before applying an approved plan, Tesina creates and validates a complete local
rollback archive. The merge uses an import journal with stable operation IDs.
Each operation is atomic and repeatable.

If Tesina closes or crashes during import, the next launch detects the unfinished
journal and safely finishes the remaining operations or restores the rollback
archive. Tesina marks the import complete only after a final consistency check
passes for every essay, reference, collection, citation, and asset. The rollback
archive remains available as a recent recovery point under a bounded retention
policy. If neither resume nor rollback is safe, Tesina fails closed into a
recovery-required screen and never guesses which files to delete.

## Backup wizard

Backup setup appears as an optional home-screen card and remains available in
Settings. Every screen follows the current interface language.

1. **Why back up?** Explain that essays remain on the device and this creates an
   additional safety copy.
2. **Choose a location.** Explicitly name Google Drive, iCloud Drive, OneDrive,
   Dropbox, and ordinary folders, then open the native folder picker.
3. **Review privacy.** Show what is included and explain that version-one
   archives are not password-protected.
4. **Test backup.** Create a real archive inside `Tesina Backups`, validate it,
   and verify that Tesina can reopen it. Before writing, show the exact location,
   explain that the complete unencrypted library is being copied now, and ask
   for explicit confirmation.
5. **Success.** Show the location, last successful backup, next expected backup,
   and actions for "Back up now," "Restore by merging," "Open backup folder,"
   and "Turn off." State that Tesina validated the local file but cannot confirm
   whether a provider uploaded it.

After setup, Tesina writes at most one automatic backup per day and only if the
content revision changed. A missed backup retries the next time Tesina runs.
The interface shows the last successful time; starting a write is not success.

If the folder is offline, moved, or no longer permitted, editing continues. A
non-blocking home-screen warning offers "Try again" and "Choose another folder."
Tesina never reports success until the archive is written and validated.

Restore opens the same Merge preview used by manual import and explicitly
explains that it preserves newer work and may create imported copies. It never
silently replaces or rolls back the local library.

## Components

### Pure TypeScript archive layer

This layer receives bytes and structured data and never imports Tauri or Svelte
code. It owns:

- manifest types and format migrations;
- checksum generation and validation;
- archive construction and validation;
- import-plan generation;
- essay, reference, collection, citation, and asset remapping;
- backup retention decisions.

### Tauri filesystem adapter

This narrow adapter owns:

- native file and folder dialogs;
- reading and writing selected locations;
- temporary files and atomic replacement;
- a purpose-specific Rust adapter that remembers exactly one authorized backup
  folder while manual import/export selections remain temporary;
- opening the backup folder;
- import-journal and rollback-archive management.

### Svelte user interface and coordinator

Svelte components provide the bilingual export/import flow, Merge preview,
backup wizard, home status card, and Settings controls. A backup coordinator
tracks content revisions, last successful backup, retry state, and retention.

## Verification

Pure and integration tests must cover:

- deterministic export/import round trips;
- malformed ZIP data and unsafe archive paths;
- unsupported format versions and incorrect checksums;
- declared and expanded-size limits;
- missing or undecodable assets;
- duplicate and conflicting essay IDs;
- reference, collection, citation, and asset remapping;
- asset deduplication;
- interrupted import, journal recovery, and rollback;
- unavailable, moved, or unauthorized backup folders;
- daily scheduling and seven-version retention boundaries;
- cross-device shared-folder retention ownership;
- canonical-ID/path containment and structured/image resource limits;
- folder authorization after restart plus denial of old/transient paths.

Golden fixtures prove deterministic archives. Component tests cover every wizard
step, preview decision, success state, and error message. Native end-to-end tests
exercise real save and folder dialogs and reopen an exported library containing
figures and citations on macOS and Windows.

The change is complete only when the standard Tesina checks pass, every changed
Svelte file passes the Svelte autofixer, a packaged app completes a real export
and restore, and the next version is published with plain-English release notes.

## Deferred work

- Individual or selected-essay archives
- Password-protected archives
- Provider-specific cloud APIs
- Tesina accounts or hosted storage
- Live multi-device synchronization and conflict resolution
- SQLite storage, to be reconsidered only when revision history, incremental
  sync, or library scale justifies the migration

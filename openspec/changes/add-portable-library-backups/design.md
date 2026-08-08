## Context

See `proposal.md` for motivation and scope. Tesina v0.1.1 currently stores one
schema-version-2 essay per `$APPDATA/essays/<uuid>.json`, shared references and
collections in `$APPDATA/library.json`, figure bytes in
`$APPDATA/essays/assets/`, and UI/device preferences in
`$APPDATA/settings.json`.

The important current ownership points are:

- `apps/desktop/src/lib/persist/atomic.ts`: app-data path resolution and
  temporary-file-plus-rename JSON writes.
- `apps/desktop/src/lib/persist/assets.ts`: figure import and byte reads.
- `apps/desktop/src/lib/persist/coordinator.ts`: close/restart persistence
  barrier.
- `apps/desktop/src/lib/state/essays.svelte.ts`: essay scan/load/persist and
  delete-time JSON backup.
- `apps/desktop/src/lib/state/library.svelte.ts`: debounced serialized shared
  library persistence.
- `apps/desktop/src/lib/state/uiLocale.svelte.ts`: additive schema-version-1
  device settings.
- `apps/desktop/src/lib/components/EssayHome.svelte` and `+page.svelte`: home
  and app-level navigation ownership.
- `apps/desktop/src/routes/+layout.svelte`: app-lifetime persistence
  registration; the safe native close handler itself lives in
  `apps/desktop/src/lib/persist/windowClose.ts`, and
  `state/updater.svelte.ts` is a second existing flush-barrier consumer.
- Essay create/duplicate/persist/delete (`state/essays.svelte.ts`) and figure
  imports (`persist/assets.ts`) call the atomic writers directly today without
  passing through `PersistenceCoordinator`; the snapshot lease work MUST route
  or gate every one of these direct-write paths, not only coordinator-registered
  flushers.

Current writes are intentionally limited to app data except for paths granted by
native dialogs. Scheduled backups need one selected external folder after
restart. Tauri's persisted-scope plugin cannot provide that boundary: it saves
the entire runtime filesystem scope, including ordinary import/export dialog
paths and old folder selections. This design therefore uses a purpose-specific
native backup-directory adapter and does not install global persisted-scope or
broaden the static capability to home/cloud-provider directories.

The desktop app does not directly depend on a ZIP library. `fflate` 0.8.x is
already locked through `packages/docx-export` and is MIT-licensed, but its public
streaming API does not expose every central-directory attribute this validator
needs. The implementation begins with a bounded-parser feasibility spike and
then adds the selected ZIP dependency directly; it must never import a
transitive implementation through the DOCX package or use unbounded `unzipSync`
on untrusted archives.

## Goals / Non-Goals

**Goals:**

- Keep the archive contract and Merge planner pure, deterministic, and runnable
  under Vitest/Deno without Tauri or Svelte.
- Make all external writes recoverable and all imports additive or remapped;
  never overwrite an existing essay or asset during Merge.
- Persist the minimum selected-folder authorization required for daily backups.
- Give a new implementation agent explicit module boundaries, ordering, test
  seams, and release gates.

**Non-Goals:**

- No SQLite, provider SDK, network upload, account, collaboration, live sync,
  password encryption, selected-essay archive, or replace-library flow.
- No essay schema-version bump. New import provenance fields are optional and
  additive under schema version 2.
- No cleanup of existing orphan assets or deleted-essay backups outside the
  explicit archive and retention behavior.

## Decisions

### 1. Use one versioned ZIP container with a strict manifest

The extension is `.tesina`; the container entries are:

```text
manifest.json
essays/<essay-id>.json
assets/<asset-id>.<extension>
library.json
```

The version-one manifest is conceptually:

```ts
interface LibraryArchiveManifestV1 {
  kind: "tesina-library";
  formatVersion: 1;
  createdAt: string;
  appVersion: string;
  encryption: null;
  backup?: {
    backupSetId: string;
  };
  counts: {
    essays: number;
    references: number;
    collections: number;
    assets: number;
  };
  files: Array<{
    path: string;
    mediaType: string;
    byteLength: number;
    sha256: string;
  }>;
}
```

Use UTF-8 JSON with stable key ordering and no platform path separators.
`manifest.json` describes every other entry and is not self-checksummed. Use Web
Crypto SHA-256. Checksums are internal consistency/corruption checks, not proof
of origin or authenticity. Entry paths follow an exact ASCII lowercase grammar:
`manifest.json`, `library.json`, `essays/<uuid>.json`, and
`assets/<uuid>.<ext>` with `<uuid>` a canonical lowercase UUID and `<ext>` one
to five lowercase ASCII letters/digits; after the grammar check, entry names
are compared byte-wise, which removes Unicode-normalization and
case-folding collision channels on APFS/NTFS. Normalize archive paths before
duplicate/path-safety checks. `backup` is absent for manual exports and present only when the archive
belongs to a configured installation backup set.

Figure nodes are normalized to `assets/...` paths in archive essay JSON. Import
rewrites them to collision-free `essays/assets/...` app-data paths. Only assets
reachable by a valid essay are exported.

Alternative rejected: copy the app-data directory verbatim. It would leak device
settings/backups, preserve orphan data, and prevent strict versioning.

### 2. Create an immutable staged snapshot under an exclusive lease

Extend persistence coordination with an exclusive snapshot/maintenance lease
shared by manual export, backup, rollback capture, import apply, and retention.
Under the lease, flush pending writes, record the persistence generation, and
stage the persisted essay files, library file, and reachable assets into an
immutable snapshot buffer (an in-memory staging buffer or a UUID-named
app-data staging directory — the observable contract is identical: one
persisted revision, packaged exactly as captured). Queue later persistence
writes until the copy completes, or detect a generation change and
discard/retry the entire capture; the direct write paths named in Context bump
the generation so their mutations are always detected. Release the lease only
after the staged snapshot is immutable. Package only from staging, never from
a second pass over live app-data files.

The snapshot validates every source essay as schema version 2 and the library as
schema version 1 before packaging. Invalid source content fails the complete
export with an error that identifies the offending file and offers recovery
guidance; it is never silently skipped, and the failure surface must make a
persistently failing backup diagnosable rather than a bare error code. `LibraryArchiveService` returns the
content digest of the exact staged snapshot whose archive validated so a later
live edit can never be recorded as already backed up.

The archive builder accepts injected `now`, `appVersion`, UUID, and digest
dependencies for deterministic fixtures. Production adapters supply real values.

Alternative rejected: serialize current UI stores directly. Not every essay is
loaded, concurrent debounce writes could race, and app-lifetime backup must work
outside the editor.

### 3. Split pure archive/plan logic from filesystem adapters

Create these pure modules under `apps/desktop/src/lib/portable/`:

- `types.ts`: manifest, validated archive, snapshot, plan, and result contracts.
- `canonicalJson.ts`: stable JSON bytes and semantic hashes.
- `archive.ts`: deterministic ZIP build/read orchestration over injected byte
  inputs after bounded native intake.
- `validate.ts`: manifest/path/size/checksum/schema/relationship validation.
- `snapshot.ts`: pure assembly checks over already-read data.
- `remap.ts`: ProseMirror figure and citation ID/path walkers.
- `importPlan.ts`: deterministic Merge plan and operation IDs.
- `retention.ts`: pure recognized-file classification and prune selection.
- colocated `*.test.ts` files and deterministic fixtures under
  `portable/fixtures/`.

Create Tauri-aware adapters under `apps/desktop/src/lib/persist/`:

- `librarySnapshot.ts`: flush barrier plus app-data file enumeration/reads.
- `portableFiles.ts`: native open/save dialogs, compressed-size preflight,
  temporary archive writes, and recoverable destination replacement.
- Rust backup-directory commands: configure/test exactly one selected folder,
  restore only that authorization at startup, list/read/write/reveal retained
  backups, revoke old/disabled authorization, and reject arbitrary paths.
- `importJournal.ts`: staged transaction, restart-recoverable journal, rollback archive,
  idempotent apply, resume, and rollback.

Pure modules MUST NOT import runes, Svelte, Tauri, or app-data paths.

Alternative rejected: a single Svelte store that reads ZIP and writes files. It
would make malformed-input and crash-recovery behavior hard to test.

### 4. Bound all untrusted archive work

Define constants in `portable/limits.ts` for maximum archive bytes, entry count,
single expanded entry, total expanded bytes, compression ratio, JSON nesting,
object/array/node/string counts, content-entity counts, figure counts, image
dimensions/frames, and cumulative decoded pixels. Pick concrete values during
the first implementation task from realistic large-library fixtures and
document why they exceed expected use while bounding memory.

Read the native file's size before loading it. `fflate` alone cannot expose all
central-directory attributes required to recognize encrypted, symlink, and
non-regular entries, so implementation MUST first select and test either a
bounded central-directory parser plus streaming inflater or a native ZIP crate
that exposes those fields. This feasibility spike precedes dependency lock-in.
The bounded TypeScript parser is the preferred outcome because it keeps limit
enforcement in `portable/limits.ts` and validation pure/Vitest-testable; a
native ZIP crate is acceptable only if bounded intake and every limit are
implemented and adversarially tested on the Rust side with equivalent coverage,
and the spike must record which of the two architectures was chosen and why.
During streaming extraction, reject unknown entries, encrypted entries,
duplicate normalized paths, absolute paths, backslashes, NULs, dot segments,
symlinks/non-regular entries, unsupported compression, and any observed counter
crossing a limit. Declared sizes are preflight hints; observed emitted bytes are
authoritative. Parse bounded JSON only after byte/checksum checks pass. Verify
image signatures, media types, dimensions, and frame/pixel limits before use.
Never write extracted paths or paths derived from unvalidated payload IDs.

All essay, reference, collection, asset, transaction, and operation IDs are
canonical lowercase UUIDs with bounded lengths. `essays/<uuid>.json` must match
payload `essay.id`. Typed native path constructors perform a final canonical
containment check beneath the expected root and reject symlinks/reparse points.

Alternative rejected: `unzipSync` followed by validation. A compression bomb
could allocate excessive memory before validation runs.

### 5. Define semantic identity separately from persistence timestamps

For a same-ID essay comparison, canonicalize these semantic fields:

- `schemaVersion`, `id`, `createdAt`, `settings`, `titlePage`, `content`, and
  `referencesSnapshot`;
- exclude `updatedAt`, `importedAt`, and `sourceEssayId`.

Extend `Essay` additively with optional `importedAt?: string` and
`sourceEssayId?: string`; keep `schemaVersion: 2`. A conflicting imported essay
gets a new UUID, the original ID in `sourceEssayId`, the current import time,
and an imported-copy title suffix localized using the imported essay's document
language. Explanatory preview text continues to follow the current UI language.

Reference equality uses canonical full reference content including ID.
Collection equality uses ID, name, and a sorted unique member-ID list. For
different same-ID content, allocate new IDs, then run one mapping pass over
imported citation attrs, reference snapshots, and collection member IDs. Never
rewrite a pre-existing local essay.

Asset equality requires both SHA-256 equality and byte equality. Build a local
checksum index once per import, resolve the checksum-to-local-path plan, and
normalize imported figure paths to those planned targets before semantic essay
comparison. Reuse exact bytes; otherwise allocate a new UUID path with the
validated image extension.

Alternative rejected: newest-timestamp-wins. Timestamps do not prove which paper
or reference content the user intends to preserve.

### 6. Make Merge additive and journal only the mutable boundary

The Merge plan is computed under the snapshot lease from the flushed persisted
revision, and apply re-verifies at its start that the live library revision
still equals the plan-time revision; the merged `library.json` written in step 7
is built from the revision current at apply. On a mismatch the import replans
(re-presenting the preview when counts change) or aborts without writing —
never overwrite a newer library state with a merge computed from stale data.

The planner emits stable operations from an injected transaction ID:

1. stage new asset bytes under `$APPDATA/imports/<transaction>/stage/`;
2. stage new/remapped essay JSON;
3. write a validated rollback `.tesina` archive under
   `$APPDATA/backups/imports/`;
4. persist two independently validated journal/operation-manifest copies before
   the first live write;
5. move new assets to unused final paths;
6. move new essays to unused final paths;
7. atomically replace only `library.json` with the merged library;
8. rescan and validate all imported relationships;
9. mark complete and remove staging, retaining the rollback archive.

No existing essay or asset path is overwritten. Consequently, a partial apply
can be retried idempotently; rollback restores `library.json` and removes only
new paths whose current hash, length, type, and pre-write absence match the
journal. Mismatched paths are preserved and force manual recovery. On app
startup, recovery runs before the essay index/library becomes interactive.
Resume when a journal copy and staged hashes are valid; otherwise restore the
validated rollback and remove only additions proven by expected bytes. If
neither resume nor rollback is safe, fail closed into a localized recovery UI,
preserve evidence, and never guess which paths to delete.

The supported interruption contract covers normal close, updater restart, and
process crash after a journal/marker was closed and reopened successfully. It
does not promise survival of sudden power loss unless native file and parent
directory synchronization is added and separately verified on each platform.

Keep every rollback for an unfinished transaction. For completed transactions,
retain a small documented count/age window and delete only validated rollback
archives recorded by the transaction ledger. The import confirmation discloses
that this app-data recovery copy is complete and unencrypted. Apply restrictive
local file permissions where supported.

Alternative rejected: rename the entire app-data directory. Settings, updater
state, and unrelated backups share that root, and cross-platform directory
replacement is unnecessarily risky.

### 7. Reuse one export service for manual files, rollback, and backup

Create an app-level `LibraryArchiveService` interface with operations to capture
a snapshot, build/validate bytes, write a manual export, create an app-data
rollback, and write a selected-folder backup. Manual export and automatic backup
must not implement separate packaging rules.

For a selected destination, write a UUID-named sibling temporary file, close and
validate it by reopening, and prefer a direct same-filesystem replacement rename
that leaves the previous destination untouched on failure. Automatic-backup
destinations are always new files: create the final name exclusively
(no-replace rename or equivalent) and, on collision, choose a different unused
name instead of replacing — a second installation sharing the synced folder may
own the colliding file. Replacement semantics apply only when the user
explicitly overwrites an existing manual-export destination. If platform behavior
requires a multi-rename fallback, persist a sibling replacement record with
destination/temp/previous paths and hashes before the first rename, recover it
on the next folder access, and retain the prior file until the new destination
reopens and validates. Clean only operation-owned temp files.

The user-facing guarantee is “closed, locally visible, reopened, and validated.”
Do not call it power-loss durable unless native file and containing-directory
sync semantics are implemented and accepted separately on macOS and Windows.

### 8. Persist exactly one selected backup directory through native commands

Do not install `tauri-plugin-persisted-scope`: it serializes the entire fs scope
and would persist transient manual import/export selections. Add a Rust-owned
backup-directory adapter with purpose-specific commands. Setup receives a path
only from the native recursive folder picker, canonicalizes it, rejects
symlinks/reparse points and any selection that is or contains the application
data directory, creates/tests the dedicated `Tesina Backups` subfolder, and
stores the active path only after a real archive succeeds. After restart, Rust loads that one path
from validated app-data settings and authorizes only the operations exposed by
the adapter. Ordinary file-dialog grants remain session-only.

Backup commands do not accept arbitrary caller paths after setup. Changing
folders atomically tests and activates the new path, then revokes the old
runtime authorization; disabling backup revokes the active authorization.
Before every operation, re-resolve the directory identity and ensure every
candidate remains beneath the approved canonical root. Do not add `$HOME/**/*`,
cloud-provider-specific static paths, or new network permissions.

Implement the commands in `apps/desktop/src-tauri/src/backup_directory.rs` and
register them in `lib.rs`. Rust exclusively owns an atomic
`$APPDATA/backup-directory.json` authorization record so the Svelte settings
writer never races a native writer:

```ts
interface BackupDirectoryConfigV1 {
  schemaVersion: 1;
  canonicalFolderPath: string;
  backupSetId: string;
}
```

The presence of a validated record means backup is configured; there is no
separate `enabled` flag and no pause state. Turn off deletes the record and
revokes the runtime authorization while leaving archive bytes untouched;
re-enabling always runs the wizard again with a newly authorized folder and a
new successful test backup, matching the capability spec.

Store only UI/status state additively in `settings.json` schema version 1:

```ts
interface BackupSettings {
  configuredAt: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastSuccessContentDigest?: string;
  lastErrorCode?: string;
  setupCardDismissed?: boolean;
}
```

Neither native authorization nor `BackupSettings` is exported. The UI obtains
enabled/location state through the native adapter rather than treating its
status cache as authority. A new random `backupSetId` identifies files this
installation may later prune. A new folder becomes active only after its real
test archive validates. Changing or disabling folders leaves old archive bytes
untouched and tells the user they must manage those files manually.

The current UI settings writer is fire-and-forget. Before storing backup state
there, give `UiSettingsStore` the same serialized revision/flush discipline used
by the shared library and register it with the app persistence coordinator. This
prevents a close, updater restart, or rapid status update from losing the latest
successful-backup record or letting an older settings snapshot win.

### 9. Track one content digest, not every keystroke

The backup coordinator runs at app lifetime. After pending persistence is
flushed, compute a content digest over sorted essay semantic digests, the shared
library digest, and reachable asset hashes. Compare it with
`lastSuccessContentDigest`.

Expose a lightweight activity subscription from `PersistenceCoordinator` (or a
separate app-lifetime content revision signal owned beside it) rather than
coupling the coordinator to editor components. Any activity may schedule a
debounced digest check; false positives are harmless because unchanged digests
produce no archive. Keep the signal free of essay data so persistence ownership
does not move into the backup feature.

Eligibility is: configured + no active run + digest changed + no successful
automatic backup in the current local calendar day. Evaluate after startup data
loads and when the persistence coordinator reports a content mutation; debounce
the expensive digest/archive work until the app is idle. `Back up now` bypasses
the daily limit but not persistence flush or single-flight protection.

Update last-success fields only after write, reopen, and validation. Record only
the digest returned by the exact archived snapshot. If content changed during
the external write, schedule another eligibility check. A failed attempt records
an error code and remains eligible on the next launch.

Alternative rejected: archive after every autosave. Complete archives with
figures would create unnecessary disk and provider-sync churn.

### 10. Retain only ledger-proven backups from this installation

Use a dedicated `<selected folder>/Tesina Backups/` directory and names such as
`Tesina Library - a1b2c3d4 - 2026-08-08T19-42-00Z.tesina`, where the middle
component is a short prefix of this installation's `backupSetId` so two
installations sharing one synced folder never target the same name. Maintain an
atomic Rust-owned `$APPDATA/backup-ledger.json` containing exact filename,
archive hash, creation time, and `backupSetId`. Classification is ledger-first:
a file is a prune candidate only when its name matches the grammar, the ledger
records that exact filename, the recorded backup-set identity matches, and its
current bytes/hash still match immediately before deletion. Files the ledger
does not list are never opened or parsed — retention must not run ZIP or
manifest validation against unowned files in a foreign-writable folder. If the
ledger is missing or disagrees, retain everything. This prevents one device
from pruning another device's valid archive in a shared synced folder. When
owned retained archives accumulate well beyond seven because ownership cannot
be proven or pruning keeps failing, surface a persistent retention warning with
manual-cleanup guidance instead of repeating silent per-file warnings.

Recovery and retention code that enumerates `$APPDATA/backups/` must treat
`backups/imports/` as the only import-rollback namespace and ignore the
pre-existing per-essay delete-backup directories (`backups/<essay-id>/`).

The wizard Test backup is the first retained recovery archive. `Back up now`
uses the same retained-backup class and counts toward the newest seven. Manual
Export library files have no `backup` manifest field and are never pruned.
After a new validated success, sort owned recovery archives by manifest creation
time and prune beyond seven oldest-first.

Manual exports, rollback archives, directories, unknown files, invalid archives,
and temp files are never retention targets. A prune failure is a warning and
does not invalidate the new backup.

### 11. Keep the wizard and status state explicit

Create:

- `state/backup.svelte.ts`: app-lifetime coordinator with injected service for
  unit tests, single-flight run state, eligibility, health, and actions.
- `components/BackupSetupWizard.svelte`: five explicit steps.
- `components/BackupStatusCard.svelte`: optional home setup card and configured
  health/actions.
- `components/BackupSettings.svelte`: persistent Settings surface.
- `components/LibraryImportModal.svelte`: validation, Merge preview, confirm,
  progress, recovery, and result states shared by Import and Restore.

Do not overload the existing DOCX Export action. Add persistent, separate Export
library and Import library entry points. Settings includes Turn off/Re-enable
and explains that old files remain. Label restore as “Restore by merging” (or
localized equivalent) and explain that it never replaces or rolls back newer
work, and that items deleted locally after the backup was created may be
re-added by the merge (they appear as new content in the preview).
Wizard Test requires affirmative consent after showing the exact destination
and complete-unencrypted-library disclosure. Success/status says Tesina verified
the local file only, displays the next expected backup condition, and points to
the provider for remote-sync status.

Route every label and message through Paraglide in both message files. Use UI
locale for the wizard/chrome; persisted imported-copy suffixes use each essay's
document language. Modals trap and restore focus, progress/status changes use
live announcements, and healthy/warning states never rely on color alone.

Every changed `.svelte` file must pass the Svelte MCP autofixer before commit.

### 12. Enforce one Tesina process before any maintenance runs

Every exclusivity mechanism in this design (snapshot lease, import journal,
single-flight backup, ledger, startup recovery) is process-local, so a second
running Tesina instance would defeat all of them — worst case, instance B's
startup recovery "rolls back" instance A's in-flight import. Install
`tauri-plugin-single-instance` (official Tauri plugin, MIT/Apache-2.0) so a
second launch focuses the existing window and exits. Import apply, startup
recovery, automatic backup, and retention run only in the instance that holds
this guard. If the plugin proves unusable on a target platform, an equivalent
exclusive app-data lock (acquired before recovery and released on exit) is
required instead; either way the second process must never treat a live
journal, staged directory, ledger, or in-flight file as interrupted state.

### 13. Start recovery before interactive app load

In the root layout/app initialization sequence, register the shared library with
the persistence coordinator as today, then run import recovery before exposing
loaded essays/library to the home screen. Start backup eligibility only after
recovery and normal data loads finish. Native close and updater restart use a
distinct `OperationCoordinator`, not a flusher registered recursively with
persistence. Snapshot flush completes before acquiring an operation token.
Close/relaunch waits for safe points: export/backup cancels and cleans its
temporary output, while import advances to a persisted recoverable journal
state. Force-kill, crash, and OS shutdown remain covered independently by
startup recovery rather than a close promise.

## Risks / Trade-offs

- **[ZIP or JSON bomb consumes memory]** → Preflight file size and use streaming
  extraction with declared and observed hard limits before JSON parsing.
- **[Cloud File Provider reports a path writable before remote upload]** →
  Tesina guarantees only validated local-folder completion and describes
  provider sync as provider-owned; it never claims remote upload success.
- **[External scope is lost after update or OS permission change]** → Restore
  only the configured directory through the native adapter, recheck canonical
  access before each run, and offer Retry or Choose another folder without
  blocking local work.
- **[Two devices share one backup folder]** → Installation backup-set identity
  plus an exact successful-write ledger prevents cross-device pruning.
- **[Provider operation blocks or has not uploaded]** → Run external I/O away
  from the UI-critical path, define timeout/unavailable/conflict errors, and
  claim only local validation; verify iCloud plus one third-party File Provider.
- **[Import crashes between additive files and library update]** → Durable
  pre-write journal, unused final paths, stable operation IDs, validated
  rollback, and startup recovery make retry/removal deterministic.
- **[Reference remapping misses a citation location]** → One pure ProseMirror
  walker handles every citation attrs location, backed by fixtures containing
  nested sections, tables, lists, appendices, and reference snapshots.
- **[Full archive every day is large]** → Export only reachable assets, skip
  unchanged content digests, run once daily, and retain seven recognized files.
- **[Unencrypted full-library file exposes private work]** → Mandatory bilingual
  privacy step and notice; optional encryption remains a future format feature.
- **[Large implementation becomes hard to review]** → Land in independently
  verified commits: pure archive, pure Merge, Tauri transaction, UI/import,
  backup persistence, wizard/status, then version/release.

## Migration Plan

1. Add pure types, validators, builders, fixtures, and tests without wiring UI.
2. Add the targeted native backup-directory adapter; prove only the active
   selected folder remains usable after packaged-app restart on macOS and
   Windows while old and transient dialog paths remain denied.
3. Add import planner/journal/recovery with a startup gate and fault-injection
   tests.
4. Wire manual Export library and Import library, then complete a real packaged
   round trip with figures, citations, conflicting IDs, and collections.
5. Add backup settings/coordinator, five-step wizard, home/Settings status,
   daily scheduling, and retention.
6. Migrate no existing essay/library data. Existing users see optional backup
   setup; their content stays in place.
7. Bump all mandated version locations to the next patch version, move user
   notes into a dated changelog section, and describe portable libraries and
   optional backups in plain language.
8. After merge to `main`, tag the exact commit, verify updater artifacts and
   signatures, and publish the release through the existing workflow.

Rollback before release is removal of the new UI/native commands/modules because no
existing data schema is rewritten. After release, disabling the backup UI does
not affect local essays; `.tesina` files remain user-owned. If import must be
disabled, startup recovery remains until every existing journal is completed or
rolled back.

After publication, rollback is a forward patch release: disable new entry
points while retaining archive readability and startup recovery for existing
journals. Never delete user-owned `.tesina` files. The release runbook records
the compatible journal/archive versions and exact recovery-only behavior.

## Open Questions

- Concrete archive safety limits must be selected from implementation fixtures
  before code review; changing numeric limits within reasonable supported ranges
  does not change the behavioral contract or architecture.
- The final component placement inside the existing home/Settings layout may be
  adjusted during UI implementation as long as the optional card, persistent
  Settings entry, and five wizard steps remain observable.

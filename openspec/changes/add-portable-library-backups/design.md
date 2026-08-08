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
  registration and safe native close.

Current writes are intentionally limited to app data except for paths granted by
native dialogs. Scheduled backups need that selected external-folder scope after
restart. Tauri's official persisted-scope plugin is designed to save and restore
runtime filesystem scopes and must be registered after the filesystem plugin.
The design therefore adds that official plugin rather than broadening the static
capability to all home or cloud-provider directories.

The desktop app does not directly depend on a ZIP library. `fflate` 0.8.x is
already locked through `packages/docx-export`, is MIT-licensed, and is suitable
for browser/Tauri byte APIs. Add it as a direct desktop dependency; do not
import it transitively through the DOCX package. Extraction must use bounded
streaming logic rather than unbounded `unzipSync` on untrusted archives.

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
Crypto SHA-256. Normalize archive paths before duplicate/path-safety checks.

Figure nodes are normalized to `assets/...` paths in archive essay JSON. Import
rewrites them to collision-free `essays/assets/...` app-data paths. Only assets
reachable by a valid essay are exported.

Alternative rejected: copy the app-data directory verbatim. It would leak device
settings/backups, preserve orphan data, and prevent strict versioning.

### 2. Create an immutable disk snapshot after the persistence barrier

Add a snapshot reader that calls `persistence.flushPending()` and then reads the
persisted essay files, library file, and reachable assets. Archive creation
never mixes live Svelte state with disk state. It validates every source essay
as schema version 2 and the library as schema version 1 before packaging.

The archive builder accepts injected `now`, `appVersion`, UUID, and digest
dependencies for deterministic fixtures. Production adapters supply real values.

Alternative rejected: serialize current UI stores directly. Not every essay is
loaded, concurrent debounce writes could race, and app-lifetime backup must work
outside the editor.

### 3. Split pure archive/plan logic from filesystem adapters

Create these pure modules under `apps/desktop/src/lib/portable/`:

- `types.ts`: manifest, validated archive, snapshot, plan, and result contracts.
- `canonicalJson.ts`: stable JSON bytes and semantic hashes.
- `archive.ts`: bounded ZIP build/read orchestration over injected byte inputs.
- `validate.ts`: manifest/path/size/checksum/schema/relationship validation.
- `snapshot.ts`: pure assembly checks over already-read data.
- `remap.ts`: ProseMirror figure and citation ID/path walkers.
- `importPlan.ts`: deterministic Merge plan and operation IDs.
- `retention.ts`: pure recognized-file classification and prune selection.
- colocated `*.test.ts` files and deterministic fixtures under
  `portable/fixtures/`.

Create Tauri-aware adapters under `apps/desktop/src/lib/persist/`:

- `librarySnapshot.ts`: flush barrier plus app-data file enumeration/reads.
- `portableFiles.ts`: native open/save/folder dialogs, temporary archive writes,
  recoverable destination replacement, and selected-folder I/O.
- `importJournal.ts`: staged transaction, durable journal, rollback archive,
  idempotent apply, resume, and rollback.

Pure modules MUST NOT import runes, Svelte, Tauri, or app-data paths.

Alternative rejected: a single Svelte store that reads ZIP and writes files. It
would make malformed-input and crash-recovery behavior hard to test.

### 4. Bound all untrusted archive work

Define constants in `portable/limits.ts` for maximum archive bytes, entry count,
single expanded entry, total expanded bytes, and compression ratio. Pick
concrete values during the first implementation task from realistic
large-library fixtures and document why they exceed expected use while bounding
memory.

Read the native file's size before loading it. During streaming extraction,
reject unknown entries, encrypted entries, duplicate normalized paths, absolute
paths, backslashes, NULs, dot segments, symlinks or non-regular entries, and any
counter crossing a limit. Parse JSON only after the byte/checksum checks pass.
Never write extracted untrusted paths directly to disk.

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
and a Paraglide-localized title suffix.

Reference equality uses canonical full reference content including ID.
Collection equality uses ID, name, and a sorted unique member-ID list. For
different same-ID content, allocate new IDs, then run one mapping pass over
imported citation attrs, reference snapshots, and collection member IDs. Never
rewrite a pre-existing local essay.

Asset equality requires both SHA-256 equality and byte equality. Build a local
checksum index once per import. Reuse exact bytes; otherwise allocate a new UUID
path with the validated image extension.

Alternative rejected: newest-timestamp-wins. Timestamps do not prove which paper
or reference content the user intends to preserve.

### 6. Make Merge additive and journal only the mutable boundary

The planner emits stable operations from an injected transaction ID:

1. stage new asset bytes under `$APPDATA/imports/<transaction>/stage/`;
2. stage new/remapped essay JSON;
3. write a validated rollback `.tesina` archive under
   `$APPDATA/backups/imports/`;
4. persist the journal before the first live write;
5. move new assets to unused final paths;
6. move new essays to unused final paths;
7. atomically replace only `library.json` with the merged library;
8. rescan and validate all imported relationships;
9. mark complete and remove staging, retaining the rollback archive.

No existing essay or asset path is overwritten. Consequently, a partial apply
can be retried idempotently; rollback restores `library.json` and removes only
new paths listed in the journal. On app startup, recovery runs before the essay
index/library becomes interactive. Resume when the journal and staged hashes are
valid; otherwise restore from the rollback archive.

Alternative rejected: rename the entire app-data directory. Settings, updater
state, and unrelated backups share that root, and cross-platform directory
replacement is unnecessarily risky.

### 7. Reuse one export service for manual files, rollback, and backup

Create an app-level `LibraryArchiveService` interface with operations to capture
a snapshot, build/validate bytes, write a manual export, create an app-data
rollback, and write a selected-folder backup. Manual export and automatic backup
must not implement separate packaging rules.

For a selected destination, write a UUID-named sibling temporary file, validate
the bytes by reopening it, and then perform a recoverable replacement. If a
previous file exists, preserve it under a temporary previous name until the new
file is in place; recover the previous file on failure. Clean only temp files
whose names were generated for the active operation.

### 8. Persist the selected filesystem scope, not a broad path grant

Add `tauri-plugin-persisted-scope = "2"` after `tauri-plugin-fs` in Rust plugin
initialization, following the official ordering requirement. The folder picker
adds the chosen path to runtime fs scope; persisted-scope restores it on later
launches. Update capability permissions only with the plugin's generated minimal
permission plus the fs commands needed inside the chosen runtime scope. Do not
add `$HOME/**/*`, cloud-provider-specific static paths, or network permissions.

Store backup configuration additively in `settings.json` schema version 1:

```ts
interface BackupSettings {
  folderPath: string;
  enabled: boolean;
  configuredAt: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastSuccessContentDigest?: string;
  lastErrorCode?: string;
  setupCardDismissed?: boolean;
}
```

Do not export `BackupSettings`. A new folder becomes active only after its real
test archive validates. Changing folders leaves the old folder untouched.

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

Update last-success fields only after write, reopen, and validation. A failed
attempt records an error code and remains eligible on the next launch.

Alternative rejected: archive after every autosave. Complete archives with
figures would create unnecessary disk and provider-sync churn.

### 10. Retain only recognized Tesina daily backups

Use a dedicated `<selected folder>/Tesina Backups/` directory and names such as
`Tesina Library - 2026-08-08T19-42-00Z.tesina`. Classify a file as prunable only
when its name matches the exact automatic-backup grammar and its manifest is a
valid `tesina-library` archive. After a new validated success, sort recognized
daily backups by manifest creation time and prune beyond seven oldest-first.

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

Do not overload the existing DOCX Export action. Add separate Library backup and
Import library entry points. Route every label and message through Paraglide in
both message files. Use UI locale for the wizard/chrome; essay content remains
document-locale-owned.

Every changed `.svelte` file must pass the Svelte MCP autofixer before commit.

### 12. Start recovery before interactive app load

In the root layout/app initialization sequence, register the shared library with
the persistence coordinator as today, then run import recovery before exposing
loaded essays/library to the home screen. Start backup eligibility only after
recovery and normal data loads finish. Native close and updater restart continue
to call the same persistence barrier; an active import/export/backup operation
must register a flush/finalization barrier or prevent unsafe close until its
recoverable state is durable.

## Risks / Trade-offs

- **[ZIP or JSON bomb consumes memory]** → Preflight file size and use streaming
  extraction with declared and observed hard limits before JSON parsing.
- **[Cloud File Provider reports a path writable before remote upload]** →
  Tesina guarantees only validated local-folder completion and describes
  provider sync as provider-owned; it never claims remote upload success.
- **[External scope is lost after update or OS permission change]** → Use
  persisted-scope, recheck folder access before each run, and offer Retry or
  Choose another folder without blocking local work.
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
2. Add Tauri persisted-scope/plugin and filesystem adapters; prove a selected
   folder remains authorized after packaged-app restart on macOS and Windows.
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

Rollback before release is removal of the new UI/plugin/modules because no
existing data schema is rewritten. After release, disabling the backup UI does
not affect local essays; `.tesina` files remain user-owned. If import must be
disabled, startup recovery remains until every existing journal is completed or
rolled back.

## Open Questions

- Concrete archive safety limits must be selected from implementation fixtures
  before code review; changing numeric limits within reasonable supported ranges
  does not change the behavioral contract or architecture.
- The final component placement inside the existing home/Settings layout may be
  adjusted during UI implementation as long as the optional card, persistent
  Settings entry, and five wizard steps remain observable.

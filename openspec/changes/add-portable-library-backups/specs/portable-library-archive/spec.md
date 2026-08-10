## Purpose

Defines a complete, portable Tesina library archive that users can validate,
move, and store independently of any account, provider, or device preference.

## ADDED Requirements

### Requirement: Complete content-library export

Tesina SHALL export one `.tesina` archive containing every essay, each essay's
title-page and document settings, the shared reference library and collections,
and every figure asset reachable from an exported essay. If any source essay
file, the shared library file, or a reachable asset fails source validation
during capture, the export MUST fail with an error identifying the offending
item; invalid content is never silently skipped.

#### Scenario: Export a complete library

- **WHEN** the user exports a library containing multiple essays, cited
  references, collections, and figures
- **THEN** the archive contains every content item and every figure needed
  to reopen those essays

#### Scenario: Source library contains an invalid item

- **WHEN** an essay file, the shared library file, or a reachable asset fails
  source validation while an export or backup snapshot is captured
- **THEN** the operation fails with a localized error that identifies the
  offending file and offers recovery guidance, and no partial archive is
  reported as success

#### Scenario: Exclude device-local data

- **WHEN** Tesina builds a complete-library archive
- **THEN** it excludes interface language, theme, toolbar position,
  backup-folder configuration, release-note state, and deleted-essay backups

#### Scenario: Exclude orphaned figure files

- **WHEN** the local asset directory contains a file that no exported essay
  references
- **THEN** Tesina omits that orphaned file from the archive

### Requirement: Versioned and checksummed manifest

Every archive SHALL contain a manifest that identifies the archive kind and
format version, producing Tesina version, creation time, content counts,
unencrypted status, and the byte length and SHA-256 checksum of every payload
file.

#### Scenario: Inspect a valid manifest

- **WHEN** Tesina opens an archive produced by version one of this capability
- **THEN** the manifest describes every payload file and each description
  matches the file's actual bytes

#### Scenario: Reject an unsupported future format

- **WHEN** an archive declares a format version newer than the running Tesina
  version supports
- **THEN** Tesina rejects it with a localized compatibility message and does not
  treat it as importable

### Requirement: Stable snapshot before archive creation

Tesina SHALL capture every archive from one immutable persisted revision. It
MUST finish pending essay and shared-library persistence, prevent or detect
subsequent persisted mutations through the last source read, and retry or abort
rather than combine content from different revisions.

#### Scenario: Export while autosave is pending

- **WHEN** the user starts an export immediately after changing an essay or
  reference
- **THEN** Tesina flushes the pending save and the archive contains the latest
  acknowledged content

#### Scenario: Pending persistence fails

- **WHEN** a pending save cannot be completed before archive creation
- **THEN** Tesina reports the save failure and does not produce an archive from
  stale mixed-revision data

#### Scenario: Content changes during snapshot capture

- **WHEN** an essay, reference, collection, or reachable asset changes after
  pending saves flush but before the final archive source byte is captured
- **THEN** Tesina excludes that later change from a clearly defined captured
  revision or retries the entire capture, and never returns a mixed revision

### Requirement: Strict archive validation

Tesina SHALL validate the container, manifest, allowed paths, declared and
expanded sizes, checksums, JSON shapes, supported schema versions, and required
asset, citation, and collection-membership relationships before declaring an
archive valid. Every identifier used to derive a local path MUST be a canonical
supported identifier and MUST agree with the corresponding archive entry name.
Allowed entry paths are exactly `manifest.json`, `library.json`,
`essays/<uuid>.json`, and `assets/<uuid>.<extension>`, where `<uuid>` is a
canonical lowercase UUID and `<extension>` is one to five lowercase ASCII
letters or digits; entry names are compared byte-wise after this grammar check
so no Unicode or filesystem case normalization can alias two entries. Validation
MUST also bound structured JSON complexity and decoded image cost.

#### Scenario: Detect corrupted content

- **WHEN** a payload file does not match its manifest checksum or byte length
- **THEN** validation fails with a localized corruption message

#### Scenario: Reject unsafe archive paths

- **WHEN** an archive entry is absolute, contains a parent traversal, uses a
  disallowed path, or duplicates another normalized path
- **THEN** validation rejects the archive without extracting that entry outside
  temporary storage

#### Scenario: Reject excessive resource use

- **WHEN** declared or observed file count, individual-file size, total expanded
  size, or compression ratio exceeds the supported safety limits
- **THEN** validation stops and reports that the archive is too large or unsafe

#### Scenario: Detect a missing figure

- **WHEN** an exported essay references a figure that is absent from the
  manifest or payload
- **THEN** validation rejects the archive as incomplete

#### Scenario: Reject an unsafe payload identifier

- **WHEN** an essay, reference, collection, asset, or operation identifier
  contains traversal, separators, an overlong value, a reserved name, or does
  not match its archive entry
- **THEN** validation rejects the archive before planning or deriving any local
  filesystem path

#### Scenario: Reject unresolved content relationships

- **WHEN** an archived essay citation, reference snapshot entry, or collection
  member references an identifier that resolves to nothing inside the archive
- **THEN** validation rejects the archive before any Merge preview or apply is
  offered

#### Scenario: Reject excessive structured or decoded content

- **WHEN** JSON nesting, object/node/string counts, image dimensions, frame
  count, or cumulative decoded pixels exceeds a supported safety limit
- **THEN** validation stops before recursive traversal or image rendering can
  exhaust application memory

### Requirement: Safe destination write

Tesina SHALL create and validate an archive in temporary storage before making
it visible at the user-selected destination, and SHALL preserve any previously
valid destination file until the replacement can be recovered safely. An
interrupted replacement MUST be detectable and recoverable on the next access.
When creating a new automatic-backup file, Tesina MUST create the destination
name exclusively and MUST NOT overwrite any existing file it did not create in
the same operation; replacement semantics apply only when the user explicitly
chooses an existing manual-export destination.

#### Scenario: Successful manual export

- **WHEN** the user chooses a writable destination and archive validation passes
- **THEN** one complete `.tesina` file becomes visible at that destination

#### Scenario: User cancels destination selection

- **WHEN** the user cancels the native save dialog
- **THEN** Tesina reports cancellation without creating or changing a
  destination file

#### Scenario: Destination write fails

- **WHEN** the destination becomes unavailable or rejects the write
- **THEN** Tesina reports failure, does not report export success, and preserves
  any previously valid destination file

#### Scenario: Automatic-backup name already exists

- **WHEN** an automatic backup's candidate filename already exists in the
  destination folder
- **THEN** Tesina writes its backup under a different unused name and never
  replaces the existing file

#### Scenario: App exits during destination replacement

- **WHEN** Tesina restarts after interruption at any replacement boundary
- **THEN** it deterministically restores the previous valid destination or
  completes installation of the newly validated archive without deleting both

### Requirement: Provider-neutral and unencrypted version-one archive

Version-one `.tesina` archives SHALL be usable through ordinary filesystem
copying without a Tesina account or provider API and SHALL be unencrypted.
Before manual export or backup setup, Tesina MUST clearly explain that the file
contains the user's complete library and is not password-protected. Manifest
checksums provide corruption detection only and MUST NOT be presented as proof
of archive origin, authenticity, or confidentiality.

#### Scenario: Export without an account

- **WHEN** a user has no Tesina, Google, Microsoft, Apple, or Dropbox account
  connected to Tesina
- **THEN** the user can still export a complete archive to any authorized local
  destination

#### Scenario: Privacy notice is shown

- **WHEN** the user reaches the export confirmation or backup privacy step
- **THEN** Tesina explains in the current UI language what the archive contains
  and that version one is unencrypted

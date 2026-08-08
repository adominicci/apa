## Purpose

Defines a complete, portable Tesina library archive that users can validate,
move, and store independently of any account, provider, or device preference.

## ADDED Requirements

### Requirement: Complete content-library export

Tesina SHALL export one `.tesina` archive containing every valid essay, each
essay's title-page and document settings, the shared reference library and
collections, and every figure asset reachable from an exported essay.

#### Scenario: Export a complete library

- **WHEN** the user exports a library containing multiple essays, cited
  references, collections, and figures
- **THEN** the archive contains every valid content item and every figure needed
  to reopen those essays

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

Tesina SHALL finish every pending essay and shared-library persistence operation
before reading the source files used to create an export or backup archive.

#### Scenario: Export while autosave is pending

- **WHEN** the user starts an export immediately after changing an essay or
  reference
- **THEN** Tesina flushes the pending save and the archive contains the latest
  acknowledged content

#### Scenario: Pending persistence fails

- **WHEN** a pending save cannot be completed before archive creation
- **THEN** Tesina reports the save failure and does not produce an archive from
  stale mixed-revision data

### Requirement: Strict archive validation

Tesina SHALL validate the container, manifest, allowed paths, declared and
expanded sizes, checksums, JSON shapes, supported schema versions, and required
asset relationships before declaring an archive valid.

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

### Requirement: Safe destination write

Tesina SHALL create and validate an archive in temporary storage before making
it visible at the user-selected destination, and SHALL preserve any previously
valid destination file until the replacement can be recovered safely.

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

### Requirement: Provider-neutral and unencrypted version-one archive

Version-one `.tesina` archives SHALL be usable through ordinary filesystem
copying without a Tesina account or provider API and SHALL be unencrypted.
Before manual export or backup setup, Tesina MUST clearly explain that the file
contains the user's complete library and is not password-protected.

#### Scenario: Export without an account

- **WHEN** a user has no Tesina, Google, Microsoft, Apple, or Dropbox account
  connected to Tesina
- **THEN** the user can still export a complete archive to any authorized local
  destination

#### Scenario: Privacy notice is shown

- **WHEN** the user reaches the export confirmation or backup privacy step
- **THEN** Tesina explains in the current UI language what the archive contains
  and that version one is unencrypted

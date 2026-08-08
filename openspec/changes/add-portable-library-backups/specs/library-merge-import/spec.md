## Purpose

Defines a lossless, previewed library import that preserves local work, remaps
conflicting identities consistently, and can recover from interruption.

## ADDED Requirements

### Requirement: Validate before planning or writing

Tesina SHALL complete archive validation before constructing an import plan and
SHALL complete a read-only plan before changing live library data.

#### Scenario: Invalid archive selected

- **WHEN** the user selects an archive that fails any portable-archive
  validation rule
- **THEN** Tesina shows the validation error and leaves essays, references,
  collections, assets, and settings unchanged

#### Scenario: Valid archive selected

- **WHEN** the selected archive passes validation
- **THEN** Tesina produces a read-only Merge preview before offering an apply
  action

### Requirement: Explicit Merge preview

The Merge preview SHALL summarize new essays, identical essays to skip,
conflicting essays to preserve as imported copies, reference and collection
changes, and reused or added assets. Version one MUST NOT offer a
replace-library operation.

#### Scenario: Review a mixed import

- **WHEN** an archive contains new, identical, and conflicting content
- **THEN** the preview presents the counts and consequences of each category in
  the current UI language before the user confirms

#### Scenario: Cancel before apply

- **WHEN** the user closes or cancels the Merge preview
- **THEN** Tesina leaves the live library unchanged

### Requirement: Lossless essay identity handling

Tesina SHALL compare essays by stable ID and semantic content rather than title.
It SHALL preserve both versions when one ID has different semantic content and
SHALL skip an imported essay only when the existing same-ID essay is
semantically identical.

#### Scenario: Same title with different IDs

- **WHEN** a local and imported essay share a title but have different IDs
- **THEN** Tesina retains both essays without treating either as a conflict

#### Scenario: Same ID and identical semantic content

- **WHEN** a local and imported essay differ only in non-semantic save metadata
  such as `updatedAt`
- **THEN** Tesina skips the imported duplicate

#### Scenario: Same ID and different semantic content

- **WHEN** a local and imported essay share an ID but differ in document,
  title-page, settings, or cited-reference snapshot content
- **THEN** Tesina preserves the local essay and imports the other with a new ID,
  localized imported-copy title suffix, original creation date, source essay ID,
  and import timestamp

### Requirement: Consistent reference and collection remapping

Tesina SHALL reuse identical same-ID references and collections. It SHALL assign
new IDs to different same-ID imported references or collections and SHALL apply
the resulting map to imported citations, reference snapshots, and collection
memberships without changing local essays.

#### Scenario: Conflicting cited reference

- **WHEN** an imported reference shares a local ID but has different reference
  content and an imported essay cites it
- **THEN** Tesina assigns the imported reference a new ID and rewrites that
  imported essay's citation and snapshot to the new ID

#### Scenario: Conflicting collection

- **WHEN** an imported collection shares a local ID but has different name or
  membership content
- **THEN** Tesina retains the local collection, creates a remapped imported-copy
  collection, and maps its member IDs through the reference map

#### Scenario: Local citation remains stable

- **WHEN** imported identity remapping occurs
- **THEN** no citation or reference snapshot in a pre-existing local essay is
  rewritten

### Requirement: Safe asset deduplication and remapping

Tesina SHALL compare figure assets by byte checksum, reuse existing identical
bytes, and assign collision-free local paths to new bytes. Imported essay figure
paths SHALL resolve to the chosen local assets after planning.

#### Scenario: Identical asset bytes

- **WHEN** an imported figure has the same checksum and bytes as an existing
  local asset
- **THEN** the import plan reuses the existing asset and does not write a second
  copy

#### Scenario: Different bytes with a colliding path

- **WHEN** an imported asset path matches a local path but its bytes differ
- **THEN** Tesina writes the imported bytes under a new path and rewrites only
  imported essay content to that path

### Requirement: Validated rollback before merge

Before applying a Merge plan, Tesina SHALL create and validate a complete local
rollback archive representing the pre-import content library.

#### Scenario: Rollback creation fails

- **WHEN** Tesina cannot create or validate the pre-import rollback archive
- **THEN** it refuses to apply the Merge plan and leaves live data unchanged

#### Scenario: Rollback creation succeeds

- **WHEN** the rollback archive is written and passes the same archive
  validation contract
- **THEN** Tesina may begin applying the confirmed Merge plan and retains the
  rollback archive as a recovery point

### Requirement: Idempotent journaled apply and startup recovery

Tesina SHALL record a durable import journal with stable transaction and
operation IDs before applying changes. Each operation SHALL be safe to retry. On
startup, Tesina SHALL detect an unfinished transaction and either resume a valid
plan or restore the validated rollback when safe resume is impossible.

#### Scenario: App closes during import

- **WHEN** Tesina restarts with a valid unfinished import journal
- **THEN** it resumes incomplete operations without duplicating completed ones
  and informs the user that recovery is occurring

#### Scenario: Journal cannot be resumed safely

- **WHEN** the journal is incomplete, inconsistent, or no longer matches staged
  data
- **THEN** Tesina restores the validated rollback archive and reports the
  recovery result

### Requirement: Final consistency gate

Tesina SHALL mark an import complete only after every imported essay, citation,
reference snapshot, collection membership, and asset path resolves consistently.

#### Scenario: Consistency check passes

- **WHEN** all planned writes finish and all relationships resolve
- **THEN** Tesina removes temporary staged data, closes the journal as complete,
  refreshes the home/library views, and reports the Merge result

#### Scenario: Consistency check fails

- **WHEN** any post-apply relationship or expected file is inconsistent
- **THEN** Tesina does not report success and initiates journal recovery or
  rollback

### Requirement: Restore uses Merge semantics

Manual and automatic-backup restore SHALL use the same archive validation,
preview, identity mapping, and lossless Merge behavior as ordinary import.

#### Scenario: Restore an older backup

- **WHEN** the user selects Restore for a valid older `.tesina` backup
- **THEN** Tesina opens a Merge preview and preserves newer local work rather
  than replacing the current library

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
  imported-copy title suffix in that essay's document language, original
  creation date, source essay ID, and import timestamp

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

### Requirement: Plan freshness at apply

An apply operation SHALL act only on a Merge plan computed from a flushed,
lease-stable persisted revision, and Tesina MUST verify at apply time that the
live library revision still matches the plan-time revision. The merged shared
library that replaces `library.json` MUST be built from the revision current at
apply. On a revision mismatch, Tesina MUST replan (re-presenting the preview
when its counts change) or abort without writing.

#### Scenario: Library changes while the preview is open

- **WHEN** the user edits references, collections, or essays while a Merge
  preview is open and then confirms apply
- **THEN** Tesina detects the revision change and replans or aborts instead of
  overwriting the newer local library state with a merge computed from stale
  data

#### Scenario: Library is unchanged at apply

- **WHEN** the live library revision at apply equals the plan-time revision
- **THEN** the confirmed plan applies without an unnecessary replan

### Requirement: Cross-process exclusion

Import apply, startup recovery, automatic backup, and retention SHALL run only
while this Tesina process holds an exclusive cross-process guard (a single
enforced application instance or an equivalent exclusive lock). A second
process MUST NOT treat another live process's journals, staged data, ledger, or
in-flight files as interrupted state.

#### Scenario: Second app instance launches during import

- **WHEN** a second Tesina instance starts while another instance has an
  import transaction in progress
- **THEN** the second instance does not run recovery against, modify, or delete
  the running instance's journal, staged data, or newly written files

#### Scenario: Exclusive guard cannot be acquired

- **WHEN** the cross-process guard cannot be acquired at startup
- **THEN** Tesina surfaces the conflict (for example by focusing the existing
  instance) instead of running recovery, import, backup, or retention
  concurrently

### Requirement: Validated rollback before merge

Before applying a Merge plan, Tesina SHALL create and validate a complete local
rollback archive representing the pre-import content library. Tesina SHALL tell
the user that this local recovery copy is unencrypted, retain every rollback
needed by an unfinished transaction, and apply a bounded retention policy only
to completed transactions.

#### Scenario: Rollback creation fails

- **WHEN** Tesina cannot create or validate the pre-import rollback archive
- **THEN** it refuses to apply the Merge plan and leaves live data unchanged

#### Scenario: Rollback creation succeeds

- **WHEN** the rollback archive is written and passes the same archive
  validation contract
- **THEN** Tesina may begin applying the confirmed Merge plan and retains the
  rollback archive as a recovery point

### Requirement: Idempotent journaled apply and startup recovery

Tesina SHALL persist and reopen-validate an import journal with stable
transaction and operation IDs before applying changes. Each operation SHALL be
safe to retry after normal close, updater restart, or process crash. On startup,
Tesina SHALL detect an unfinished transaction and either resume a valid plan or
restore the validated rollback when safe resume is impossible.

#### Scenario: App closes during import

- **WHEN** Tesina restarts with a valid unfinished import journal
- **THEN** it resumes incomplete operations without duplicating completed ones
  and informs the user that recovery is occurring

#### Scenario: Journal cannot be resumed safely

- **WHEN** the journal is incomplete, inconsistent, or no longer matches staged
  data
- **THEN** Tesina restores the validated rollback archive and reports the
  recovery result

#### Scenario: Resume and rollback are both unavailable

- **WHEN** staged data cannot be resumed and the journal or rollback archive is
  missing, corrupted, inconsistent, or inaccessible
- **THEN** Tesina fails closed before library interactivity, preserves all
  evidence without guessed deletion, and presents a localized recovery-required
  state with Retry, safe diagnostic export, and quit guidance

#### Scenario: Rollback sees unexpected final bytes

- **WHEN** a final path recorded as import-created no longer matches the
  journaled expected hash and length
- **THEN** Tesina does not delete that path automatically and enters the safe
  recovery-required state

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

#### Scenario: User reviews restore consequences

- **WHEN** the restore confirmation is shown
- **THEN** Tesina explains in the current UI language that Restore merges rather
  than rolls back or replaces, that older conflicts can appear as imported
  copies, and that content deleted locally after the backup was created may be
  re-added

#### Scenario: Restore re-adds locally deleted content

- **WHEN** a restored backup contains an essay, reference, or collection that
  the user deleted locally after that backup was created
- **THEN** the Merge preview counts it as new content that will be re-added and
  the restore explanation covers this consequence before apply

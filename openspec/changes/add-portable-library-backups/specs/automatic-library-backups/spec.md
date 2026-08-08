## Purpose

Defines optional, understandable, provider-neutral backups that create verified
daily recovery points without blocking writing or requiring a Tesina account.

## ADDED Requirements

### Requirement: Discoverable but optional setup

Tesina SHALL offer backup setup through a dismissible home-screen card and a
persistent Settings entry. Backup setup MUST NOT block creating, opening, or
editing essays.

#### Scenario: User has not configured backup

- **WHEN** the user opens the home screen without backup configured
- **THEN** Tesina shows the optional setup card until the user dismisses it and
  all writing features remain available

#### Scenario: User dismisses the home card

- **WHEN** the user dismisses the setup card
- **THEN** the card stays dismissed according to its UI preference while backup
  setup remains available in Settings

### Requirement: Step-by-step bilingual backup wizard

The wizard SHALL use the current UI language and separate explanation, folder
selection, privacy review, test backup, and success into understandable steps.

#### Scenario: Complete wizard path

- **WHEN** a user proceeds through setup
- **THEN** Tesina explains local-first storage, names Google Drive, iCloud
  Drive, OneDrive, Dropbox, and ordinary folders, opens the native folder
  picker, shows the unencrypted-content notice, validates a real test backup,
  and displays a success summary

#### Scenario: User leaves the wizard early

- **WHEN** the user cancels before the test backup succeeds
- **THEN** Tesina does not mark automatic backup as configured

### Requirement: Persist only the selected folder scope

Tesina SHALL remember access to the user-selected backup folder across app
restarts without granting or requesting broad access to unrelated filesystem
locations. Manual import/export selections and previously configured backup
folders MUST remain temporary or be revoked once they are no longer active.

#### Scenario: Restart after successful setup

- **WHEN** Tesina restarts after the wizard's test backup succeeded
- **THEN** it can access the selected folder for scheduled backups without
  asking the user to select it again

#### Scenario: User changes the folder

- **WHEN** the user chooses Change folder and completes a new test backup
- **THEN** subsequent backups use the new authorized folder and no longer write
  to or retain authority for the old folder, while existing files in that old
  folder remain untouched and are disclosed to the user

#### Scenario: Transient dialog locations remain unauthorized

- **WHEN** the app restarts after the user selected manual import/export files
  or replaced a configured backup folder
- **THEN** only the active backup directory remains authorized without asking
  again

### Requirement: Validated test before enabling backup

Tesina SHALL enable automatic backup only after it writes a real archive inside
a dedicated `Tesina Backups` subfolder, validates the archive, and reopens its
manifest successfully.

#### Scenario: Test backup succeeds

- **WHEN** the selected folder accepts the write and the resulting archive
  passes validation
- **THEN** Tesina enables automatic backup and records the successful location
  and time

#### Scenario: User consents to the real test write

- **WHEN** the user reaches Test backup
- **THEN** Tesina shows the exact destination, explains that the complete
  unencrypted library will be written now, and requires an affirmative action
  before writing

#### Scenario: Test backup fails

- **WHEN** creation, validation, or reopen fails
- **THEN** Tesina keeps automatic backup disabled and offers Retry or Choose
  another folder with a localized explanation

### Requirement: Changed-content daily scheduling

Tesina SHALL create at most one automatic backup per local calendar day and only
when the content-library revision differs from the last successful backup.
Failure SHALL NOT advance the successful revision or date. The user SHALL also
have a Back up now action.

#### Scenario: First changed session of the day

- **WHEN** content changed since the last successful backup and no automatic
  backup succeeded today
- **THEN** Tesina creates one automatic backup after pending persistence is
  flushed

#### Scenario: More changes after today's success

- **WHEN** content changes again after today's automatic backup succeeded
- **THEN** Tesina waits until a later eligible day unless the user selects Back
  up now

#### Scenario: No content changes

- **WHEN** the content-library revision matches the last successful backup
- **THEN** Tesina does not create a redundant scheduled archive

#### Scenario: Manual backup requested

- **WHEN** the user selects Back up now
- **THEN** Tesina attempts a fresh validated backup regardless of today's
  automatic-backup count and reports its result

#### Scenario: Content changes while a backup is being written

- **WHEN** a backup validates but content changed after its immutable snapshot
  was captured
- **THEN** Tesina records only that archived snapshot's digest and schedules a
  later eligibility check for the newer content

### Requirement: Observable backup state

After setup, Tesina SHALL show the selected location, last successful backup
time, next expected backup condition or time, current health, and actions to
Back up now, Restore by merging, Open backup folder, Change folder, Turn off,
and Retry when applicable. A started write MUST NOT be reported as successful.

#### Scenario: Backup succeeds

- **WHEN** the archive is closed, locally visible, reopened, and passes
  validation
- **THEN** Tesina updates Last backup to that completion time and shows a
  healthy local-backup state while clearly stating that any provider upload
  remains provider-owned and unverified by Tesina

#### Scenario: Backup is still running

- **WHEN** archive creation or validation has not finished
- **THEN** the UI shows an in-progress state and preserves the previous last
  successful time

#### Scenario: User turns backup off

- **WHEN** the user confirms Turn off
- **THEN** Tesina stops future scheduled writes, revokes the configured-folder
  authorization, and explains that existing backup files remain untouched

#### Scenario: User re-enables backup

- **WHEN** the user chooses to set up backup again
- **THEN** Tesina requires a newly authorized folder and successful test backup
  before scheduling resumes

### Requirement: Backup failure never blocks writing

An unavailable, moved, full, or unauthorized backup folder SHALL produce a
non-blocking warning and retry path while local editing and autosave continue.

#### Scenario: Synced folder is offline

- **WHEN** a scheduled backup cannot write because the selected cloud-backed
  folder is unavailable
- **THEN** Tesina preserves local writing, shows Try again and Choose another
  folder, and retries eligibility on the next app launch

#### Scenario: Retry later succeeds

- **WHEN** the folder becomes writable and a retry archive validates
- **THEN** Tesina clears the warning and records the new successful revision and
  time

### Requirement: Safe seven-version retention

After a successful scheduled or Back up now operation, Tesina SHALL retain the
seven newest valid recovery archives proven to belong to this installation's
backup set. Ownership MUST be established by a durable successful-write record
and matching archive identity and bytes, not inferred from filename alone.
Tesina SHALL never delete directories, temporary unknown files, manual exports,
archives from another device or installation, or unrelated files. Test backup
counts as the first retained recovery archive; manual Export library does not.

#### Scenario: Eighth owned recovery backup succeeds

- **WHEN** eight valid ledger-owned recovery backups exist after a new success
- **THEN** Tesina removes only the oldest recognized owned backup and
  retains the newest seven

#### Scenario: Shared folder contains another installation's backup

- **WHEN** a valid archive matches the filename grammar but is not present in
  this installation's successful-write record with matching identity and hash
- **THEN** Tesina leaves it untouched

#### Scenario: Ownership record is missing or disagrees

- **WHEN** retention cannot prove that a candidate's current bytes are the file
  this installation created
- **THEN** Tesina retains the candidate and reports no destructive success for
  that file

#### Scenario: Backup folder contains unrelated files

- **WHEN** retention scans a folder containing unrelated files or an
  unrecognized `.tesina` file
- **THEN** Tesina leaves those entries untouched

#### Scenario: Pruning fails

- **WHEN** an old recognized backup cannot be removed
- **THEN** the new validated backup remains successful and Tesina reports a
  non-destructive retention warning without deleting another file in its place

### Requirement: Provider-neutral folder operation

Tesina SHALL interact only with the authorized filesystem folder. It SHALL NOT
require provider-specific authentication, provider APIs, a Tesina account, or a
network connection to create the local backup file. Tesina MUST distinguish
successful local validation from remote provider synchronization.

#### Scenario: Ordinary local folder selected

- **WHEN** the user selects a writable folder that is not managed by a cloud
  provider
- **THEN** setup, daily backup, retention, and restore work the same way

#### Scenario: Desktop sync client selected

- **WHEN** the user selects a folder exposed by Google Drive, iCloud Drive,
  OneDrive, or Dropbox
- **THEN** Tesina writes through the filesystem and leaves remote
  synchronization status and transport to that provider's desktop client

### Requirement: Restore routes through safe Merge

The Restore action SHALL list or select available `.tesina` files and then use
the validated library Merge capability rather than replacing local content.

#### Scenario: Restore from backup status UI

- **WHEN** the user selects a valid retained backup and chooses Restore
- **THEN** Tesina opens the standard Merge preview before any live data changes

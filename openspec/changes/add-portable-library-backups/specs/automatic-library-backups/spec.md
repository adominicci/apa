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
- **THEN** Tesina may show the optional setup card and all writing features
  remain available

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
locations.

#### Scenario: Restart after successful setup

- **WHEN** Tesina restarts after the wizard's test backup succeeded
- **THEN** it can access the selected folder for scheduled backups without
  asking the user to select it again

#### Scenario: User changes the folder

- **WHEN** the user chooses Change folder and completes a new test backup
- **THEN** subsequent backups use the new authorized folder and no longer write
  to the old folder

### Requirement: Validated test before enabling backup

Tesina SHALL enable automatic backup only after it writes a real archive inside
a dedicated `Tesina Backups` subfolder, validates the archive, and reopens its
manifest successfully.

#### Scenario: Test backup succeeds

- **WHEN** the selected folder accepts the write and the resulting archive
  passes validation
- **THEN** Tesina enables automatic backup and records the successful location
  and time

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

### Requirement: Observable backup state

After setup, Tesina SHALL show the selected location, last successful backup
time, current health, and actions to Back up now, Restore, Open backup folder,
Change folder, and Retry when applicable. A started write MUST NOT be reported
as successful.

#### Scenario: Backup succeeds

- **WHEN** the archive is durably written and passes validation
- **THEN** Tesina updates Last backup to that completion time and shows a
  healthy state

#### Scenario: Backup is still running

- **WHEN** archive creation or validation has not finished
- **THEN** the UI shows an in-progress state and preserves the previous last
  successful time

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

After a successful backup, Tesina SHALL retain the seven newest valid daily
archives it created in the dedicated backup folder. It SHALL prune only files
that match Tesina's backup naming contract and contain a valid Tesina manifest,
and SHALL never delete directories, temporary unknown files, manual exports, or
unrelated files.

#### Scenario: Eighth valid daily backup succeeds

- **WHEN** eight valid Tesina-owned daily backups exist after a new success
- **THEN** Tesina removes only the oldest recognized valid daily backup and
  retains the newest seven

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
network connection to create the local backup file.

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

# Rollback runbook — portable library archives and folder backups

Operational rollback procedure for the `add-portable-library-backups`
feature (task 12.9). Audience: whoever must react to a defect in export,
import, or automatic backups after this feature ships.

## Before a release is published

The release workflow leaves every release as a **draft**. If verification
fails at any point before publishing (updater artifacts, signatures,
`latest.json`, smoke tests), **stop and do not publish**. Users only receive
updates from published releases, so an unpublished draft is a complete
rollback by itself. Delete or park the draft and fix forward on a branch.

## After a release is published

Never unpublish or delete a shipped release (updaters may have already
served it). Roll back by **shipping a higher patch version** that:

1. Disables the affected entry points only — the Export library / Import
   library actions and/or the backup wizard, status card, and scheduler.
2. **Retains archive readability**: `portable/validate.ts` and the archive
   reader must keep accepting every `formatVersion: 1` archive so users can
   still restore their `.tesina` files.
3. **Retains startup import recovery** (`recoverPendingImports`) until every
   existing journal reaches `complete` or is rolled back. Removing recovery
   while unfinished journals exist would strand users in an inconsistent
   library.
4. Never deletes user-owned `.tesina` files, `$APPDATA/backups/imports/`
   rollback archives, unfinished `$APPDATA/imports/<tx>/` evidence, the
   Rust-owned `backup-directory.json`, or `backup-ledger.json`.

Disabling the backup UI does not affect local essays. If the backup
scheduler must be stopped remotely, the kill-switch patch simply does not
call `backup.start()`; the configured folder record stays in place so a
later fix can resume without re-authorization (the record alone grants
nothing until code uses it).

## Compatible versions

| Surface | Version | Compatibility promise |
| --- | --- | --- |
| `.tesina` archive | `formatVersion: 1` | readable by every app version ≥ the first release of this feature; newer format versions are rejected with a compatibility message, never misread |
| Import journal | `schemaVersion: 1` (two checksummed copies) | recovery must ship in every version until no v1 journals can exist |
| `backup-directory.json` | `schemaVersion: 1` | presence means configured; unknown versions load as unconfigured (fail closed, no deletion) |
| `backup-ledger.json` | `schemaVersion: 1` | unknown/missing ledger means retain-all; never prune without it |
| `settings.json` `backup` block | additive on schema 1 | unknown fields are dropped field-wise on load, never fail the file |

## Recovery-only behavior

A recovery-only build (worst-case kill switch) keeps exactly:
`recoverPendingImports` wired before interactivity, archive validation, and
the read side of the Rust adapter (`backup_status`, `backup_read_archive`,
`backup_ledger_entries`). Everything else may be feature-flagged off without
data risk.

## Diagnostics

The recovery-required UI offers a privacy-safe diagnostic export: error
codes, relative paths, hashes, and journal status only — never essay
content, user names, or absolute private folder names. Ask users for that
file, plus their app version and OS, before attempting manual repair.
Manual repair always starts from the retained rollback archive in
`$APPDATA/backups/imports/` — validate its checksum against the journal
before trusting it.

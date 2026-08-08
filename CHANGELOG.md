# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.3] - 2026-08-08

### Added

- Export your complete library — every essay, reference, collection, and
  figure — as one portable `.tesina` file you can copy, move, or keep
  anywhere. Tesina verifies the saved file by reopening it before reporting
  success.
- Import a `.tesina` file with a clear preview first: new content is added,
  identical content is skipped, and anything that differs is kept as a
  separate imported copy. Importing never replaces or deletes your current
  work, and an interrupted import is finished or undone safely the next time
  Tesina starts.
- Optional daily backups to one folder you choose — including folders synced
  by Google Drive, iCloud Drive, OneDrive, or Dropbox — set up through a
  five-step guided wizard in your language. Tesina keeps the seven newest
  backups from this computer, never touches anyone else's files, and shows
  you the last successful backup at a glance.
- Restore from a backup by merging it into your current library, so newer
  work is never rolled back or replaced.
- Backup files are complete and not password-protected; the wizard explains
  this clearly before anything is written.

## [0.1.2] - 2026-08-08

### Changed

- The editor now shows the paper as separate pages — title page, essay, and
  references — in the same order as the printed document, instead of one
  continuous sheet with dividers.
- New papers start with all of their pages visible, including a references
  page that shows a short note until the first source is added.

### Fixed

- When exporting to Word with an incomplete title page, the title page window
  now highlights what is missing in red, updates the message while you type,
  and finishes the export on its own after you save the corrected title page.

## [0.1.1] - 2026-08-07

### Fixed

- Opening a paper preview no longer changes the fonts in menus, panels, or other
  parts of the app.
- Improved the checks for app update downloads so broken update files are
  caught before a release reaches users.

## [0.1.0] - 2026-08-07

### Added

- Writing and formatting for APA 7 student papers on macOS 11 or newer, with
  independent English or Spanish choices for the interface and document.
- APA 7 student title pages, structured body sections, abstracts, appendices,
  five heading levels, lists, tables, figures, equations, and page numbering.
- In-text citations and a generated reference list, backed by a reusable
  reference library with collections, DOI, ISBN, and URL autofill, plus BibTeX
  import with a review step.
- Paged preview and Word export, with student title-page validation.
- Local atomic autosave and a timestamped backup before a paper is deleted. No
  account or cloud service is required.
- Optional in-app updates from published GitHub Releases. Installed release
  notes appear once in plain text after the app restarts.

### Fixed

- Kept student title pages and body-page titles consistent across the editor,
  preview, and Word export, including multiple authors and affiliations.
- Preserved citations and formatting inside tables, headings, and block quotes
  in previews and Word exports.
- Kept primary editor actions available at the app's supported window widths.
- Improved the reliability of installing updates and showing release notes
  after restart.

[Unreleased]: https://github.com/adominicci/apa/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/adominicci/apa/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/adominicci/apa/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/adominicci/apa/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/adominicci/apa/releases/tag/v0.1.0

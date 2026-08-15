# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.7] - 2026-08-14

### Changed

- Every dialog in Tesina now shares one look: a larger, clearer title, field
  edges you can actually see before you type, a selected option that stands
  out at a glance, and a footer that reads as part of the window frame.
- Colors, text sizes, and spacing across the interface now come from one
  shared set of values. Light surfaces carry a faint paper warmth instead of
  a flat gray.
- Dropdowns now open a Tesina list instead of the grey system menu, and they
  follow your theme. In the font picker each family previews itself, with its
  APA point size beside it. Arrow keys, Home, End, Escape, and type-to-jump
  all still work.
- On the cover-page form, the course and the instructor each get a full line.
  Side by side, the course placeholder was cut off mid-word.
- Buttons are now one shared set across the whole app instead of five
  near-copies. Sizes settle onto two steps, and a destructive action reads as
  quiet until you reach the step that actually does it, which is filled red.
- Backup settings has been rebuilt around one status panel that answers
  whether your work is safe before anything else, a single obvious action,
  and separate Folder and Advanced sections. The backup path is no longer
  the loudest thing on the screen, and the window now has a Close button.

### Fixed

- The Insert citation button no longer turns its label near-black while you
  point at it in light mode. The label stayed readable in dark mode, so this
  only affected light.
- Font, Heading, List, Table, and Focus buttons in the toolbar keep their
  highlight while you point at them, so an open menu still looks open.
- The recovery notice no longer paints a cream strip that ignored your theme.
- Dropdowns and date fields no longer sit a few pixels shorter than the text
  boxes stacked next to them.
- The Back, Cancel, and Retry buttons in the backup setup wizard were drawn
  with no background or border at all. They look like buttons now.
- Keyboard focus outlines follow each control's own shape instead of being
  forced into the same rounded corner.

## [0.1.6] - 2026-08-10

### Fixed

- Tesina now checks the correct published release feed when looking for updates
  at startup.

## [0.1.5] - 2026-08-09

### Fixed

- Backups can now be set up when a paper contains website links. Tesina still
  blocks links that could run code when it checks a backup file.

## [0.1.4] - 2026-08-09

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

## [0.1.3] - 2026-08-09

### Changed

- Essays now flow automatically from one US Letter page to the next while you
  write, with the title page, body, references, and appendices staying in order.
- Release notes now show formatted headings and lists while unsafe links and
  embedded content remain blocked.
- The installed version is always available on the home screen and in the
  editor status bar, where it can reopen that version's release notes at any
  time.

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

[Unreleased]: https://github.com/adominicci/tesina/compare/v0.1.6...HEAD
[0.1.6]: https://github.com/adominicci/tesina/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/adominicci/tesina/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/adominicci/tesina/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/adominicci/tesina/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/adominicci/tesina/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/adominicci/tesina/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/adominicci/tesina/releases/tag/v0.1.0

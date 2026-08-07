# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-08-07

### Added

- Student-paper writing and formatting for macOS 11 or newer, with independent
  English or Spanish choices for the interface and document.
- APA 7 student title pages, structured body sections, abstracts, appendices,
  five heading levels, lists, tables, figures, equations, and page numbering.
- In-text citations and a generated reference list, backed by a reusable
  reference library with collections, DOI, ISBN, and URL autofill, and reviewed
  BibTeX import.
- Paged print and PDF preview, plus Word export with student title-page
  validation.
- Local autosave, atomic file writes, and backups. No account or cloud service
  is required.
- Optional in-app updates from published GitHub Releases. Installed release
  notes appear once in plain text after the app restarts.

### Fixed

- Kept student title pages and body-page titles consistent across the editor,
  preview, and Word export, including multiple authors and affiliations.
- Preserved rich table-cell content, run-in heading content, block quotes, and
  document order across preview and Word export.
- Kept primary editor actions available at the app's supported window widths.
- Made updater installation state and restart-time release notes resilient to
  overlapping checks and storage failures.

### Verified

- The release suite passes 476 automated tests covering the APA engine, app,
  preview, persistence, updater, and Word export.

[Unreleased]: https://github.com/adominicci/apa/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/adominicci/apa/releases/tag/v0.1.0

## Why

Tesina's editor currently gives each document section one paper-shaped surface, so a long essay body grows into an unbounded sheet instead of behaving like a word processor. Release notes are also displayed as literal Markdown and become inaccessible after their one-time post-update dialog is dismissed.

## What Changes

- Paginate the live, editable APA document into a scrolling stack of fixed US Letter pages, automatically reflowing content from page to page as the user writes without manual page breaks or stored page boundaries.
- Keep the title page, abstract, body, references, and appendices in document order while allowing every content-bearing section to continue across as many pages as required.
- Show the derived APA page number at the top right of every live sheet, beginning with page 1 on the title page, without adding numbering to essay data or copied text.
- Render release-note Markdown as formatted, sanitized content through a reusable component.
- Preserve the automatic one-time post-update release-note dialog and bundle the installed version's notes so they remain available afterward.
- Show the actual installed version on the home screen and in the editor status bar; clicking either version control opens the installed version's notes.
- Ship the user-visible changes as version 0.1.3 with synchronized version surfaces, plain-language changelog notes, updater artifacts, and a published release.

## Capabilities

### New Capabilities

- `live-editor-pagination`: Automatic US Letter pagination and reflow inside the single editable APA document, including derived references, sequential live page numbers, and content-fragmentation rules.
- `release-notes-access`: Safe Markdown rendering, one-time post-update presentation, persistent current-version access, and clickable version controls on the home and editor surfaces.

### Modified Capabilities

None.

## Impact

- Live editor composition, ProseMirror decorations/plugins, page measurement, editor page counting, and editor CSS.
- Release-note parsing/rendering, root layout state, application-version resolution, home sidebar, editor status bar, localization messages, and accessibility behavior.
- Desktop dependencies if a runtime Markdown parser/sanitizer is selected; any addition must use a permitted MIT, Apache-2, ISC, BSD, or OFL license.
- Unit, component, pagination, visual/native, preview/export parity, release-contract, and updater tests.
- Version metadata, README, changelog, tag, draft-release verification, updater manifest, and public macOS release for 0.1.3.

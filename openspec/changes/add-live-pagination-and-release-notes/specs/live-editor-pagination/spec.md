## Purpose

Define a word-processor-style editing surface where APA content remains one editable document while flowing automatically across correctly sized paper pages.

## ADDED Requirements

### Requirement: Automatic US Letter page flow
The editor SHALL display the paper as a vertically scrolling sequence of 8.5 by 11 inch pages with one inch margins, and SHALL automatically move overflowing content onto additional pages without requiring or storing manual page breaks.

#### Scenario: Body grows beyond one page
- **WHEN** editable body content exceeds the printable area of its current page
- **THEN** the overflow continues on the next visible US Letter page
- **THEN** both pages remain part of one continuous editing surface

#### Scenario: Content is removed
- **WHEN** deleting content makes a later page unnecessary
- **THEN** the remaining content flows backward
- **THEN** the empty trailing page is removed automatically

#### Scenario: New paper opens
- **WHEN** a new paper is created
- **THEN** the title page, initial body page, and empty references page are visible in document order
- **THEN** each visible page uses US Letter geometry

### Requirement: Pagination is derived presentation
Automatic page boundaries SHALL be derived from current layout and SHALL NOT add page nodes, break markers, or schema-version changes to persisted essay content.

#### Scenario: Paginated essay is saved
- **WHEN** an essay spanning multiple live pages is saved and reopened
- **THEN** its authored ProseMirror JSON is unchanged by pagination metadata
- **THEN** the same page flow is recalculated from the reopened content and settings

#### Scenario: Existing schema-version 2 essay opens
- **WHEN** an existing schema-version 2 essay created before live pagination is opened
- **THEN** it remains visible and editable without migration
- **THEN** live page flow is calculated for its existing content

### Requirement: Visual zoom does not change document layout
The editor SHALL calculate pagination at canonical paper dimensions and SHALL use visual scaling only to fit narrower application windows.

#### Scenario: Window width changes
- **WHEN** the editor canvas becomes narrower or wider
- **THEN** the pages may be visually scaled to fit
- **THEN** line wrapping, automatic page boundaries, and total page count remain unchanged

### Requirement: Section order and starts remain APA-aware
The title page, optional abstract, body, references, and appendices SHALL remain in document order, and each APA section that starts on a new page SHALL do so while long sections continue across subsequent pages.

#### Scenario: Long body precedes references
- **WHEN** the body spans multiple pages and references are present
- **THEN** the references section starts on the page after the body ends
- **THEN** no body content is lost, duplicated, or moved after references

#### Scenario: Long appendix flows
- **WHEN** an appendix exceeds one printable page
- **THEN** it continues across additional pages before the next appendix begins

#### Scenario: References change
- **WHEN** cited references are added, removed, or reformatted
- **THEN** the derived references pages repaginate in their existing position between the body and appendices

### Requirement: Pagination respects content fragmentation rules
The editor SHALL split ordinary text at line boundaries, SHALL avoid isolated first or last paragraph lines where space permits, and SHALL keep non-splittable content together when it fits on one page.

#### Scenario: Paragraph crosses a page boundary
- **WHEN** a paragraph cannot fit in the remaining printable area
- **THEN** it continues at a line boundary on the next page
- **THEN** the continuation is not treated as a new authored paragraph

#### Scenario: Heading approaches a page boundary
- **WHEN** a heading fits but the first line of its following content does not
- **THEN** the heading moves with following content to the next page

#### Scenario: Figure or equation does not fit remaining space
- **WHEN** a figure or block equation fits within a full printable page but not in the current page's remaining area
- **THEN** the whole element moves to the next page

#### Scenario: Table crosses a page boundary
- **WHEN** a table exceeds the current page's remaining area
- **THEN** it continues at a row boundary
- **THEN** an individual row that fits within a full page is not split

#### Scenario: Content is taller than a printable page
- **WHEN** a single non-splittable element is taller than the printable area
- **THEN** pagination terminates without an infinite reflow loop
- **THEN** the editor keeps the content visible and provides a deterministic overflow treatment

### Requirement: Editing remains continuous across pages
Pagination SHALL preserve normal cursor movement, selection, copy and paste, drag selection, undo and redo, input methods, citations, and autosave across visual page boundaries.

#### Scenario: User types across a boundary
- **WHEN** typing causes the current line to move to the next page
- **THEN** the caret remains at the expected document position
- **THEN** typing continues without focus loss or selection reset

#### Scenario: User selects across pages
- **WHEN** the user selects text beginning on one page and ending on another
- **THEN** the selection remains continuous and can be copied, cut, or formatted as one range

#### Scenario: User undoes a pagination-changing edit
- **WHEN** an authored edit changes page flow and the user invokes undo
- **THEN** the authored edit is undone once
- **THEN** derived pagination changes do not appear as separate undo steps

### Requirement: Live page count reflects the paginated document
The editor status bar SHALL show the total number of currently rendered document pages without requiring the user to open print preview.

#### Scenario: Page count changes while typing
- **WHEN** an edit adds or removes a live page
- **THEN** the status-bar page count updates after pagination settles

#### Scenario: Whole paper is counted
- **WHEN** the paper contains a title page, body pages, references pages, and appendices
- **THEN** the live page count includes every visible document page exactly once

### Requirement: Live pages show APA page numbers
Every live sheet SHALL show its derived sequential page number in the top-right page margin, beginning with page 1 on the title page, without storing, copying, or exporting the live page-number decoration as authored content.

#### Scenario: Whole paper is numbered
- **WHEN** a paper contains a title page, multiple authored pages, reference pages, and appendices
- **THEN** every visible sheet shows one sequential number in document order
- **THEN** the title page shows page 1

#### Scenario: Pagination changes
- **WHEN** editing adds or removes a page before later content
- **THEN** later live page numbers update automatically after pagination settles
- **THEN** undo history and saved ProseMirror JSON contain no page-number data

#### Scenario: Page chrome is copied or read
- **WHEN** content spanning live pages is copied or traversed with assistive technology
- **THEN** page gaps and visual page numbers do not enter the copied text or interrupt the authored reading order

### Requirement: Editor, preview, and export share page geometry
The editor, Tesina preview, and Word export SHALL use the same configured paper size, margins, document font, font size, and line spacing, while acknowledging that Microsoft Word performs its own final repagination.

#### Scenario: Deterministic pagination fixture is rendered
- **WHEN** a fixture uses available fonts and supported blocks with stable dimensions
- **THEN** the live editor and Tesina preview produce the same page count and section order

#### Scenario: Paper is exported to Word
- **WHEN** the user exports a paginated paper
- **THEN** Word receives the same paper size, margins, font, font size, and spacing
- **THEN** automatic editor page boundaries are not serialized as manual Word page breaks

### Requirement: Pagination failure cannot damage editing or data
The editor SHALL remain editable and save authored content if measurement or pagination cannot complete.

#### Scenario: Layout measurement fails
- **WHEN** pagination encounters an unexpected DOM measurement or asset-loading failure
- **THEN** the editor retains the last stable pagination or a safe continuous fallback
- **THEN** authored content, autosave, and export remain available

#### Scenario: No stable plan exists yet
- **WHEN** first-pass pagination is still settling or cannot produce a stable plan
- **THEN** the status bar does not present a words-based estimate as an exact page count
- **THEN** it exposes a localized pending or unavailable state until a stable count exists

### Requirement: Pagination remains responsive during editing
Pagination SHALL coalesce layout work outside authored input transactions, cancel superseded work, and avoid committing stale plans or visibly oscillating between page layouts.

#### Scenario: User types rapidly
- **WHEN** several edits occur before an earlier measurement pass completes
- **THEN** the caret and input remain responsive
- **THEN** stale epochs are discarded and only the newest stable plan is painted

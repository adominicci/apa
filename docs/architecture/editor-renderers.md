# Editor and renderer contract

This document records Tesina's current implementation contract for authored
document content and its live editor, paged HTML/PDF, and DOCX renderers. It is
an architecture reference, not an independent statement of APA rules. When a
formatting rule changes, the implementation and focused tests remain the source
of truth.

## One semantic document, several derived surfaces

An essay has one persisted semantic model:

```text
Essay (schemaVersion: 2)
├── settings
├── titlePage
├── referencesSnapshot
└── content: ProseMirror JSON
    └── doc
        ├── sectionAbstract?  -> paragraph+ keywordsLine?
        ├── sectionBody      -> (block | equationBlock)+
        └── sectionAppendix* -> (block | equationBlock)+
```

`titlePage` is form data, not a ProseMirror section. The references page is
derived from resolved references and citations; it is not stored in `content`.
Page numbers, page gaps, appendix letters, body-title compatibility chrome,
formatted citation text, and table, figure, and equation numbers are also
derived.

The custom block shapes persisted inside body or appendix sections are:

- `apaTable -> tableTitle table tableNote`
- `figure -> figureTitle figureImage figureNote`
- `apaEquation`, an atom with a `latex` attribute
- `orderedList`, with an optional `listStyle` attribute whose semantic values
  are `decimal` and `lower-alpha`

The abstract deliberately has the narrower `paragraph+ keywordsLine?` shape;
tables, figures, equations, headings, lists, and block quotes are not valid
abstract children. StarterKit supplies the ordinary paragraphs, headings, lists,
block quotes, inline marks, and hard breaks used by the custom sections.

`ensureSectionedDoc` wraps older flat ProseMirror documents in a `sectionBody`.
Unrecognizable content falls back to one empty body paragraph instead of
crashing the editor.

### Schema version policy

The essay envelope remains `schemaVersion: 2`. Adding a compatible ProseMirror
node or attribute is additive and does not bump the version. Do not store
derived presentation merely to avoid recalculating it; doing so would turn a
renderer concern into a persistence migration.

## Surface responsibilities

| Surface       | Responsibility                                                                                                                            | Must not become persisted content                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Live editor   | Edit the ProseMirror tree and show document-aware chrome, reference pages, pagination gaps, and page numbers                              | Decorations, pseudo-element labels, page geometry, menu controls, warnings, and ghost table gridlines |
| Paged preview | Convert the essay and resolved assets to escaped, print-ready HTML plus scoped CSS, then paginate it with Paged.js                        | Blob URLs and generated MathML                                                                        |
| PDF export    | Reuse the preview HTML/CSS and Paged.js layout, then send static paginated markup and the expected page count to the native print command | Data URLs, temporary print markup, and native job state                                               |
| DOCX export   | Convert the same semantic input to Word paragraphs, tables, numbering, images, OMML, styles, headers, and page breaks                     | Tauri APIs, filesystem paths, DOM nodes, blob URLs, and data URLs                                     |

Semantic parity does not mean identical DOM or pixel layout. The live editor
uses one continuous editable ProseMirror flow; preview/PDF use Paged.js; DOCX
uses Word primitives. The surfaces must agree on content, ordering, labels,
numbering, supported formatting, and explicit fallbacks.

## Canonical document order

Preview, PDF, and DOCX render in this order:

1. title page;
2. optional abstract;
3. body;
4. references, when the resolved reference list has entries;
5. appendices in authored order.

The live editor represents the title page separately and inserts a derived,
non-editable reference-page decoration before the first appendix. The reference
decoration must not change `editor.getJSON()` or interfere with selection and
appendix editing.

The body title is also derived when the body does not already begin with a
level-1 heading whose normalized plain text matches `titlePage.title`. A
matching authored heading is preserved for schema-v2 compatibility and the
synthetic duplicate is omitted on every renderer.

## Cross-surface block contract

| Semantic content                             | Live editor                                                                                                                                     | Paged HTML and PDF                                                                                                        | DOCX                                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Abstract, body, appendices                   | Section nodes remain the editable structure; localized headings and appendix letters are derived chrome                                         | Localized headings are emitted from document terms; sections receive page-break rules                                     | Localized heading paragraphs use page breaks; appendices are emitted after references                                             |
| Paragraphs and headings 1-3                  | `apa.css` controls indentation, weight, alignment, and the selected document font size                                                          | `renderEssayCss` applies the corresponding scoped document rules                                                          | Named paragraph styles carry the equivalent run and paragraph properties                                                          |
| Heading 4 or 5 followed by a paragraph       | A decoration makes the two authored nodes appear as one run-in paragraph and supplies only missing punctuation                                  | The heading and following paragraph are merged, with level 5 bold italic                                                  | The heading and following paragraph are emitted as one paragraph, with level 5 bold italic                                        |
| Heading 4 or 5 without a following paragraph | It remains an authored heading block                                                                                                            | It becomes a standalone run-in-style paragraph with a terminal period                                                     | It becomes a standalone run-in-style paragraph with a terminal period                                                             |
| Citation atom                                | A node view formats it through `@tesina/engine` using live references and document locale                                                       | The HTML visitor formats it through the same engine context                                                               | The DOCX visitor formats it through the same engine context                                                                       |
| Ordered or bullet list                       | CSS derives marker style from list kind, `listStyle`, and nesting                                                                               | HTML `ol` types cascade `1 -> a -> i`; the lettered seed starts at `a`                                                    | Numbering definitions cascade decimal, lower letter, and lower roman; list instances restart independently                        |
| `apaTable`                                   | Required title/table/note children remain editable; numbering and localized labels are CSS counters; dashed cell borders are editing aids       | Renderer emits a caption, structural table, and a non-empty note; the table counter advances in traversal order           | Renderer emits caption paragraphs, a Word table, and a non-empty note; authored spans and usable column proportions are preserved |
| `figure`                                     | The relative image path is resolved to an object URL; the required image atom cannot be deleted independently; numbering and labels are derived | A resolved image URL is emitted when available; caption and non-empty note remain if the image is missing                 | Pre-read image bytes are embedded and scaled when usable; caption and non-empty note remain if the image is absent or invalid     |
| `apaEquation`                                | Temml renders MathML; invalid LaTeX falls back to raw text; the same OMML mapper marks valid equations that DOCX cannot preserve                | Pre-rendered MathML is inserted when available, otherwise escaped raw LaTeX is shown; the equation number is pinned right | A supported MathML tree becomes native OMML; absent or unsupported trees fall back to raw LaTeX without failing the document      |
| References                                   | A non-editable decoration uses the engine's formatted runs and can show an editing-only empty state                                             | A references section is emitted only when the engine returns entries                                                      | A references heading and hanging-indent entries are emitted only when the engine returns entries                                  |

An empty table or figure note can still show its localized prefix in the editor
because the required node must remain editable. Preview/PDF and DOCX omit the
empty note paragraph. Missing figure assets and unsupported equations are
localized failures of one block, not reasons to abort the whole render.

## Computed numbering and presentation

Numbers are never stored on table, figure, equation, or appendix nodes.

| Sequence      | Persisted seed                      | Live editor                                                  | Paged HTML and PDF                                      | DOCX                                                   |
| ------------- | ----------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------ |
| Tables        | none                                | `apa-table` CSS counter                                      | shared `tableNo` render state                           | shared `tableCounter` visit state                      |
| Figures       | none                                | `apa-figure` CSS counter                                     | shared `figureNo` render state                          | shared `figureCounter` visit state                     |
| Equations     | `latex` only                        | `apa-equation` CSS counter                                   | shared `equationNo` render state                        | shared `equationCounter` visit state                   |
| Appendices    | authored order only                 | decoration adds `A`, `B`, ... only when more than one exists | renderer derives letters only when more than one exists | visitor derives letters only when more than one exists |
| Ordered lists | list kind plus optional `listStyle` | CSS derives the tested nesting cycle                         | recursive HTML visitor derives `type` by depth          | Word numbering reference and level derive the marker   |

Each complete render starts its counters at the beginning of the document and
shares them while walking body and appendices, including nested block quotes and
table cells where the schema permits those blocks. Inserting, deleting, or
moving a block therefore renumbers all later blocks without a data migration.

Citation display text and first-occurrence group behavior follow the same rule:
the stored citation attributes identify sources, while the engine computes
visible runs from the complete citation context and document order.

## Localization has two independent axes

| Axis                  | Source                            | Owns                                                                                                                                                                          |
| --------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application UI locale | `uiLocale` and Paraglide          | Buttons, menus, dialogs, status, errors, file filters, and other application chrome                                                                                           |
| Document language     | `essay.settings.documentLanguage` | Document headings and labels, title-page date, citation and reference formatting, reference ordering, table/figure/note terms, and exported document text generated by Tesina |

The live document passes its language through `data-doclang` for CSS-generated
labels and through engine environments for citations and references. Preview and
DOCX call `getTerms(documentLanguage)`. Equation numbers are deliberately
language-neutral.

Changing the application UI locale must not rewrite or reformat the document.
Changing the document language refreshes derived citations, references, labels,
and pagination, but must not translate authored text or change the ProseMirror
structure.

## Relative assets and the pure DOCX boundary

`figureImage.attrs.src` stores a relative essay asset path under
`essays/assets/` (new assets use `<uuid>.<extension>` filenames). A persisted
document must never contain a blob URL, data URL, or absolute machine path.

The application layer adapts that relative path for each consumer:

- the live editor and on-screen preview resolve it to a temporary object URL;
- PDF export reads the bytes and produces a self-contained data URL for the
  hidden print document;
- DOCX export reads and measures the bytes, then supplies an `ExportImage` to
  the pure package, keyed by the original relative `src`.

`packages/docx-export/src/input.ts` is the sanctioned boundary. The package
receives structural ProseMirror JSON, document settings, title-page data,
resolved references, image bytes and dimensions, and serializable MathML trees.
It does not import the desktop application, call Tauri or filesystem APIs, parse
with browser DOM APIs, or receive data URLs. The application owns DOM-dependent
Temml parsing and turns the result into `MathNode`; the package owns the
conservative MathML-to-OMML mapping and raw-LaTeX fallback.

## Pagination and PDF reuse

The live editor uses a fixed 816 by 1056 pixel Letter coordinate system with 96
pixel margins and a 624 pixel content column. It stays one continuous editable
flow; derived gaps and page-number decorations paint pagination without creating
authored page nodes. Editor-only overflow affordances keep oversize atomic
blocks reachable without changing the saved document.

Paged preview derives `@page` size, margins, selected font, headers, and page
breaks from essay settings. PDF export calls the same `renderEssayHtml` and
`renderEssayCss`, resolves self-contained assets, and runs the same Paged.js
layout. It then sends already-paginated static HTML, the expected page count,
and matching paper dimensions in PostScript points to the Rust command. The
native side owns the hidden webview and final file write; it does not implement
APA rendering.

The live editor is currently fixed to Letter geometry even though preview, PDF,
and DOCX accept `us-letter` or `a4`. Do not use live-editor pixel parity as
proof of A4 output geometry; verify A4 in the output renderer concerned.

## Change checklist

When adding or changing a ProseMirror block or mark:

1. define or update the schema, commands, parsing, and migration fallback;
2. update live editor CSS, node views, and derived decorations without storing
   renderer-only state;
3. update `renderEssayHtml` and `renderEssayCss`, including escaped fallbacks;
4. update preview/PDF asset collection when the block references external bytes
   or requires DOM-dependent preprocessing;
5. update the sanctioned DOCX input only when new resolved data must cross the
   pure-package boundary, then update its visitor, blocks, styles, or math
   mapper;
6. add focused parity tests for every affected surface and a native packaged
   proof when browser or print-engine behavior is part of the contract.

## Verification matrix

| Contract                                                                           | Focused evidence                                                                                    |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Sectioned schema and compatibility wrapping                                        | `apps/desktop/src/lib/editor/migrate.test.ts`                                                       |
| Table, figure, and equation schema/command boundaries                              | `tableCommands.test.ts`, `figureCommands.test.ts`, `equationCommands.test.ts`                       |
| Live geometry, indentation, special blocks, and derived presentation               | `apaCss.test.ts`, `referenceDecoration.test.ts`, and the focused `editor/pagination` suite          |
| Paged HTML structure, ordering, localization, numbering, lists, fallbacks, and CSS | `apps/desktop/src/lib/preview/renderEssayHtml.test.ts` and its snapshot                             |
| Figure and MathML asset adaptation                                                 | `apps/desktop/src/lib/export/exportAssets.test.ts`, `apps/desktop/src/lib/editor/mathml.test.ts`    |
| DOCX structure, styles, ordering, counters, nested content, images, and fallbacks  | `packages/docx-export/test/export.test.ts`, `body-title.test.ts`, `math.test.ts`                    |
| PDF adapter ordering, page-count handoff, paper dimensions, and error propagation  | `apps/desktop/src/lib/export/exportPdf.test.ts` and the Rust tests in `src-tauri/src/pdf_export.rs` |
| WKWebView/Paged.js behavior that DOM tests cannot prove                            | the focused native pagination proof plus a packaged application preview/PDF smoke test              |

For a shared renderer change, run the smallest affected focused tests first,
then the repository-required `deno task check` and `deno task test` gates. A
green unit suite does not replace packaged proof when the change depends on
Tauri, WKWebView, native fonts, Paged.js, or the PDF print pipeline.

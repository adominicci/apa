# List Block Formatting Design

## Purpose

Make list content structurally consistent from the TipTap document through the
editor, print preview, and DOCX export while preserving Tesina's existing
APA-compliant paragraph indentation.

The normal paragraph after a list is not defective: its first line remains
indented 0.5 inch from the document margin. The defects are confined to list
items containing more than one paragraph or another supported block.

## Standards Boundary

The implementation follows these verified public APA rules:

- Ordinary body paragraphs use a 0.5-inch first-line indent.
- Reference entries use a 0.5-inch hanging indent.
- Block quotations are offset 0.5 inch without a first-line indent.
- Abstract opening paragraphs, headings, table and figure labels, cells, and
  notes retain their existing special formatting.
- List indentation is scoped to the list. Exiting a list creates an ordinary
  body paragraph and does not carry list indentation forward.

APA's public list pages do not prescribe exact marker tab stops or nested-list
geometry. Tesina will therefore retain its current top-level list text position
and 0.5-inch nested-level increments rather than inventing a new measurement.

Official sources:

- <https://apastyle.apa.org/style-grammar-guidelines/paper-format/paragraph-format>
- <https://apastyle.apa.org/style-grammar-guidelines/lists/numbered>
- <https://apastyle.apa.org/style-grammar-guidelines/lists/bulleted>
- <https://apastyle.apa.org/style-grammar-guidelines/citations/quotations>
- <https://apastyle.apa.org/style-grammar-guidelines/references/basic-principles/reference-list-format-and-order>
- <https://apastyle.apa.org/style-grammar-guidelines/tables-figures/tables>
- <https://apastyle.apa.org/style-grammar-guidelines/tables-figures/figures>

## Current Failure

TipTap list items can contain a leading paragraph followed by continuation
paragraphs, nested lists, and supported block nodes. The editor preserves that
tree and correctly removes first-line indentation from list-item paragraphs.

The other renderers currently reinterpret every non-list child as inline text:

- Preview concatenates all paragraph content directly inside one `li`, losing
  paragraph boundaries. Non-inline blocks can disappear.
- DOCX applies the list marker to every non-list child, so a continuation
  paragraph becomes another numbered or bulleted item. Special blocks can
  become empty marked paragraphs.

Both failures come from list-specific traversal bypassing each renderer's
ordinary block dispatcher.

## Design

### Shared rendering invariant

For every list item:

1. The first paragraph owns the list marker.
2. Later paragraphs remain part of the same item, align with the item text, and
   have no additional marker or first-line indent.
3. Nested lists recurse at the next list depth.
4. Supported non-list blocks use the same renderer and counters they use at the
   document body level, without acquiring a list marker.
5. After the list ends, the next body paragraph uses the ordinary 0.5-inch
   first-line indent.

### Preview

Refactor block rendering so list traversal can delegate supported block nodes
to the normal HTML renderer rather than calling `inlineHtml` on every child.
Emit explicit paragraph elements inside each list item. The first paragraph
participates in the browser's list-marker layout; continuation paragraphs and
special blocks remain children of the same `li`.

Preview CSS will make list-item paragraphs marginless and unindented while
leaving the existing `ul`/`ol` geometry intact. The global body paragraph rule
continues to apply after the closing list.

### DOCX

Separate the marker-bearing first paragraph from continuation content. The
first paragraph retains the existing numbering or bullet properties.
Continuation paragraphs receive a dedicated list-continuation paragraph
format: left aligned to the current list level's text position, with neither a
marker nor a first-line/hanging indent.

Nested lists keep the existing decimal, lower-letter, and lower-Roman cycle.
Supported table, figure, and equation children delegate to the existing DOCX
block builders so counters, captions, image handling, and equation numbering
remain authoritative in one place.

### Editor

No editor behavior or list geometry changes are planned. Its existing rule that
list-item paragraphs have zero first-line indent is the desired behavior. A
regression assertion will lock that boundary alongside the preview and DOCX
tests.

## Testing

Tests will be written and observed failing before production changes.

The cross-renderer fixture will include:

- an ordered item with a continuation paragraph;
- a nested list following that continuation;
- a supported special block within a list item;
- a normal body paragraph immediately after the list;
- existing tables, figures, equations, block quotations, headings, abstract,
  and references outside lists.

Preview assertions will verify semantic element boundaries, marker counts,
special-block presence, nested-list structure, and the CSS reset for list-item
paragraphs. DOCX assertions will verify that only the first list paragraph has
numbering, continuation paragraphs use the correct indent without numbering,
special blocks remain present, and the post-list paragraph uses `BodyText`.

The final gate is the repository-required sequence from the worktree root:

```sh
deno task check
deno task test
deno fmt --check
deno lint
```

## Scope Exclusions

- No change to top-level or nested-list measurements.
- No schema-version change.
- No new node types, dependencies, user-facing strings, or Tauri capabilities.
- No redesign of level 4–5 heading editing; their editor/output parity is a
  separate concern.
- No changes to already-compliant table, figure, quotation, abstract, or
  reference formatting outside regression coverage.

## Success Criteria

- A list item retains all of its paragraphs and supported blocks in preview and
  DOCX.
- One logical item produces exactly one marker at that depth.
- Nested list numbering and indentation remain unchanged.
- The paragraph following a list retains the normal APA body style.
- Existing special-format output remains byte- or structure-equivalent except
  where the corrected list fixture deliberately adds content.
- All repository verification commands complete without errors or warnings.

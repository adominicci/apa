# Proposal: add-node-name-contract

## Why

ProseMirror node names (`apaTable`, `tableTitle`, `figureTitle`, `sectionBody`,
`keywordsLine`) exist as 184 bare string literals across ~44 files in two
packages. The names are minted in the schema (`editor/blocks.ts`) but every
consumer — HTML preview, DOCX visitor, portable validation, pagination, and 27
test files — re-types them by hand. The AGENTS.md invariant that block behavior
stays aligned across renderers is enforced by grepping humans, not by types; a
single rename or added node silently misses sites.

## What Changes

- Add a frozen `NODE_NAMES` const (and derived union type) to
  `packages/apa-engine/src` — already the zero-dependency package both
  `apps/desktop` and `packages/docx-export` import.
- Replace every bare literal with a `NODE_NAMES.*` reference across all
  production files (~17) and test/fixture files (~27), including the pagination
  proof harness and docx-export's hand-written parallel switch.
- Zero behavior change: same strings, same outputs; golden DOCX/preview
  snapshots and the full suite must pass without expectation edits.

Pure internal refactor — no schema, storage, or user-visible change;
`skip_specs` applies.

## Capabilities

### New Capabilities

None — no spec-level behavior changes.

### Modified Capabilities

None.

## Impact

- `packages/apa-engine/src` — one new module (nodeNames.ts) + export.
- ~17 production files across apps/desktop and packages/docx-export (full list
  held in design.md).
- ~27 test/fixture files — mechanical literal replacement only.
- No dependency graph changes; no Rust, CSS, Paraglide, or storage changes.

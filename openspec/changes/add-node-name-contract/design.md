# Design: add-node-name-contract

## Context

Census at approval time (Slice A): 230 quoted literals across 46 files —
`sectionBody` ×104, `tableTitle` ×40, `apaTable` ×46, `figureTitle` ×24,
`keywordsLine` ×16. Production files (19) and tests/fixtures (27) listed in
D6. `packages/docx-export` already imports from `@tesina/engine`; the engine's
own `check/apa-check.ts` references two of the names. No CONTEXT.md or ADRs
exist; AGENTS.md requires schema/preview/DOCX alignment but names no owner.

## Goals / Non-Goals

**Goals:**
- One frozen const owns the vocabulary; renames/typos become type errors.
- Every quoted literal replaced, production and tests alike (Slice A).
- Zero behavior change; golden snapshots pass without expectation edits.

**Non-Goals:**
- Renaming any node.
- Extending the contract to StarterKit node names (`table`, `bulletList`, …)
  that blocks.ts also declares — document the inclusion rule instead.
- Refactoring docx-export's parallel switch structure (only its string cases
  become constants).
- Adding runtime validation or a registry API.

## Decisions

**D1 · Shape:**
```ts
export const NODE_NAMES = {
  apaTable: "apaTable",
  tableTitle: "tableTitle",
  figureTitle: "figureTitle",
  sectionBody: "sectionBody",
  keywordsLine: "keywordsLine",
} as const;
export type ApaNodeName = (typeof NODE_NAMES)[keyof typeof NODE_NAMES];
```
Key mirrors value so property access reads identically to the old literal at
every call site (`node.type.name === NODE_NAMES.apaTable`). Alternative —
derived-from-schema types — rejected: the schema lives in app code and the
engine must stay dependency-free.

**D2 · Home: `packages/apa-engine/src/nodeNames.ts`, re-exported via index.ts.**
Engine is already the shared leaf of both consumers and itself references two
of these names in `check/apa-check.ts`. Module header documents the inclusion
rule: names minted by Tesina's custom APA schema only; StarterKit names are
deliberately excluded.

**D3 · Mechanical replacement only.** Each `"name"` literal becomes
`NODE_NAMES.name`. No logic motion, no signature changes, no test-expectation
edits. Switch cases, object values, comparisons, and fixture `type:` fields all
qualify; object keys and identifiers never do.

**D4 · Proof of ownership (amended during verification).** The original
hypothesis — corrupting one `NODE_NAMES` value must fail `deno task check` —
was tested and **disproved**: ProseMirror surfaces node names as plain
`string`, so literal-overlap errors never fire at read sites
(`node.type.name === NODE_NAMES.x` compares two widened strings), and full
coverage means a corrupted value renames schema and fixtures together,
preserving consistency by construction. That consistency IS the deliverable:
the contract makes partial renaming impossible at the source level. The proof
of ownership is therefore the **census**: zero quoted literals outside the
module itself (verified 230 → 0). Full static enforcement would require typing
every ProseMirror read site — out of scope, noted as future work.

**D5 · Import style.** Consumers import `{ NODE_NAMES }` from `@tesina/engine`
(or relative path inside the engine package itself). In app code where other
engine imports already exist, extend the existing import statement rather than
adding a second one.

**D6 · Authoritative file list (45 + the module).**

Production (17):
`apps/desktop/src/lib/editor/blocks.ts`, `sections.ts`, `outline.ts`,
`migrate.ts`, `tableCommands.ts`, `model/essay.ts`,
`editor/pagination/measure.ts`, `editor/pagination/proof/nativeProof.ts`,
`editor/pagination/proof/longDocumentFixture.ts`,
`lib/portable/validate.ts`, `portable/fixtures/libraries.ts`,
`preview/renderEssayHtml.ts`, `packages/apa-engine/src/check/apa-check.ts`,
`packages/docx-export/src/blocks.ts`, `body-title.ts`, `pm-visitor.ts`,
`sample.ts`.

Tests/fixtures (28): `EditorLaunch.test.ts`, `EditorScreen.test.ts`,
`apaCheck.test.ts`, `citedRefs.test.ts`, `createEditorFocus.test.ts`,
`equationCommands.test.ts`, `figureCommands.test.ts`, `mathml.test.ts`,
`migrate.test.ts`, `pagination/extension.test.ts`, `pagination/measure.test.ts`,
`pagination/performanceBudget.test.ts`,
`pagination/proof/longDocumentFixture.test.ts`, `referenceDecoration.test.ts`,
`tableCommands.test.ts`, `export/exportAssets.test.ts`, `model/essay.test.ts`,
`model/reconcile.test.ts`, `portable/archive.test.ts`,
`portable/importPlan.test.ts`, `portable/remap.test.ts`,
`portable/semantic.test.ts`, `portable/validate.test.ts`,
`preview/renderEssayHtml.test.ts`, `state/essays.svelte.test.ts`,
`packages/apa-engine/test/apa-check.test.ts`,
`packages/docx-export/test/body-title.test.ts`, `export.test.ts`.
(Paths prefixed `apps/desktop/src/lib/…` unless noted.)

## Risks / Trade-offs

- [Wide diff looks alarming] → Per-file hunks are one-line swaps; PR body links
  the census; reviewers can spot-check mechanically.
- [Dynamic key access somewhere expects raw strings] → `rg` sweep for
  bracket-access patterns after replacement; full suite is the net.
- [Proof harness (nativeProof.ts) breaks CI-only paths] → It is included in the
  sweep; `deno task check` covers its types even though runners are CI-side.
- [Import cycles] → Engine is a leaf; none possible.

## Migration Plan

Single branch `refactor/node-name-contract`, one commit, no data/format
migration. Rollback = revert.

## Open Questions

None — Slice A scope approved by user.

## Why

Tesina needs a useful bilingual writing-coach baseline before any model or user interface is introduced. A pure, deterministic engine can point students to observable prose weaknesses and ask revision questions without guessing authorship, rewriting student work, or weakening the app's local-first boundary.

## What Changes

- Add a pure TypeScript writing-coach engine for English and Spanish document text with exactly six issue categories: specificity, evidence, clarity, economy, repetition, and voice.
- Define stable input, protected-source-span, issue, ordering, overlap, and deduplication contracts. Every issue identifies an exact UTF-16 source span and carries stable explanation and learning-question message identifiers with typed parameters; LT-04 renders those messages through Paraglide in the UI locale while analysis and preserved source text remain in the document language.
- Add conservative language-neutral and native English/Spanish rules that treat citations, quotations, source titles, and caller-identified proper names as protected context and never infer that a claim is false, uncited, or AI-authored.
- Add a redistributable, de-identified bilingual evaluation corpus with per-fixture provenance, license, cohort, expected observations, and two independent bilingual-reviewer decision slots. Implementation may prepare the corpus and review bundles, but acceptance remains pending until two distinct human reviewer IDs and both decision sets are recorded.
- Add an offline evaluator with deterministic one-to-one observation matching and a stable aggregate schema. It reports defined micro/macro metrics by document language, category, corpus cohort, and review UI locale, including passage-level false positives and rendered learning-question usefulness, while storing fixture results only and emitting no telemetry.
- Add the versioned internal `unslopV1` policy and deterministic audit contract for Tesina-generated feedback and future quiz/example text. The policy does not transform student prose; only an initially schema-valid, grounded draft that fails style is eligible for one style-correction attempt, while pre-style schema/grounding failures are discarded and later retry policy remains outside LT-03.
- Do not add UI, editor traversal or mutation, Tauri code, network access, persistence, model inference, text generation, quizzes, telemetry, authorship detection, grading, or a visible release promise.

## Capabilities

### New Capabilities

- `bilingual-writing-coach-engine`: Defines the deterministic bilingual analysis, exact-span issue contract, protected-source handling, corpus/evaluator quality gates, and the versioned generated-output audit policy.

### Modified Capabilities

None.

## Impact

- New pure TypeScript modules and focused tests under `apps/desktop/src/lib/learning/coach/`, including internal bilingual rule data, corpus fixtures, and evaluator support.
- No new runtime dependency, native permission, network path, persistent data, essay schema change, editor behavior, localization surface, model runtime, or application release surface.
- The exported engine request/result, typed message-descriptor, and `unslopV1` audit types become the seams that LT-04 and later local-generation work must consume without importing rule internals or making the engine depend on UI locale or Paraglide.

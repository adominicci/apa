## Context

See `proposal.md` for motivation and `specs/bilingual-writing-coach-engine/spec.md` for observable behavior. Tesina has a completed bilingual spelling boundary, but no writing-coach module. The canonical delivery plan places LT-03 before all coach UI and model work so this change must produce a hidden, pure TypeScript seam that can be measured independently.

The stable planning shape for a coach issue needs one refinement to preserve Tesina's two language axes. Document language is the essay's `DocLocale` and controls analysis plus preserved source text. UI locale controls rendered explanations and learning questions. The hidden engine therefore emits stable typed message descriptors rather than final prose; LT-04 will render them through Paraglide. A deterministic engine can recognize narrow observable patterns, but it cannot infer named entities, determine whether a claim is true, or know whether support elsewhere in a paper is sufficient. The public request carries exact protected spans from a future caller while retaining conservative local recognition for citation and quotation syntax.

## Goals / Non-Goals

**Goals:**

- Define one small analysis request/result seam with exact UTF-16 document ranges.
- Make every rule, conflict decision, and corpus score repeatable and reviewable.
- Treat English and Spanish as independent authored analysis rule sets while leaving all runtime feedback rendering to the UI locale.
- Establish measurable usefulness and false-positive gates before a UI or model can depend on the engine.
- Freeze a versioned generated-output audit that later work can compose after grounding validation.

**Non-Goals:**

- General grammar checking, fact checking, citation validation, named-entity recognition, or a complete prose-quality score.
- Automatic rewriting, suggestions that can be inserted, editor traversal, decorations, localization controls, persistence, or runtime scheduling.
- Model prompts, providers, downloads, generation, quiz validation, telemetry, or release enablement.

## Decisions

### D1. Export two pure seams and keep rule machinery internal

Create `types.ts` with contract version constants, the six-category union, protected-span types, `WritingCoachRequest`, `WritingCoachIssue`, a closed `CoachMessageMap`, and generated-output audit types. Each message-map entry binds one stable explanation or learning-question ID to an exact parameter object type. A public issue contains `from`, `to`, `observedText`, `category`, `explanation: { id, params }`, `learningQuestion: { id, params }`, and `source: "deterministic"`; it contains no final UI string. `observedText` is the exact slice of document-language input. LT-04 maps the descriptors to Paraglide messages and renders both descriptors in the current UI locale.

Export a synchronous `analyzeWriting(request): WritingCoachIssue[]` from `rules.ts` and `auditUnslopV1(request): UnslopAuditResult` from `unslopV1.ts`. Use `DocLocale` from `@tesina/engine` as the document-language type rather than creating another English/Spanish alias. The request contains `text`, `documentLanguage`, `documentStart`, and document-absolute `protectedSpans`. `documentStart` must be a non-negative safe integer; `documentStart + text.length` must be a safe integer; text is capped at 65,536 UTF-16 code units. Every protected span must have safe-integer `from < to`, lie wholly within `[documentStart, documentStart + text.length)`, and map to boundaries that do not split a UTF-16 surrogate pair. Invalid input raises one stable programmer-facing input error before analysis. These checks let later block extraction return document-relative positions without importing ProseMirror here.

Public seam confirmation required during implementation: confirm the existing `@tesina/engine` `DocLocale` export remains the repository's canonical document-language type and confirm LT-04 can supply the fixed immutable text, document-relative `documentStart`, protected ranges, and descriptor-to-Paraglide exhaustiveness check. If any seam is false, stop and revise the OpenSpec because changing the language, coordinates, or message contract affects downstream behavior. Internal filenames and rule IDs do not require product confirmation.

Alternative: emit English/Spanish feedback chosen by document language. Rejected because explanation and question rendering belongs to UI locale under the repository invariant. Alternative: reuse spelling's `DocumentLanguage`. Rejected because coach code would depend on a sibling feature module for a domain type already exported by the pure engine package. Alternative: return offsets relative to each fragment. Rejected because every consumer would need a second mapping step and stale mapping errors would be harder to detect. Alternative: expose rule plugins. Rejected because only one versioned built-in rubric is required.

### D2. Rules emit internal candidates through a shared normalization pipeline

Split rule data by responsibility rather than by a generic plugin framework:

- shared tokenization, sentence/paragraph segmentation, Unicode-aware offset maps, protected-span masking, and structural rules;
- independently authored `en` and `es` phrase/rule tables with language-neutral message IDs and typed source-text parameters;
- internal candidates carrying stable rule ID, numeric priority, exact range, category, and typed explanation/question descriptors;
- one normalizer that validates ranges, deduplicates, resolves same-category overlap, and sorts public issues.

Use JavaScript string offsets end to end so UTF-16 remains the coordinate system. Case normalization uses locale-aware lowercase only; it never strips accents. A normalized token stores its original `[from, to)` range, and matching returns that stored original range rather than indices into normalized text. This is required because lowercasing can change UTF-16 length: for example, English-locale lowercasing maps `İ` (one code unit) to `i` plus combining dot (two code units). A normalized match over that expansion still maps to the single original code unit and its document-absolute offset. Tokenization preserves original ranges and masks protected spans instead of deleting text, which prevents later offsets from shifting.

First collapse exact same-category/range duplicates by numeric priority then rule ID. For all remaining candidates within one category, rank by span length ascending, `from`, `to`, numeric priority, then rule ID. Walk that ranking and retain a candidate only when its half-open interval has no non-empty intersection with a retained candidate; touching intervals do not overlap. This makes chained and nested overlap independent of rule execution order while allowing two short non-overlapping candidates to survive a broader bridging candidate. Cross-category overlaps remain because collapsing them would silently assert that one observable property explains another. Final issues sort by `from`, `to`, canonical category order, and hidden rule ID before the ID is removed. Tests shuffle candidate and protected-span input to prove order does not depend on iteration or object insertion.

Alternative: emit findings directly from each rule. Rejected because output would depend on rule execution order and duplicate phrases could produce repeated cards. Alternative: assign probabilistic confidence. Rejected because there is no calibrated probability source and it would encourage quality or authorship interpretations the product forbids.

### D3. Conservative thresholds favor precision over coverage

Freeze thresholds as data covered by contract tests:

- no structure, evidence, repetition, or voice result for a fragment under eight lexical tokens;
- clarity requires both more than 45 English or 50 Spanish lexical tokens in one sentence and at least three language-reviewed clause cues;
- phrase repetition requires a normalized sequence of at least four content tokens twice in one paragraph;
- repeated opening requires the same first three content tokens in three consecutive sentences;
- economy, specificity, and voice rules match only reviewed multiword or syntactically bounded patterns, never a standalone intensifier, transition, pronoun, passive construction, or common word;
- evidence rules require a narrow reviewed assertion cue and can only ask whether support or explanation is needed.

The phrase tables should start small. Each entry requires a positive fixture, a competent near-miss, stable typed message descriptors, reviewed English and Spanish rendered-message fixtures, and reviewer agreement. Runtime rule selection still uses only document language; the rendered fixtures exercise each UI locale separately without importing Paraglide into the engine. Adding a rule, message descriptor, or threshold changes evaluator snapshots and requires the same focused review; there is no user-editable configuration in LT-03.

Alternative: maximize recall with broad word lists. Rejected because broad style lint systematically over-flags ordinary academic and second-language writing. Alternative: use one translated phrase table. Rejected because discourse constructions and natural learning questions differ between English and Spanish.

### D4. Protected source material is explicit and conservatively inferred

Normalize caller spans labeled `citation`, `quotation`, `source-title`, or `proper-name` only after the D1 absolute-coordinate validation. Sort by `from`, `to`, then kind. Merge touching or overlapping spans into masking intervals while retaining the union of their kinds for test diagnostics and retaining the original immutable request. Add only two internal recognizers: balanced straight/curly quotation pairs within a paragraph and narrow APA-shaped parenthetical citations. Convert inferred request-relative ranges to document-absolute ranges before combining them. Do not recognize block semantics, bibliography entries, names, source credibility, citation completeness, or facts.

Before deduplication or same-category overlap resolution, discard every candidate whose half-open range has any non-empty intersection with a normalized protected masking interval. Candidates are never clipped, split, or rebuilt from an unprotected side. Protected tokens do not count toward lexical or repetition thresholds. Evidence rules treat a protected citation or quotation in the claim sentence or immediately following sentence as nearby support and remain silent. Unbalanced quote punctuation creates no inferred protected range.

The future editor integration owns mapping ProseMirror citations, quotations, source titles, and proper names into protected ranges against the same immutable snapshot. That mapping is an LT-04 concern; LT-03 proves the pure contract with fixtures.

Alternative: infer all protected content from plain text. Rejected because named entities and document semantics cannot be recovered reliably. Alternative: ignore protection and let the UI filter findings. Rejected because evaluator results and later model prompts would then disagree with displayed deterministic behavior.

### D5. Corpus metadata makes review and redistribution auditable

Store fixtures under `fixtures/` as TypeScript/JSON-compatible data validated by focused tests. Require at least 64 fixtures: eight in every document-language/cohort cell across English/Spanish and weak/competent/AI-assisted/second-language. Each of the 12 required document-language/category cells needs at least eight proposed expected-positive observations and at least eight emitted issues for a structurally complete handoff; after review, each still needs eight observations accepted by both humans for acceptance. Cohorts are evaluation strata only; the engine never receives them.

Prefer project-authored synthetic fixtures contributed under the repository MIT license. A redistributed fixture is allowed only with an explicit compatible SPDX identifier, origin URL, attribution fields where required, and confirmed permission to redistribute this exact text. Record de-identification even for synthetic material. Do not use real student papers, copied APA-manual prose, private documents, or model output with unresolved redistribution terms. AI-assisted fixtures must document their lawful creation and license; the label is not accepted as an authorship ground truth.

Each fixture records immutable ID, language, cohort, text, origin/license fields, and proposed expected-clean state or exact category/ranges. Implementation also creates two unassigned reviewer slots with role `independent-bilingual-reviewer`; it does not invent a person, reviewer ID, independence attestation, or decision. At handoff, the product owner assigns two distinct opaque reviewer IDs. Each human confirms bilingual English/Spanish review ability and independence, then independently decides every expected observation and every rendered learning-question instance. A decision is never inferred from the other reviewer. Missing assignments, duplicate IDs, abstentions, missing decisions, or unresolved disagreement leave acceptance incomplete.

Runtime engine output never depends on reviewed prose strings. A separate evaluation renderer expands each message descriptor into checked English and Spanish wording fixtures. Every rendered question instance has the stable key `{ corpusVersion, fixtureId, issueKey, catalogVersion, uiLocale }`, where `issueKey` joins the canonical output index, `from`, `to`, category, question ID, and canonical parameters. Canonical parameters serialize JSON primitives/arrays recursively with object keys in lexical order. The rendered-content digest is lowercase SHA-256 over UTF-8 `catalogVersion`, UI locale, question ID, canonical parameters, and exact rendered question separated by NUL bytes. Both reviewer records repeat the full key and digest, preventing a decision from being reused after output order, parameters, catalog text, or locale changes.

Alternative: scrape public student prose. Rejected because consent, privacy, provenance, and license would be difficult to prove. Alternative: store only positive examples. Rejected because competent and second-language false positives are primary stop conditions.

### D6. Evaluator gates are fixed, disaggregated, and offline

`evaluate.ts` operates only over committed fixtures and returns one `writing-coach-evaluation-v1` aggregate suitable for a checked snapshot. For each fixture, sort emitted issues by the public canonical order and expected observations by `from`, `to`, category order, then expected ID. Build eligible emitted/expected pairs only when categories match and half-open spans have a non-empty intersection. Sort pairs by exact-span match first, intersection length descending, total absolute boundary distance ascending, emitted canonical order, then expected ID. Walk once and accept a pair only when neither member is already matched. This deterministic greedy procedure yields one-to-one matches; unmatched emissions are false positives and unmatched expectations are misses.

Every rate is serialized as `{ numerator, denominator, basisPoints, state }`; `basisPoints` is the rational rate multiplied by 10,000 and rounded half up with integer arithmetic. State is `computed`, `pending-review`, or `not-computable`. A zero denominator yields `basisPoints: null`, never 0% or 100%. A metric whose only missing input is an outstanding human decision is `pending-review`; after review is complete, a zero denominator is `not-computable` and fails. Fewer than eight proposed observations or emitted issues fails structural `supported-cell`; fewer than eight observations accepted by both reviewers is pending before review completes and fails afterward. Arrays contain every fixed language/category/cohort/UI-locale key in lexical/canonical order, including zero-emission cells.

Metrics are defined as follows:

- category precision: matched emissions divided by all emissions;
- exact-span accuracy: exact-range one-to-one matches divided by category-matched emissions;
- detection coverage: matched expectations divided by all expected observations, reported without an acceptance threshold;
- competent false-positive passage rate per document language: competent fixtures with at least one unmatched emission divided by all competent fixtures in that language;
- second-language false-positive passage rate per document language: second-language fixtures with at least one unmatched emission divided by all second-language fixtures in that language; unmatched issue counts are also reported, but the 10% gate uses passages, not issues;
- question usefulness: rendered question instances marked `useful` by both distinct reviewers divided by all required rendered instances across both UI locales.

Micro rates sum numerators and denominators before division. Macro rates are the unweighted arithmetic mean of the required non-null cell rates, calculated as exact rationals and rounded half up only for serialized basis points. The 12 document-language/category cells define precision, span, and coverage macro rates. The 24 document-language/category/UI-locale cells define usefulness macro rates. A required null cell makes the corresponding macro not computable and acceptance fail.

The stable aggregate contains, in order: `schemaVersion`, coach/corpus/catalog versions and a lowercase SHA-256 digest of the canonical serialized corpus, outputs, render catalog, reviewer assignments, and decisions; `status` (`pending-human-review`, `failed`, or `passed`); reviewer slots; global counts; micro and macro metrics; arrays `byDocumentLanguage`, `byCategory`, `byCohort`, `byLanguageCategory`, `byLanguageCohort`, and `byLanguageCategoryUiLocale`; and ordered gate results with code, state, observed rate/count, and threshold. It contains no timestamp or environment-dependent field. An unassigned slot, missing attestation/decision, or abstention is `pending`; duplicate IDs, a false independence/bilingual attestation, foreign/stale key or digest, or unresolved expected-observation disagreement is `failed`. A `not-useful` question decision is complete evidence and affects the numeric gate. Status is `failed` if any gate fails, otherwise `pending-human-review` if any gate is pending, otherwise `passed`.

Acceptance requires 85% micro category precision, 75% precision for every supported language/category cell, 90% micro exact-span accuracy, at most 10% competent false-positive passages in each language, at most 10% second-language false-positive passages in each analyzed language, and 80% micro dual-reviewer question usefulness. Both distinct bilingual reviewer assignments and all linked decisions are mandatory. Commit aggregate fixture results; never instrument runtime text or events.

Alternative: one bilingual score. Rejected because a strong English result could conceal weak Spanish or second-language behavior. Alternative: set a recall gate now. Rejected because a narrow deterministic baseline should be judged for safe, useful findings before contextual model work measures incremental coverage.

### D7. `unslopV1` is an immutable audit, not a rewriter

Represent the policy as a stable `UNSLOP_POLICY_VERSION = "unslopV1"`, bilingual reviewed pattern tables, violation codes, and a pure audit returning exact UTF-16 ranges. It detects matches for canned-framing phrases, heading-inflation structures, first-person experiential-claim phrases, reviewed slang tokens/phrases, reviewed nonstandard spelling/grammar patterns, and adjacent repetition in Tesina-generated output. These are observable string/structure matches, not judgments about intent. The audit does not run over student-authored prose, rewrite strings, estimate naturalness, or certify source support.

The audit request contains generated text and explicit `contentLanguage` only. The caller selects UI locale for generated explanations/learning questions and document language for generated document-content examples or quizzes; the audit never guesses or mixes those axes. Grounding remains a separate future validator. LT-03 freezes only a correction-eligibility contract: an initial draft that is both schema-valid and grounded, but fails `unslopV1`, is eligible for exactly one style-correction attempt. A draft that fails schema or grounding before the style audit is discarded with zero style-correction attempts. After the one eligible attempt, schema, grounding, and style all rerun and any failure discards the output. Whether to invoke the eligible attempt and every retry/regeneration policy belong to the later generation OpenSpec. LT-03 provides no generator or orchestration implementation.

Alternative: automatically clean text with replacements. Rejected because replacements can change meaning and blur the boundary between policy and generation. Alternative: make the policy mutable without a version. Rejected because corpus results and later task behavior would stop being reproducible.

### D8. Keep the module hidden and dependency-free

Place all implementation under `apps/desktop/src/lib/learning/coach/`. Do not register it in editor addons, Svelte state, routes, menus, Paraglide messages, Tauri commands, settings, or persistence. Use only the TypeScript/JavaScript runtime already available. Tests must statically assert the coach production module graph contains no Tauri, network, storage, model, generation, editor-mutation, quiz, or telemetry imports.

Alternative: place the engine in `packages/apa-engine`. Rejected for LT-03 because the canonical plan keeps new learning work in the desktop app until reuse outside that app is proven. Alternative: add an existing prose-lint dependency. Rejected because the reviewed rule set is smaller, bilingual behavior must be native, and no dependency is needed.

## Risks / Trade-offs

- [Plain-text rules miss context and some valid issues] → Prefer precise teachable findings, report coverage without a recall gate, and reserve contextual comparison for LT-07.
- [Lexical rules encode language or reviewer bias] → Require native bilingual authorship, two-reviewer decisions, per-language/cohort metrics, competent near-misses, and a hard stop for unresolved categories or systematic second-language false positives.
- [Caller omits a quotation, citation, title, or proper-name span] → Add narrow quote/citation recognition, keep wording non-accusatory, and require LT-04 to confirm the protected-span mapping before integration.
- [Same-category overlap hides a distinct observation] → Keep internal candidate snapshots and review suppressed candidates in focused tests; prefer the smallest exact symptom rather than broader prose.
- [The numerical gates are unstable on a small corpus] → Require fixed minimum denominators and report raw counts; grow the corpus before weakening a gate.
- [Message descriptors drift from UI rendering] → Type every ID/parameter pair, render checked bilingual review fixtures outside the engine, include catalog version/content digest in decision keys, and require LT-04 exhaustiveness proof.
- [Automated work is mistaken for human acceptance] → Ship pending reviewer slots and a deterministic review bundle; acceptance cannot pass until two distinct assigned bilingual humans record every independent decision.
- [`unslopV1` becomes a humanizer] → Expose audit results only, prohibit student-text transformation, and make any future correction bounded to one generation followed by full revalidation.

## Migration Plan

Implement the hidden contract with failing tests first, then segmentation/protection, category rules, normalization, corpus/evaluator, evaluation-only rendered-message fixtures, and `unslopV1` audit in that order. Produce the deterministic human-review bundle and hand it to two product-owner-assigned independent bilingual reviewers. Do not mark evaluator acceptance or LT-03 complete until both distinct IDs and complete linked decisions are recorded. Run the focused coach suites before the repository gates and strict OpenSpec validation. No data migration or runtime rollout exists. Rollback removes the unused `learning/coach` directory and its tests; no essay, app setting, model, or device state has been created.

## Open Questions

- The exact LT-04 editor extraction and Paraglide adapter owner/import paths can be chosen in LT-04, provided they supply the fixed immutable text/document-relative protected-span contract and exhaustively render the fixed message descriptors in UI locale without changing LT-03 behavior.
- The aggregate evaluator artifact may be JSON or a TypeScript snapshot according to the repository's smallest existing fixture pattern; its schema and required metrics are fixed here.

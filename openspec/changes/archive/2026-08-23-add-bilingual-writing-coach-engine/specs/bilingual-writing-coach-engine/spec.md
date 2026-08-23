## Purpose

Defines a pure, deterministic bilingual writing-coach contract that points students to observable prose weaknesses, protects sourced material, and evaluates feedback quality without inferring authorship or changing student text.

## ADDED Requirements

### Requirement: Pure locale-aware analysis contract
The writing coach SHALL analyze only caller-supplied text using the request's document language, which MUST be `en` or `es`; it MUST NOT accept or read UI locale. The request SHALL contain text of at most 65,536 UTF-16 code units, a non-negative safe-integer `documentStart`, and zero or more document-absolute protected spans. `documentStart + text.length` MUST remain a safe integer. Every protected span SHALL use safe-integer `from < to`, lie wholly within `[documentStart, documentStart + text.length)`, and map to text boundaries that do not split a UTF-16 surrogate pair. Invalid input MUST produce the stable coach input error before any rule executes. Analysis ranges SHALL be zero-based, half-open `[from, to)` document-absolute UTF-16 offsets against the caller's immutable text snapshot. The engine SHALL be synchronous, deterministic, and pure: the same valid request and coach contract version MUST return structurally equal results without reading time, randomness, editor state, device state, or external services.

#### Scenario: Identical bilingual request is repeatable
- **WHEN** the same valid English or Spanish request is analyzed repeatedly under the same coach contract version
- **THEN** every run returns structurally equal ordered issues with the same UTF-16 ranges, preserved source text, and typed message descriptors

#### Scenario: UI locale differs from document language
- **WHEN** Spanish document text is analyzed while the application UI locale is English
- **THEN** document-language analysis and preserved source text remain Spanish, the engine output is independent of UI locale, and LT-04 can render the stable explanation and learning-question descriptors in English

#### Scenario: Non-BMP text precedes an issue
- **WHEN** an emoji or another non-BMP character precedes a detected phrase
- **THEN** the issue range counts that character as two UTF-16 code units and slices exactly the detected phrase from the immutable request snapshot

#### Scenario: Protected span uses the wrong coordinate space
- **WHEN** a protected span lies below `documentStart`, beyond `documentStart + text.length`, has an empty/reversed range, or splits a surrogate pair
- **THEN** the engine returns the stable input error before analysis instead of clipping, rebasing, or guessing the span

### Requirement: Exactly six observable categories
Every writing-coach issue SHALL use exactly one of `specificity`, `evidence`, `clarity`, `economy`, `repetition`, or `voice`. Rules SHALL describe an observable feature of the supplied prose and MUST NOT emit an authorship probability, identify AI use, accuse misconduct or plagiarism, grade the student, diagnose a person, or infer whether a cohort label applies.

#### Scenario: Observable weakness is reported
- **WHEN** a conservative rule identifies a qualifying vague phrase, support cue, hard-to-follow construction, inflated phrase, repeated wording, or formulaic voice pattern
- **THEN** the issue uses the corresponding one of the six category keys and refers only to the text feature that matched

#### Scenario: AI-assisted corpus fixture is analyzed
- **WHEN** the evaluator analyzes a fixture whose review-only cohort is `ai-assisted`
- **THEN** the engine receives no cohort or authorship metadata and returns only observable writing issues

#### Scenario: No observable threshold is met
- **WHEN** a passage contains no qualifying pattern under the approved conservative rules
- **THEN** the engine returns no issue instead of speculating from style, fluency, or student background

### Requirement: Exact teachable issue descriptor
Every emitted issue SHALL contain a non-empty exact `from`/`to` source range, `observedText` equal to the exact document-language input slice at that range, one of the six category keys, `source: "deterministic"`, and separate explanation and learning-question descriptors. Each descriptor SHALL be a stable message identifier paired with the exact typed parameters declared for that identifier. The engine MUST NOT emit final explanation/question prose or accept UI locale. LT-04 SHALL own exhaustive Paraglide rendering in the active UI locale. Evaluation-only rendered fixtures SHALL cover English and Spanish UI-locale wording separately from the runtime engine; each rendered explanation SHALL be one sentence no longer than 180 UTF-16 code units and each rendered learning question SHALL be exactly one interrogative sentence no longer than 180 UTF-16 code units. No descriptor or rendered fixture may offer a replacement passage, instruct acceptance of generated prose, or claim that an assertion is false or uncited.

#### Scenario: Student receives one revision prompt
- **WHEN** a deterministic rule emits an issue
- **THEN** the highlighted range and `observedText` identify the matched observable text, and typed descriptors identify one explanation and one learning question without embedding UI prose

#### Scenario: Evidence cue lacks nearby support
- **WHEN** a qualifying assertion cue appears without protected supporting material in its sentence or the immediately following sentence
- **THEN** the issue selects descriptors whose reviewed renderings say that support or explanation may be needed and do not declare the claim false, unsupported in the complete paper, or uncited

#### Scenario: Feedback renders in UI locale
- **WHEN** one issue descriptor is rendered under English and Spanish UI locales for human review
- **THEN** both renderings use independently reviewed natural UI-language wording while retaining the same document-language `observedText` parameter

### Requirement: Conservative bilingual rules
The rule set SHALL contain shared structural rules plus separately authored English and Spanish lexical rules. Lexical matches SHALL be Unicode-aware, case-normalized without removing Spanish diacritics or `ñ`, bounded by language-appropriate token boundaries, and limited to reviewed patterns. Every normalized token SHALL retain its original request-relative UTF-16 range, and every match/source span SHALL be derived from those original ranges rather than normalized-string indices, including when locale-aware lowercasing changes UTF-16 length. Short fragments with fewer than eight lexical tokens MUST NOT receive sentence-structure, evidence, repetition, or voice findings. Clarity findings SHALL require both a sentence length above 45 lexical tokens in English or 50 in Spanish and at least three reviewed clause-boundary cues. Repetition findings SHALL require either a normalized content sequence of at least four tokens appearing at least twice in one paragraph or the same normalized three-content-token sentence opening in three consecutive sentences. Economy, specificity, and voice lexical findings SHALL match only the reviewed phrase span; a rule MUST NOT flag a general word such as an intensifier, passive construction, first-person pronoun, or transition by itself.

#### Scenario: Short fragment is analyzed
- **WHEN** a fragment has fewer than eight lexical tokens
- **THEN** structure, evidence, repetition, and voice rules emit no issue for that fragment

#### Scenario: Long but syntactically simple sentence is analyzed
- **WHEN** a sentence exceeds its language's word threshold but contains fewer than three reviewed clause-boundary cues
- **THEN** the clarity rule does not emit an issue solely because of length

#### Scenario: Spanish diacritics affect a lexical match
- **WHEN** a Spanish word differs from a reviewed pattern by the presence or absence of a meaningful diacritic or `ñ`
- **THEN** normalization does not collapse the two forms into the same lexical match

#### Scenario: Locale lowercasing expands UTF-16 length
- **WHEN** English-locale lowercasing maps original `İ` from one UTF-16 code unit to `i` plus combining dot in two code units and normalized matching includes that token
- **THEN** the match range and `observedText` map to the original one-code-unit `İ`, with `documentStart` added exactly once, rather than using expanded normalized indices

#### Scenario: Repeated phrase crosses paragraphs
- **WHEN** the same four-token content sequence appears once in each of two paragraphs
- **THEN** the within-paragraph repetition rule does not emit an issue

### Requirement: Protected citations, quotations, titles, and proper names
The request SHALL accept document-absolute protected spans labeled `citation`, `quotation`, `source-title`, or `proper-name` under the analysis-contract validation. After validation, the engine SHALL sort spans by `from`, `to`, and kind, and SHALL merge touching or overlapping spans into masking intervals without mutating the input. Conservative inferred APA-shaped citations and balanced straight/curly quotations SHALL be converted from request-relative slices to document-absolute ranges before the same normalization. Before candidate deduplication or overlap resolution, the engine SHALL discard every candidate whose half-open range has any non-empty intersection with a protected masking interval; it MUST NOT clip, split, or rebuild a candidate from an unprotected side. Protected tokens MUST NOT count toward lexical or repetition thresholds, and a protected citation/quotation in the same sentence or immediately following sentence MUST count as nearby support for evidence-rule suppression. The engine MUST NOT attempt named-entity detection or decide whether a source is credible, correctly quoted, or sufficient.

#### Scenario: Quoted wording matches a coach pattern
- **WHEN** a reviewed phrase appears only inside a caller-supplied or conservatively recognized quotation span
- **THEN** the engine emits no issue for that quoted wording

#### Scenario: Citation follows a qualifying claim
- **WHEN** a qualifying assertion cue has a protected citation in the same sentence or the immediately following sentence
- **THEN** the evidence rule does not claim that nearby support is missing

#### Scenario: Proper name resembles a lexical pattern
- **WHEN** a matching token is inside a caller-supplied `proper-name` span
- **THEN** the token is excluded from findings and structural counts

#### Scenario: Candidate partially overlaps protected text
- **WHEN** any non-empty part of a candidate range intersects a normalized protected masking interval
- **THEN** the complete candidate is discarded without trimming, splitting, or emitting either surviving side

#### Scenario: Unbalanced quotation punctuation is present
- **WHEN** quote punctuation cannot be paired conservatively
- **THEN** the engine protects no guessed quotation range and does not extend a protected span across unrelated text

### Requirement: Deterministic overlap, deduplication, and ordering
Candidate findings SHALL be normalized before output. First, exact duplicates with the same category and range SHALL collapse to the candidate with lower numeric rule priority, then lexicographically smaller stable rule identifier. Next, remaining candidates SHALL be grouped by category and ranked by span length ascending, `from` ascending, `to` ascending, numeric rule priority ascending, then rule identifier lexicographically. In that rank order, a candidate SHALL be retained only if its half-open interval has no non-empty intersection with any already retained candidate in the same category; touching intervals do not overlap. This rule SHALL apply identically to nested, chained, and bridging candidates and SHALL NOT depend on rule execution order. Candidates in different categories MAY overlap because they describe distinct observable properties. Final issues SHALL be ordered by ascending `from`, ascending `to`, the fixed category order `specificity`, `evidence`, `clarity`, `economy`, `repetition`, `voice`, and stable rule identifier. Rule identifiers and priorities SHALL remain internal and MUST NOT appear in the public issue.

#### Scenario: Two rules emit the same issue
- **WHEN** two rules produce the same category and exact source range
- **THEN** one public issue remains according to rule priority and stable identifier

#### Scenario: Same-category spans overlap
- **WHEN** nested or chained candidates in the same category overlap
- **THEN** ranked candidates are retained only when they do not overlap an already retained same-category candidate, using every specified tie-breaker independent of candidate arrival order

#### Scenario: Same-category spans only touch
- **WHEN** one same-category candidate ends exactly where another begins
- **THEN** both candidates may be retained because their half-open spans do not overlap

#### Scenario: Different categories overlap
- **WHEN** two candidates with different categories overlap the same prose
- **THEN** both may be emitted and appear in the fixed final ordering

### Requirement: Redistributable reviewed corpus
The evaluation corpus SHALL include English and Spanish fixtures in each review-only cohort: `weak`, `competent`, `ai-assisted`, and `second-language`. Each document-language/cohort cell SHALL contain at least eight fixtures, and each of the 12 document-language/category cells SHALL contain at least eight human-agreed expected-positive observations. Every fixture SHALL record an immutable ID, document language, cohort, text, origin description, SPDX license or project-authored MIT grant, source URL when applicable, de-identification confirmation, and proposed expected issue category/range or expected-clean status. The corpus MUST NOT contain student submissions, personal data, copied APA-manual text, or material the project cannot redistribute. Cohort and reviewer metadata SHALL be available only to evaluation and MUST NOT be engine inputs.

The review metadata SHALL define exactly two slots with role `independent-bilingual-reviewer`. Before acceptance, the product owner SHALL assign two distinct, non-empty opaque reviewer IDs; each assigned human SHALL attest English/Spanish review ability and independence, then independently record every expected-observation decision and every rendered-message usefulness decision. Implementation MAY prepare fixtures and a pending handoff bundle but MUST NOT invent identities, attestations, approvals, or decisions. A missing/duplicate ID, missing attestation, abstention, missing linked decision, or unresolved disagreement SHALL keep acceptance incomplete.

#### Scenario: Corpus provenance is audited
- **WHEN** an evaluator fixture is reviewed for inclusion
- **THEN** its origin, redistribution basis, de-identification, proposed observations, two distinct reviewer IDs/attestations, and both independent decision sets are present and machine-validatable before acceptance can pass

#### Scenario: A fixture lacks redistribution permission
- **WHEN** a proposed fixture has no compatible redistribution basis or contains unresolved personal data
- **THEN** it is excluded from the committed corpus and evaluator denominator

#### Scenario: Reviewers disagree on category meaning
- **WHEN** the two reviewers cannot resolve a fixture's category or expected range under the rubric
- **THEN** the fixture is marked unresolved and the acceptance evaluator fails instead of choosing a label automatically

#### Scenario: Automated implementation reaches human handoff
- **WHEN** fixtures and rendered review bundles are ready but either bilingual human has not supplied a distinct reviewer ID and complete independent decisions
- **THEN** evaluator status is `pending-human-review` and LT-03 acceptance remains incomplete without inventing or copying a decision

### Requirement: Fixed offline evaluator and quality gates
The evaluator SHALL run deterministically over committed fixtures. Within each fixture it SHALL sort emitted issues by public output order and expected observations by `from`, `to`, fixed category order, then expected ID. An emitted/expected pair is eligible only when categories match and their half-open spans have a non-empty intersection. Eligible pairs SHALL be sorted by exact-span match first, intersection length descending, total absolute boundary distance ascending, emitted order, then expected ID. The evaluator SHALL walk that list once and accept a pair only when neither member was previously matched. Accepted pairs are one-to-one; unmatched emissions are false positives and unmatched expectations are misses.

The evaluator SHALL define category precision as matched emissions divided by all emissions, exact-span accuracy as exact-range pairs divided by category-matched emissions, and detection coverage as matched expectations divided by all expected observations. Competent false-positive passage rate for one document language SHALL be competent fixtures containing at least one unmatched emission divided by all competent fixtures in that language. Second-language false-positive passage rate SHALL likewise be second-language fixtures containing at least one unmatched emission divided by all second-language fixtures in that analyzed document language; unmatched issue counts SHALL also be reported, but the gate denominator is passages. Detection coverage is diagnostic and has no acceptance threshold.

Each emitted issue SHALL produce two evaluation-only rendered learning-question instances, one per supported UI locale, without making the engine accept UI locale. An instance key SHALL contain corpus version, fixture ID, canonical issue key, rendered-message catalog version, and UI locale. The issue key SHALL join canonical output index, `from`, `to`, category, question ID, and canonical typed parameters; parameter serialization SHALL recursively preserve arrays and sort object keys lexicographically. The rendered-content digest SHALL be lowercase SHA-256 over the UTF-8 catalog version, UI locale, question ID, canonical parameters, and exact rendered question separated by NUL bytes. Reviewer decisions SHALL repeat the full key and digest. A question counts as useful only when both distinct assigned reviewers mark that exact instance `useful`.

The evaluator SHALL serialize every rate as `{ numerator, denominator, basisPoints, state }`, using integer half-up rounding to 10,000 basis points. State SHALL be `computed`, `pending-review`, or `not-computable`; a null rate MUST never become 0% or 100%. A metric whose only missing input is an outstanding human decision SHALL be `pending-review`. After human review is complete, a zero denominator SHALL produce `basisPoints: null`, `state: "not-computable"`, and a failed gate. Micro metrics SHALL sum numerators and denominators before division. Macro metrics SHALL be the unweighted arithmetic mean of required non-null cell rates using exact rational arithmetic before final half-up rounding. The 12 fixed document-language/category cells SHALL define precision/span/coverage macros; the 24 document-language/category/UI-locale cells SHALL define usefulness macros. Every fixed language, category, cohort, and UI-locale cell MUST appear in canonical order even with zero emissions. Each required language/category cell SHALL have at least eight proposed expected positives and eight emitted issues for structural handoff; fewer fails immediately. Eight observations accepted by both humans are also required per cell: that gate is pending until review completes and fails if completed decisions leave fewer than eight.

The aggregate SHALL use schema `writing-coach-evaluation-v1` and contain, in stable order, coach/corpus/rendered-catalog versions and a lowercase SHA-256 digest of the canonical serialized corpus, outputs, render catalog, reviewer assignments, and decisions; status `pending-human-review`, `failed`, or `passed`; reviewer slots; global counts; micro and macro metrics; complete arrays `byDocumentLanguage`, `byCategory`, `byCohort`, `byLanguageCategory`, `byLanguageCohort`, and `byLanguageCategoryUiLocale`; and ordered gate results with code, state, observed value, and threshold. It MUST NOT contain a timestamp, environment-dependent field, telemetry, or user text. An unassigned reviewer slot, missing attestation/decision, or abstention SHALL be `pending`; duplicate reviewer IDs, a false bilingual/independence attestation, a foreign/stale key or digest, or unresolved expected-observation disagreement SHALL be `failed`. A `not-useful` decision is complete and affects the numeric usefulness gate. Any failed gate makes aggregate status `failed`; otherwise any pending human-review gate makes status `pending-human-review`; only all passed gates produce `passed`.

Acceptance SHALL require at least 85% micro category precision, at least 75% precision in every supported language/category cell, at least 90% micro exact-span accuracy, at most 10% competent false-positive passages in each language, at most 10% second-language false-positive passages in each analyzed document language, and at least 80% micro usefulness across all required rendered question instances. Both distinct bilingual reviewer assignments and every linked decision are mandatory. The evaluator MUST NOT score authorship accuracy.

#### Scenario: A category lacks enough bilingual evidence
- **WHEN** a required language/category cell has fewer than eight proposed positives or emitted issues, or completed human review leaves fewer than eight agreed positives or a zero denominator
- **THEN** the evaluator emits that cell with its raw counts/null rate, fails `supported-cell`, and does not omit, pool, or convert it to a passing rate

#### Scenario: Human decisions are the only missing metric input
- **WHEN** every structural support minimum is met but one or both reviewer decision sets are incomplete
- **THEN** affected rates and gates are `pending-review`, aggregate status is at least `pending-human-review`, and no missing human decision is treated as a numeric failure or approval

#### Scenario: Competent Spanish passages exceed the false-positive gate
- **WHEN** more than 10% of competent Spanish fixtures contain at least one emitted issue unmatched by an expected observation
- **THEN** the evaluator fails the accepted false-positive gate even if the overall bilingual rate passes

#### Scenario: Learning questions are not useful
- **WHEN** fewer than 80% of exact rendered question instances are independently marked useful by both reviewers
- **THEN** the evaluator fails and reports the linked document-language/category/UI-locale cells without reusing a decision from another template instance

#### Scenario: Second-language passage has several false positives
- **WHEN** one second-language fixture contains three unmatched emitted issues
- **THEN** the passage-level gate numerator increases by one, the diagnostic unmatched-issue count increases by three, and neither value is substituted for the other

#### Scenario: Micro and macro rates diverge
- **WHEN** required cells have unequal denominators and different rates
- **THEN** the evaluator computes micro from summed counts and macro as the unweighted mean of required cell rates using the specified rounding

#### Scenario: Evaluation results are stored
- **WHEN** the accepted corpus is evaluated
- **THEN** only deterministic aggregate fixture results and rubric metadata are stored, with no runtime event collection or student content

### Requirement: Versioned `unslopV1` generated-output policy
Tesina SHALL expose `unslopV1` as an immutable bilingual policy identifier and deterministic audit contract for Tesina-generated feedback and future quiz/example text. Its request SHALL contain generated text and explicit `contentLanguage: "en" | "es"`; the caller SHALL use UI locale for generated explanations/learning questions and document language for generated document-content examples/quizzes. The audit SHALL report exact matches for reviewed canned-framing phrases, heading-inflation structures, first-person experiential-claim phrases, reviewed slang tokens/phrases, reviewed nonstandard spelling/grammar patterns, and adjacent repetition. These violations SHALL be observable deterministic string/structure matches and MUST NOT assert why the pattern occurred or whether an error was deliberate. The audit SHALL process generated output only and MUST NOT guess locale, rewrite, humanize, score, or classify student-authored content. Native English and Spanish policy patterns and examples SHALL be reviewed independently.

#### Scenario: Generated feedback uses a canned opening
- **WHEN** Tesina-generated English or Spanish feedback matches a reviewed `unslopV1` canned-framing pattern
- **THEN** the deterministic audit returns a stable violation code and exact UTF-16 range

#### Scenario: Generated feedback locale differs from document language
- **WHEN** an English UI renders generated feedback about a Spanish document
- **THEN** the caller audits that feedback with `contentLanguage: "en"` while the student source remains Spanish and outside the audit input

#### Scenario: Student passage is supplied for analysis
- **WHEN** student-authored text is analyzed by the deterministic writing coach
- **THEN** `unslopV1` is not applied to transform or classify that passage

#### Scenario: Policy version changes later
- **WHEN** a future policy changes observable audit behavior
- **THEN** it receives a new version identifier rather than silently changing `unslopV1`

### Requirement: Bounded future post-generation audit
LT-03 SHALL define only this correction-eligibility contract: an initial generated draft that is schema-valid and grounded, but fails `unslopV1`, is eligible for exactly one style-correction attempt using structured audit violations. An initial draft that fails schema or grounding before style audit MUST be discarded with zero style-correction attempts. After the single eligible attempt, schema, grounding, and `unslopV1` validation SHALL all rerun; any failure MUST discard the output with no second style attempt. Whether a later pipeline invokes the eligible attempt and every schema, grounding, generation, or retry policy SHALL belong to the later generation OpenSpec. This LT-03 contract MUST NOT grant generation, network, persistence, or editor-mutation authority.

#### Scenario: First generated draft fails style audit
- **WHEN** a future schema-valid and grounded draft fails `unslopV1`
- **THEN** it is eligible for one style-correction attempt, and no second style-correction attempt is authorized by LT-03

#### Scenario: Corrective draft still fails
- **WHEN** the result of the one eligible style-correction attempt is schema-invalid, ungrounded, or noncompliant with `unslopV1`
- **THEN** LT-03 requires discarding it without a second style-correction attempt or document mutation, and any other retry requires the later generation OpenSpec

#### Scenario: Grounding fails before style audit
- **WHEN** a future generated draft lacks required source support
- **THEN** the draft is discarded with zero style-correction attempts, and any later grounding/regeneration retry requires authority from the later generation OpenSpec

#### Scenario: Schema fails before style audit
- **WHEN** a future generated draft is not schema-valid
- **THEN** the draft is discarded with zero style-correction attempts, and any later schema/regeneration retry requires authority from the later generation OpenSpec

### Requirement: Hidden local read-only boundary
LT-03 SHALL consist only of pure TypeScript engine, rules, corpus, evaluator, and `unslopV1` audit code. It MUST NOT import Tauri APIs, call a network or model provider, generate prose, inspect editor state, mutate an essay or editor, persist user or device data, collect telemetry, create quiz behavior, or expose UI or a visible release promise. No runtime dependency SHALL be added for this capability.

#### Scenario: Analysis completes
- **WHEN** the engine analyzes any valid request or the evaluator scores the corpus
- **THEN** no document, editor, setting, file, network service, model, or telemetry sink is read or changed beyond the explicit in-memory input and returned result

#### Scenario: LT-03 is implemented but LT-04 is absent
- **WHEN** the deterministic engine is present in the application source tree without a coach UI integration
- **THEN** no student-visible writing-coach control or release claim exists

# Local Learning Tools Delivery Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:executing-plans`. Before implementing a delivery task, create and
> approve its named OpenSpec change. Execute delivery tasks sequentially; do not
> run parallel writer worktrees.

**Goal:** Add bilingual spelling, a learning-oriented writing coach, optional
local inference, and grounded multiple-choice quizzes without weakening
Tesina's local-first, APA-authoritative, or student-learning principles.

**Architecture:** Deterministic features remain available without a model.
Spelling uses host operating-system services behind a narrow adapter. The
writing coach combines deterministic rules with an optional, explicitly
requested local-model review. Local generation runs through a Rust-managed
`llama-server` sidecar and a versioned task contract. Quizzes are generated only
from selected Tesina content and pass deterministic grounding validation before
display.

**Tech stack:** Svelte 5, Tiptap/ProseMirror, TypeScript, Tauri 2, Rust,
Paraglide, Vitest, Rust tests, `llama.cpp`/`llama-server`, GGUF.

**Spec:** This file is the canonical delivery, sequencing, and PR-strategy
source. Research evidence lives in
`docs/research/local-ai-module.md`; architecture rationale lives in
`docs/adr/0001-local-learning-tools-boundary.md`; shared terms live in
`CONTEXT.md`. OpenSpec changes own the detailed accepted behavior for one
delivery task at a time.

## Global constraints

- The work is for learning support, not AI-authorship detection, plagiarism
  accusation, grading, professor surveillance, or misconduct evidence.
- Tesina must never display an AI-generated probability or claim that a student
  used AI.
- APA validation, numbering, citations, references, schema, preview, and export
  remain deterministic and authoritative. A model never changes them.
- `essay.settings.documentLanguage` selects analysis and generated-content
  language. The current Paraglide UI locale selects controls, status, and
  explanations. Never mix those axes in one interface.
- English and Spanish are release requirements, not a translation follow-up.
- AI can precheck bilingual meaning drift, omissions, terminology, and fluency;
  two bilingual human reviewers remain the release authority for the evaluation
  corpus and user-facing language.
- The writing coach may diagnose and teach. It may not automatically rewrite a
  student's passage or silently insert generated text.
- Quizzes remain multiple choice: exactly one supported correct answer and three
  plausible but incorrect options. No free text, select-all, or hidden answer.
- The app stays useful when the model is absent, unsupported, out of memory,
  cancelled, or crashed. There is no cloud fallback.
- Model weights are an optional, consented download and are not included in the
  installer. The sidecar may be bundled only after both desktop platforms pass
  the capability gates.
- Pure packages under `packages/` do not import Tauri or receive model/runtime
  concerns. New work stays in `apps/desktop` unless a later approved OpenSpec
  explicitly proves a reusable pure contract belongs elsewhere.
- Additive essay fields do not bump `essay.schemaVersion` from 2. Device-only
  preferences belong in the existing app settings authority.
- Added dependencies and redistributed binaries/models must satisfy the
  repository license policy. Record exact versions, licenses, source URLs, and
  checksums in the approving OpenSpec change.
- Preserve atomic writes, autosave, rotating backups, relative assets, and the
  existing editor/render/export contracts.
- Do not advertise or release a cross-platform feature until macOS and Windows
  meet the same capability contract. Dictionary contents may differ by OS;
  behavior and failure handling may not.

## Canonical PR strategy

### Unit of delivery

One **delivery task** below equals:

```text
one OpenSpec change -> one feature branch -> one implementation PR -> one merge
```

The checkboxes inside an OpenSpec `tasks.md` are implementation subtasks. They
do not receive separate PRs. This keeps reviews focused while avoiding a full
macOS/Windows CI run for every small file edit.

The planning documents in this change are the only pre-implementation planning
slice. They do not create nine empty OpenSpec directories. Create each proposal
immediately before its delivery task so it reflects the then-current codebase
and lessons from earlier tasks.

Land these documents once as planning PR P0 before LT-01. P0 is the exception to
the OpenSpec-to-PR rule because it changes no product behavior. Its purpose is
to put the agreed boundaries and status ledger on `main` before implementation
starts. Suggested title: `Define the local learning tools delivery strategy`.
Do not create a second planning PR for each milestone; update this canonical
file inside the affected delivery PR when an approved OpenSpec changes the plan.

### Sequential branch loop

For each delivery task:

1. Fetch and verify the latest `main`, current version, active OpenSpec changes,
   worktree status, and relevant CI health.
2. Run the challenge gate defined below. Resolve scope objections in this
   canonical file or the proposed OpenSpec before implementation.
3. Create the named OpenSpec change with `proposal.md`, affected capability
   specs, `design.md`, and a detailed `tasks.md`.
4. Validate the proposal strictly and obtain approval. Do not implement while
   material product decisions remain unresolved.
5. Create one `features/<change-id>` branch or isolated worktree from the latest
   verified `main`. Only one delivery task may own shared editor, Paraglide,
   Cargo, Tauri, or model-manifest files at a time.
6. Implement with failing tests first for every durable behavior contract. Use
   focused checks while iterating.
7. Run the task's acceptance evidence and the repository-required final gates.
8. Apply the per-change version policy and write one human release-note entry
   when the PR is intended to merge to `main`.
9. Open one focused PR. The title should describe user value, not the internal
   task number. Request `@codex review` under the repository workflow.
10. Address validated current-head findings, resolve conversations, and verify
    CI at the current head. Do not create correction PRs for the same task.
11. Merge only with explicit authorization. Verify the merge and protected
    branch state before creating the next task from fresh `main`.
12. Archive the completed OpenSpec change according to the repository workflow
    when authorized. Update the status ledger in this file in the same or next
    planning-only change; never mark a task complete from CI status alone.

### CI economy

The 2026-08-22 workflow snapshot showed a normal PR exercising four jobs with a
wall time near 10.5 minutes and roughly 26 runner-minutes. PR run
`32509466076` used about 26 minutes across its four jobs. After a merge,
`main` runs those CI jobs again and starts installer verification. Installer run
`32510798201` used about 15 more runner-minutes. The post-merge cost is therefore
about 41 runner-minutes, and the complete PR-through-merge cost is about 67
runner-minutes before any release workflow. Nine merged sprints would cost
roughly 600 runner-minutes if the workflows and timings stayed unchanged.
Re-measure these values when workflows change.

Therefore:

- Do not make one PR per low-level checkbox.
- Do not push every small correction. Run focused local tests first, then push a
  coherent review point.
- PR CI uses fake providers and deterministic fixtures. It must not download
  model weights, build `llama.cpp` from source, or run live inference.
- Path-filter native/model packaging jobs so documentation, deterministic
  TypeScript, and ordinary UI changes do not pay sidecar installation cost.
- Real sidecar/model matrices belong in explicit manual or scheduled acceptance
  workflows until their duration and reliability justify required status.
- Release workflows package already pinned, checksummed sidecar binaries. They
  must not fetch a moving upstream asset or compile native code opportunistically.

### PR size and split rules

A delivery task should normally stay under 20 meaningfully changed files and
1,000 handwritten changed lines, excluding generated Paraglide files, lockfiles,
fixtures, vendored checksums, and snapshots. Crossing either threshold triggers
a challenge review before more code is added.

Split only at a working, user- or architecture-visible seam. A split PR must
leave `main` releasable, must not expose a dead control, and must not make a later
PR responsible for repairing an intentionally broken contract.

Good split seams:

- hidden service boundary before visible feature integration;
- deterministic engine before UI integration;
- sidecar lifecycle before model download;
- pure quiz validator before quiz session UI.

Bad split seams:

- types in one PR and their tests in another;
- English in one PR and Spanish in another;
- macOS in one PR with a visible feature while Windows is missing;
- model output first and grounding/privacy validation later;
- a version bump or release notes in a separate PR from the change they describe.

### Challenge gates

Run the `challenge` skill:

- before proposing the first task in each milestone;
- before a PR when scope crosses the size threshold or adds a new dependency,
  redistributed binary, persistence field, native permission, or network path;
- after two failed implementation approaches or any high-severity review
  finding;
- before moving an experimental capability to a normal supported release.

The gate asks four concrete questions:

1. Does the task still solve a learning problem rather than automate authorship?
2. Can it be smaller while leaving a complete, testable seam?
3. Can failure corrupt, rewrite, expose, or falsely accuse student work?
4. Is bilingual and cross-platform evidence strong enough for the proposed
   release status?

## Stable module boundaries

The OpenSpec designs may refine filenames, but they must preserve these seams:

```ts
type DocumentLanguage = "en" | "es";

interface SpellingIssue {
  from: number;
  to: number;
  word: string;
  suggestions: string[];
}

interface SpellingService {
  capability(language: DocumentLanguage): Promise<SpellingCapability>;
  check(request: SpellingRequest): Promise<SpellingIssue[]>;
  addToPersonalDictionary(word: string, language: DocumentLanguage): Promise<void>;
}

interface WritingCoachIssue {
  from: number;
  to: number;
  category: "specificity" | "evidence" | "clarity" | "economy" | "repetition" | "voice";
  explanation: string;
  learningQuestion: string;
  source: "deterministic" | "local-model";
}

type InferenceCorrelation =
  | { requestId: string; documentRevision: number; sourceSnapshotId?: never }
  | { requestId: string; documentRevision?: never; sourceSnapshotId: string };

interface LocalInferenceTaskMap {
  writingCoach: {
    request: WritingCoachRequest;
    result: WritingCoachResult;
  };
  groundedQuiz: {
    request: GroundedQuizRequest;
    result: GroundedQuizResult;
  };
}

type LocalInferenceRequest = {
  [K in keyof LocalInferenceTaskMap]: InferenceCorrelation & {
    task: K;
    input: LocalInferenceTaskMap[K]["request"];
  };
}[keyof LocalInferenceTaskMap];

type LocalInferenceResult = {
  [K in keyof LocalInferenceTaskMap]: InferenceCorrelation & {
    task: K;
  } & (
      | { status: "ok"; output: LocalInferenceTaskMap[K]["result"] }
      | { status: "error"; error: LocalInferenceError }
    );
}[keyof LocalInferenceTaskMap];

type ResultFor<K extends keyof LocalInferenceTaskMap> = Extract<
  LocalInferenceResult,
  { task: K }
>;

interface LocalInferenceProvider {
  capability(): Promise<LocalInferenceCapability>;
  run<K extends keyof LocalInferenceTaskMap>(
    request: Extract<LocalInferenceRequest, { task: K }>,
  ): Promise<ResultFor<K>>;
  cancel(requestId: string): Promise<void>;
}

interface SourceSpan {
  sourceId: string;
  snapshotId: string;
  from: number;
  to: number;
  unit: "utf16";
}

interface GroundedQuestion {
  question: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  explanation: string;
  distractorExplanations: [string, string, string, string];
  provenance: {
    question: SourceSpan[];
    options: [SourceSpan[], SourceSpan[], SourceSpan[], SourceSpan[]];
    explanation: SourceSpan[];
    distractorExplanations: [SourceSpan[], SourceSpan[], SourceSpan[], SourceSpan[]];
  };
}
```

The caller creates an unguessable request ID before dispatch and includes it
with the document revision or immutable source-snapshot identity. Every success
and error repeats that correlation data. Cancellation owns only the matching
request ID, and consumers reject results whose revision or snapshot no longer
matches the active view.

The webview may call typed Tauri commands. It may not connect directly to a
loopback model server, own its process, choose arbitrary model paths, or pass
unbounded document content.

## Milestone map

### Agile hierarchy

Use the hierarchy consistently in OpenSpec proposals, branch notes, and status
updates:

```text
Program: Local learning tools
  Epic E1: Bilingual writing foundations
    Milestone M1: Bilingual spelling
      Sprint LT-01: spelling service
      Sprint LT-02: spelling experience
    Milestone M2: Learning-oriented writing coach
      Sprint LT-03: deterministic coach engine
      Sprint LT-04: coach experience
  Epic E2: Optional local intelligence
    Milestone M3: Managed local inference
      Sprint LT-05: sidecar boundary
      Sprint LT-06: model installation
      Sprint LT-07: experimental local coaching
  Epic E3: Grounded study practice
    Milestone M4: Multiple-choice quizzes
      Sprint LT-08: grounded quiz engine
      Sprint LT-09: quiz sessions
```

A sprint here is a delivery slice, not a fixed calendar promise. Its OpenSpec
`tasks.md` contains the engineering tasks and tests. Do not convert each
checkbox into another sprint, branch, or PR.

| Epic | Milestone | Outcome | Sprints | Exit gate |
| --- | --- | --- | --- | --- |
| E1 | M1 | Bilingual spelling without AI | LT-01, LT-02 | macOS and Windows capability parity; accessible correction flow; no model required |
| E1 | M2 | Deterministic learning-oriented writing coach | LT-03, LT-04 | reviewed bilingual corpus; six categories; no authorship claim or automatic rewrite |
| E2 | M3 | Optional local-model coaching | LT-05, LT-06, LT-07 | security, privacy, bilingual quality, schema, performance, packaging, and failure gates pass |
| E3 | M4 | Grounded multiple-choice study quizzes | LT-08, LT-09 | exactly one supported answer, explanations and source spans for every displayed question |

Milestones are sequential. Tasks within a milestone are sequential. Research or
read-only evaluation may run in parallel, but implementation writers may not.

## Status ledger

| ID | OpenSpec change | Status | Depends on |
| --- | --- | --- | --- |
| P0 | None; canonical planning only | In progress | Plan approval |
| LT-01 | `add-bilingual-spelling-service` | In review | Current-head diagnostics, private installers, and current-arm64 packaged/manual proof required; physical Intel/Windows proof deferred to the final rollout gate |
| LT-02 | `add-bilingual-spelling-experience` | Planned | LT-01 merged and verified |
| LT-03 | `add-bilingual-writing-coach-engine` | Planned | M1 complete |
| LT-04 | `add-writing-coach-experience` | Planned | LT-03 merged and verified |
| LT-05 | `add-local-inference-sidecar` | Planned | M2 complete |
| LT-06 | `add-local-model-installation` | Planned | LT-05 merged and verified |
| LT-07 | `add-experimental-local-coaching` | Planned | LT-06 merged and model gates pass |
| LT-08 | `add-grounded-quiz-engine` | Planned | LT-07 evidence accepted |
| LT-09 | `add-grounded-quiz-sessions` | Planned | LT-08 merged and verified |

Allowed status values are `Planned`, `Proposed`, `Approved`, `In progress`,
`In review`, `Merged`, `Blocked`, and `Deferred`. A status change must name the
evidence in the task's OpenSpec or PR; this table is an index, not proof.

## Challenge record

**Date:** 2026-08-22

**Challenge:** Yellow

**Evidence:** The program crosses editor behavior, additive persistence, two
native platform APIs, redistributed binaries, optional network download,
probabilistic output, bilingual pedagogy, and release workflows. Several
delivery tasks contain more than three behavioral concerns, and shared editor,
Paraglide, Cargo, and Tauri files make parallel implementation collision-prone.

**Why this is broader than one defect:** A weak boundary could expose student
text, confuse model advice with APA authority, ship uneven platform behavior, or
turn a learning tool into automated authorship. Green unit tests alone would not
prove those invariants.

**Required before continuing:** Keep the nine sprints sequential, approve one
OpenSpec scope before each implementation, preserve the hidden-boundary/visible-
feature splits, and challenge any sprint crossing the PR size signal or adding a
new native permission, dependency, persistence field, binary, or network path.

**Decision:** Continue with the nine-PR strategy. Split a sprint only if its
approved design or measured implementation crosses a working seam; do not split
merely to make the diff numerically smaller.

---

## LT-01: Add the bilingual spelling service

**OpenSpec change:** `add-bilingual-spelling-service`

**Purpose:** Establish and prove the hidden host spelling boundary on macOS and
Windows before exposing UI or promising the feature.

**Likely files:**

- Create `apps/desktop/src/lib/spelling/types.ts`.
- Create `apps/desktop/src/lib/spelling/service.ts`.
- Create `apps/desktop/src/lib/spelling/service.test.ts`.
- Create `apps/desktop/src-tauri/src/spelling.rs` or platform-specific modules
  selected by the approved design.
- Modify `apps/desktop/src-tauri/src/lib.rs` to register bounded commands.
- Modify `apps/desktop/src-tauri/Cargo.toml` and lock data only if the native
  adapter needs approved dependencies.
- Add a platform proof script under `scripts/` only if unit/native integration
  tests cannot exercise installed dictionary capability in a packaged app.

**OpenSpec tasks must cover:**

1. Record English/Spanish results from a native WKWebView and WebView2 spelling
   spike. The proof must distinguish unavailable API, missing dictionary, and
   valid no-issue text.
2. Choose the smallest adapter that satisfies the contract. Browser-native
   behavior is acceptable only if it exposes issue ranges, suggestions,
   replacement, ignore, and keyboard-accessible traversal on both platforms.
   Otherwise specify macOS `NSSpellChecker` and Windows `ISpellChecker` adapters.
3. Define typed request/result/error contracts. Requests include document
   language and bounded text/ranges; results use document offsets and never
   contain arbitrary filesystem data.
4. Add failing contract tests for English, Spanish, punctuation, Unicode,
   repeated words at different positions, empty text, stale document revision,
   missing dictionary, cancellation, and adapter failure.
5. Implement capability detection and bounded checking. Do not add grammar,
   style, AI inference, editor decorations, or settings UI.
6. Prove that the service checks body prose and paper title but provides an
   exclusion contract for generated citations/references, URLs, equations,
   identifiers, author/institution/course/instructor metadata, and other
   proper-name-heavy fields.
7. Record dependency and platform API licenses. Do not bundle third-party
   dictionaries in this task.
8. Run current-head hosted macOS arm64, current Intel, and Windows diagnostics;
   construct private proof installers for macOS and Windows; and record one
   packaged/manual current-arm64 bilingual pass. Physical Intel and Windows
   target runs belong to the final rollout gate below, not this hidden-service
   PR.

**Acceptance evidence:**

- Focused TypeScript and Rust contract tests pass.
- English and Spanish misspellings return stable ranges and suggestions on both
  platform families, or the feature remains hidden with a precise blocked
  capability reason.
- Missing OS dictionaries return install/help guidance codes, not a silent
  fallback to another language.
- Current-head hosted diagnostics pass, private macOS and Windows proof
  installers are constructed, and a downloaded current-arm64 package completes
  the bilingual manual proof.
- No essay, app setting, UI, model, or network behavior changes.
- `deno task check`, relevant Rust tests, formatting/lint as applicable, and
  strict OpenSpec validation pass.

**Stop conditions:** Stop and challenge if the only viable implementation
requires an incompatible dictionary license, transmitting text, or shipping a
visible macOS-only/Windows-only feature.

**PR boundary:** One hidden service and platform proof. Suggested title:
`Add the bilingual spelling service boundary`.

**Rollback:** Remove the unreferenced adapter and command registration; no user
data migration or document change exists.

---

## LT-02: Ship the bilingual spelling experience

**OpenSpec change:** `add-bilingual-spelling-experience`

**Purpose:** Integrate the proven service into the editor with explicit student
control and durable, correctly scoped preferences.

**Likely files:**

- Create `apps/desktop/src/lib/editor/spelling.ts` and focused tests.
- Create `apps/desktop/src/lib/components/SpellingMenu.svelte` and tests.
- Create `apps/desktop/src/lib/components/SpellingSettings.svelte` and tests.
- Modify `apps/desktop/src/lib/editor/createEditor.ts` and
  `apps/desktop/src/lib/components/Editor.svelte`.
- Modify `apps/desktop/src/lib/components/EditorScreen.svelte` at the narrow
  integration seam.
- Modify `apps/desktop/src/lib/model/essay.ts` and its validation/persistence
  tests only for document-scoped ignores.
- Modify `apps/desktop/src/lib/state/uiLocale.svelte.ts` and tests for the
  device-local enable flag and personal dictionaries.
- Add English and Spanish Paraglide messages and regenerate output through the
  existing project command.

**OpenSpec tasks must cover:**

1. Add failing editor tests for underlines, context-menu suggestions, explicit
   replacement, Ignore once, Ignore in this document, Add to personal
   dictionary, and Next spelling issue.
2. Define document-ignore persistence as an optional additive schema-version-2
   field. Prove old essays load unchanged and portable archives retain the
   document-owned ignore list.
3. Extend schema-version-1 app settings additively with spelling enabled by
   default and editable/clearable English and Spanish personal dictionaries.
   Prove device settings do not enter essay or library exports.
4. Wire checks to `essay.settings.documentLanguage`, not UI locale. When a user
   changes document language, clear stale decorations and recheck with the new
   dictionary.
5. Extract only student-authored prose. Exclude generated references/citations,
   URLs, equations, identifiers, and proper-name metadata defined by LT-01.
6. Debounce checks, discard stale results by document revision, cap request
   size, and cancel outstanding work on editor destruction or essay switch.
7. Make every correction student-approved. Do not add autocorrect, automatic
   replacement, grammar, or style advice.
8. Add accessible semantics: non-color-only issue indication, keyboard access,
   focus return, screen-reader labels, and live status that does not announce on
   every keystroke.
9. Add localized missing-dictionary guidance using UI locale while naming the
   unavailable document language accurately.
10. Update version, CHANGELOG, README capability wording, and release evidence
    if the PR is approved for `main`.

**Acceptance evidence:**

- Component/editor tests cover UI locale different from document language.
- Old essays and old `settings.json` load without mutation or schema bump.
- Ignore in document travels with the essay; personal dictionary remains only
  on the device and can be edited/cleared.
- A correction changes only the selected spelling range and remains undoable
  through normal editor history.
- Both platform packaged apps complete the same keyboard correction journey.
- `deno task check`, `deno task test`, applicable Rust tests, `deno fmt`,
  `deno lint`, Svelte autofix, and strict OpenSpec validation pass.

**Stop conditions:** Stop and challenge if editor mapping cannot reliably keep
issue ranges aligned after edits or if a platform cannot expose an accessible
correction flow.

**PR boundary:** Complete spelling user value; no writing-coach code. Suggested
title: `Add bilingual spelling help to the editor`.

**Rollback:** Hide the integration and retain optional additive stored fields;
older builds must ignore them safely.

---

## LT-03: Add the deterministic bilingual writing-coach engine

**OpenSpec change:** `add-bilingual-writing-coach-engine`

**Purpose:** Prove useful, non-accusatory learning feedback before introducing a
model or UI complexity.

**Likely files:**

- Create `apps/desktop/src/lib/learning/coach/types.ts`.
- Create `apps/desktop/src/lib/learning/coach/rules.ts` and tests.
- Create `apps/desktop/src/lib/learning/coach/unslopV1.ts` and tests.
- Create bilingual fixtures under
  `apps/desktop/src/lib/learning/coach/fixtures/`.
- Create `apps/desktop/src/lib/learning/coach/evaluate.ts` for corpus scoring.

**OpenSpec tasks must cover:**

1. Build a human-reviewed English/Spanish corpus containing weak, competent,
   AI-assisted, and second-language writing. Strip personal data and use only
   material the project may redistribute.
2. Define exactly six observable categories: specificity, evidence, clarity,
   economy, repetition, and voice. Every finding requires an exact source span,
   short explanation, and learning question.
3. Write failing tests for each category, competent passages, bilingual
   punctuation/diacritics, short fragments, citations, quotations, repeated
   findings, and overlapping spans.
4. Implement deterministic rules with conservative thresholds. An evidence
   finding may say a claim may need support or explanation; it may not declare
   the claim false or uncited from insufficient context.
5. Package `unslopV1` as a versioned internal output policy. It applies only to
   Tesina-generated feedback and later quiz/example text. It prohibits canned
   AI phrasing, inflated headings, fake personal experience, slang, deliberate
   errors, and needless repetition.
6. Write Spanish rules and examples as native academic Spanish, not literal
   translations of an English phrase list.
7. Add a deterministic post-generation audit contract now, even though local
   generation is deferred. Permit at most one later corrective generation.
8. Add evaluator output by language, category, corpus cohort, usefulness, and
   false positives. Store aggregate fixtures/results, never telemetry.

**Acceptance evidence:**

- Corpus licensing/provenance and reviewer rubric are recorded.
- Every result points to observable text and never authorship.
- Competent English and Spanish examples have an accepted false-positive rate
  defined by the approved OpenSpec; the stricter model gates in LT-07 remain
  unchanged.
- Engine is pure TypeScript with no Tauri, network, persistence, or editor
  mutation.
- Focused tests, `deno task check`, `deno task test`, formatting/lint as
  applicable, and strict OpenSpec validation pass.

**Stop conditions:** Stop and revise the rubric if reviewers cannot agree on
what a category means or if second-language writing is systematically treated
as poor writing.

**PR boundary:** Deterministic engine, corpus, and policy only. Suggested title:
`Add the bilingual writing-coach rubric`.

**Rollback:** Remove the unused engine; no document or device state exists.

---

## LT-04: Ship the deterministic writing-coach experience

**OpenSpec change:** `add-writing-coach-experience`

**Purpose:** Give students clear, optional feedback that asks them to think and
revise, without generating their paper.

**Likely files:**

- Create `apps/desktop/src/lib/components/learning/WritingCoachPanel.svelte`
  and tests.
- Create `apps/desktop/src/lib/state/writingCoach.svelte.ts` and tests.
- Modify `apps/desktop/src/lib/components/EditorScreen.svelte`.
- Modify the editor only for selection/highlight navigation, not schema.
- Add English and Spanish Paraglide messages.

**OpenSpec tasks must cover:**

1. Design separate Writing coach navigation from APA Check. Never combine their
   counts, authority, visual language, or export consequences.
2. Add failing component tests for empty state, finding navigation, exact source
   highlight, learning question, issue dismissal, Not helpful, and essay switch.
3. Run deterministic checks after a bounded debounce. Keep findings ephemeral;
   do not persist them in the essay, backups, app settings, or telemetry.
4. Make Not helpful hide that finding until the underlying text changes or the
   session ends. Store no cross-session profile.
5. Use UI locale for controls/explanations/questions and preserve quoted student
   text unchanged. Analyze with document language.
6. Keep edits in the editor. The panel may navigate and teach but may not insert
   a rewrite, alter the document, or affect APA/export status.
7. Add accessibility, reduced-motion, focus, live-region, and narrow-window
   coverage.
8. Update version, release notes, and user documentation if approved for `main`.

**Acceptance evidence:**

- A student can find an issue, understand it, revise in the editor, and see the
  issue disappear without Tesina writing the answer.
- All six categories render clearly in English and Spanish.
- Dismissal and Not helpful are session-only and produce no network/storage
  writes.
- APA Check and export tests are unchanged except for explicit non-interference
  coverage.
- Full repository gates, Svelte autofix, and strict OpenSpec validation pass.

**Stop conditions:** Stop if the UI encourages accepting machine text instead
of revising, or if coach findings look like APA errors or misconduct warnings.

**PR boundary:** Complete deterministic coach UI; no sidecar or model controls.
Suggested title: `Add a bilingual writing coach for student revision`.

**Rollback:** Remove the panel and state; the deterministic engine may remain as
an unused, tested module.

---

## LT-05: Add the managed local-inference sidecar boundary

**OpenSpec change:** `add-local-inference-sidecar`

**Purpose:** Establish process, transport, and security controls with a fake
provider before downloading or running a real model.

**Likely files:**

- Create `apps/desktop/src/lib/local-ai/types.ts` and client tests.
- Create `apps/desktop/src-tauri/src/local_ai/mod.rs`.
- Create `apps/desktop/src-tauri/src/local_ai/process.rs`.
- Create `apps/desktop/src-tauri/src/local_ai/proxy.rs`.
- Add fake-sidecar fixtures under `apps/desktop/src-tauri/tests/` or `scripts/`.
- Modify Tauri capabilities/configuration, `lib.rs`, Cargo metadata, and CI path
  filters as required by the approved design.

**OpenSpec tasks must cover:**

1. Threat-model webview compromise, loopback cross-talk, arbitrary model paths,
   command injection, stale processes, port collision, oversized input/output,
   response smuggling, logs, crash recovery, and update tampering.
2. Define a discriminated capability and error contract. Bind each task request
   to only its matching success result and add compile-time tests that reject
   writing-coach/quiz cross-pairs. Treat unsupported hardware, sidecar absent,
   not installed, busy, cancelled, invalid response, out of memory, and crash as
   ordinary recoverable states.
3. Add a fake executable that speaks the minimum accepted protocol. Use it for
   deterministic lifecycle tests; do not download weights in normal CI.
4. Have Rust start the process on demand with an ephemeral loopback port and a
   per-process secret, disable web UI/tools, proxy bounded typed requests, and
   own cancellation and shutdown.
5. Prevent the webview from connecting directly to localhost or choosing an
   executable/model path. Audit Tauri CSP and capability changes narrowly.
6. Redact student text and generated output from logs. Add tests that inspect
   captured logs and error payloads.
7. Prove cleanup after normal close, updater restart, crash, cancellation, and
   failed startup. Stop only the exact child process owned by the current app.
8. Add path-filtered native packaging verification. Pin prebuilt binaries by
   platform, version, source, license, and checksum; do not compile upstream on
   every PR.

**Acceptance evidence:**

- Fake-provider integration proves lifecycle, auth, bounds, cancellation,
  shutdown, and recovery on macOS and Windows.
- Direct unauthenticated inference and model requests fail. The public health
  endpoint is tested separately and may return only a non-sensitive readiness
  state with no document, model-path, prompt, or generated-content data.
- The webview cannot request arbitrary commands, paths, or endpoints.
- No essay/model text appears in application or sidecar logs.
- Ordinary PR CI remains weight-free and source-build-free.
- Rust/TypeScript checks, threat-model assertions, package smoke, and strict
  OpenSpec validation pass.

**Stop conditions:** Stop if security requires broad shell/filesystem/network
permission, if the child cannot be reliably identified and terminated, or if a
prebuilt redistribution license is unacceptable.

**PR boundary:** Runtime seam with fake provider; no model downloader or visible
AI feature. Suggested title: `Add the secure local-inference runtime boundary`.

**Rollback:** Remove the dormant command/module and packaging fixture; no model
or user setting has been created.

---

## LT-06: Add consented local-model installation

**OpenSpec change:** `add-local-model-installation`

**Purpose:** Safely install, verify, update, and remove optional model weights
without bloating the application installer.

**Likely files:**

- Create `apps/desktop/src-tauri/src/local_ai/models.rs` and tests.
- Create `apps/desktop/src/lib/state/localModel.svelte.ts` and tests.
- Create `apps/desktop/src/lib/components/learning/LocalModelSettings.svelte`
  and tests.
- Add a signed/versioned manifest under an application-owned resource path.
- Add English and Spanish Paraglide messages.
- Modify release/CI scripts only for manifest and sidecar artifact verification.

**OpenSpec tasks must cover:**

1. Specify the model manifest: task compatibility, model ID/version, exact URL,
   SHA-256, expected bytes, license, minimum free disk, estimated working memory,
   context cap, sidecar compatibility, signing-key ID, and revoked status. Pin
   the manifest trust root in the application. A remote manifest may select only
   a known active signing-key ID; it may not add or replace trusted keys. Key
   rotation or revocation requires an application update that ships the new
   active/revoked key set, with an overlap period for a planned rotation.
2. Select Qwen3.5 2B Q4_K_M as the evaluation target with a hard model-file
   ceiling of 1.5 GB. Keep Qwen3.5 0.8B only as a lower-bound benchmark. Do not
   silently choose a larger fallback.
3. Add failing Rust tests for unknown and revoked signing keys, invalid or
   tampered manifest signatures before download and before activation,
   free-space preflight, partial download, resume or clean restart, checksum
   mismatch, manifest mismatch, cancellation, atomic activation, old-model
   cleanup, removal, and concurrent attempts.
4. Require explicit consent showing download size, storage location class,
   offline behavior, license, privacy, and Remove action before network access.
5. Fail closed before network access when manifest trust validation fails.
   Download through Rust to a temporary application-owned path, enforce byte
   limits while streaming, revalidate manifest trust and checksum before
   activation, then atomically activate.
6. Separate model updates from app updates. Never replace a working model until
   the replacement is complete and verified.
7. Add a capability probe that loads the model with the production context cap,
   reports failure clearly, and leaves deterministic features usable.
8. Add settings UI for status, progress, cancel, retry, model details, and
   removal. Label the future feature `Local AI - Experimental`.
9. Prove normal application installation and update do not download weights.

**Acceptance evidence:**

- Installer-size comparison shows only pinned sidecar overhead, not model
  weights.
- Network trace shows no model access before consent and no network requirement
  after a successful installation for inference.
- Corrupt/oversized/interrupted downloads never become active.
- Remove deletes only the verified application-owned model target and leaves
  essays/settings intact.
- Packaged macOS arm64/x64 and Windows x64 capability probes are recorded.
- Full relevant checks and strict OpenSpec validation pass.

**Stop conditions:** Stop if the 2B candidate exceeds the file ceiling, cannot
run within the accepted hardware envelope, lacks acceptable redistribution
terms, or requires a moving/unverifiable download URL.

**PR boundary:** Model lifecycle and settings only; no generated feedback.
Suggested title: `Add optional local-model installation`.

**Rollback:** Remove the settings entry point and manifest; retain an explicit
Remove path for any model already installed by a pre-release build.

---

## LT-07: Ship experimental local coaching

**OpenSpec change:** `add-experimental-local-coaching`

**Purpose:** Enhance selected-text coaching only after the chosen lean model
passes bilingual, privacy, grounding, schema, and performance gates.

**Likely files:**

- Create `apps/desktop/src/lib/local-ai/tasks/writingCoachV1.ts` and tests.
- Create `apps/desktop/src/lib/local-ai/validation/writingCoach.ts` and tests.
- Extend `WritingCoachPanel.svelte`, its state, and tests.
- Add approved evaluation fixtures/results under `docs/research/evaluations/` or
  the location selected by OpenSpec.
- Add explicit manual/scheduled packaged model acceptance workflows.

**OpenSpec tasks must cover:**

1. Freeze `writingCoachV1`: selected text, document language, bounded nearby
   context, six-category rubric, JSON schema, non-thinking mode, context/token
   limits, timeout, and cancellation.
2. Send no full paper, title-page identity metadata, reference library, file
   path, or hidden editor state. Preserve quoted student text exactly.
3. Add schema and semantic validators for bounds, exact source spans, allowed
   categories, concise explanation, learning question, and no authorship claims.
4. Apply `unslopV1` to generated feedback. Ground first, style, validate again;
   permit at most one corrective generation. Discard an invalid final response.
5. Add explicit Review selected text. Do not invoke the model on each keystroke
   or automatically review a full essay.
6. Ask a learning question before any example. Make the example optional only
   after the student revises; require accept/reject and normal editor undo. Do
   not offer whole-passage automatic rewriting.
7. On invalid JSON, timeout, out of memory, crash, or cancellation, preserve the
   essay, explain the failure, and keep deterministic findings available.
8. Evaluate at least 60 passages per language across the approved cohorts.
   Require at least 80% of displayed findings to be useful, no more than 10% of
   competent passages to receive a material false positive, at least 65% model
   preference over deterministic-only feedback, and at least 99% schema-valid
   raw responses.
9. Require first visible progress within 2 seconds, paragraph completion within
   15 seconds on accepted minimum hardware, and immediate cancellation feedback.
10. Prove loopback-only transport, no logs/telemetry, no network after model
    install, and bounded selected-text payloads.
11. Have one bilingual educator and a second bilingual reviewer independently
    score blind English and Spanish outputs. AI translation checks are advisory,
    never the release authority.
12. Update version, release notes, experimental disclosure, model information,
    and privacy documentation if all gates pass.

**Acceptance evidence:**

- Publish the aggregate bilingual rubric results and hardware matrix; do not
  include student-identifying text.
- Every displayed model finding passes schema, grounding, and unslop audits.
- Failure matrix proves no document mutation and deterministic fallback.
- UI clearly separates deterministic findings from optional local-model review
  without presenting either as authorship detection.
- Required CI uses fakes; real-model acceptance is independently recorded.
- Full repository, packaged-platform, Svelte, OpenSpec, and release gates pass.

**Stop conditions:** If Qwen3.5 2B fails any hard gate, do not ship local model
coaching and do not silently move to a larger model. Keep the deterministic
coach, record the failed evidence, and open a new research decision only if the
product goal still justifies it.

**PR boundary:** One opt-in experimental addition to the existing coach.
Suggested title: `Add experimental local coaching for selected text`.

**Rollback:** Disable the experimental entry point and model task while keeping
model removal and deterministic coaching functional.

---

## LT-08: Add the grounded multiple-choice quiz engine

**OpenSpec change:** `add-grounded-quiz-engine`

**Purpose:** Generate study questions from selected Tesina content while making
the source, correct answer, and distractor reasoning inspectable.

**Likely files:**

- Create `apps/desktop/src/lib/learning/quiz/types.ts`.
- Create `apps/desktop/src/lib/learning/quiz/validate.ts` and tests.
- Create `apps/desktop/src/lib/learning/quiz/session.ts` and tests.
- Create `apps/desktop/src/lib/local-ai/tasks/quizFromMaterialV1.ts` and tests.
- Add bilingual quiz fixtures and evaluator output.

**OpenSpec tasks must cover:**

1. Freeze `quizFromMaterialV1`: selected source passages, document language,
   requested count, bounded difficulty, four options, one correct index,
   explanation for the answer and each distractor, and exact source spans.
2. Accept only selected Tesina content. Defer PDF, DOCX, web, course-platform,
   clipboard-library, and whole-library ingestion.
3. Require at least 300 selected words for 5 questions and 600 for 10, with a
   5,000-word maximum. Reject unsupported counts.
4. Add deterministic validators for exactly four non-duplicate options, exactly
   one supported correct answer, source-span containment, answer support,
   distractor contradiction/non-support, language, and prohibited free-text or
   select-all forms.
5. Generate directly in the document language. Do not generate English and then
   translate to Spanish.
6. Apply `unslopV1` after grounding, then rerun grounding and schema validation.
7. Reject ambiguous or ungrounded questions. Attempt at most three bounded
   replacements; return a smaller honest quiz rather than lowering validation.
8. Define one-attempt session state separately from generation. The answer is
   unavailable until the student selects an option; afterward reveal the
   correct option, explain all distractors, and expose source navigation.
9. Keep scores and concepts ephemeral. Do not persist quiz history, grades, a
   professor dashboard, telemetry, or misconduct signals.
10. Evaluate at least 50 human-reviewed questions per language. Require 100%
    exactly-one-supported-correct answers, at least 90% plausible-but-wrong
    distractors, and zero missing source spans among displayed questions.
11. Have two bilingual reviewers blind-score meaning, terminology, fluency,
    ambiguity, and educational usefulness. Use model translation checks only as
    a precheck.

**Acceptance evidence:**

- Validator mutation tests catch a second correct answer, unsupported answer,
  copied/duplicate distractor, missing span, wrong language, and post-style
  grounding drift.
- Replacement exhaustion returns fewer questions with a clear reason.
- Evaluation meets every hard bilingual gate before UI work begins.
- No persistence, editor mutation, or professor-facing state is introduced.
- Focused/full checks and strict OpenSpec validation pass.

**Stop conditions:** Stop if a lean model cannot reliably produce uniquely
answerable grounded questions. Do not weaken the one-correct-answer or source
requirements to reach a requested count.

**PR boundary:** Pure contracts, validator, model task, fixtures, and evaluation;
no visible quiz session. Suggested title: `Add the grounded quiz generation contract`.

**Rollback:** Remove the unreferenced engine; no user or document state exists.

---

## LT-09: Ship grounded multiple-choice study sessions

**OpenSpec change:** `add-grounded-quiz-sessions`

**Purpose:** Let a student privately practice selected material with one answer,
immediate teaching feedback, and direct source review.

**Likely files:**

- Create `apps/desktop/src/lib/components/learning/QuizSetup.svelte` and tests.
- Create `apps/desktop/src/lib/components/learning/QuizSession.svelte` and tests.
- Create `apps/desktop/src/lib/state/quizSession.svelte.ts` and tests.
- Modify `EditorScreen.svelte` for selected-source capture and source navigation.
- Add English and Spanish Paraglide messages.

**OpenSpec tasks must cover:**

1. Add Start study quiz from a valid editor selection. Show selected word count,
   available 5/10 question choices, privacy, local-model requirement, and what
   happens when fewer questions validate.
2. Snapshot the selected source and document revision at start. If the document
   changes, keep the quiz tied to the visible snapshot and label it; never
   silently remap answers to changed text.
3. Present one question at a time with four radio-style options and a single
   Submit answer action. Prevent a second attempt for that question.
4. After submission, reveal the correct answer, explanation, why each distractor
   is wrong, and View in source. Do not reveal correctness before submission.
5. Show ephemeral session progress and final score by concept/source area. Do
   not store history or report it elsewhere.
6. Handle model absent, generation progress, cancel, smaller validated quiz,
   invalid response, out of memory, crash, and document close without losing
   essay edits.
7. Use document language for question/options/answer/explanations and UI locale
   for controls/status. Test both mixed-locale directions.
8. Add keyboard-only, screen-reader, focus, narrow-window, reduced-motion, and
   source-highlight coverage.
9. Prove no free-text input, select-all, professor dashboard, grading export,
   telemetry, or persistent student profile exists.
10. Update version, release notes, experimental disclosure, privacy/help text,
    and screenshots only after packaged acceptance passes.

**Acceptance evidence:**

- End-to-end component tests cover 5 and 10 requests, a smaller validated quiz,
  all four answer positions, one-attempt enforcement, explanations, and source
  navigation.
- Packaged macOS and Windows sessions use the pinned model and pass the same
  privacy/failure checks as LT-07.
- A bilingual educator completes representative English and Spanish sessions
  and signs the rubric without seeing model identity.
- Closing or cancelling a quiz leaves the essay and autosave state unchanged.
- Full repository, packaged-platform, Svelte, OpenSpec, and release gates pass.

**Stop conditions:** Stop if the UI can reveal an answer early, accept multiple
answers, lose the source snapshot, or display any question that failed LT-08's
validator.

**PR boundary:** Complete private study session using the already accepted quiz
engine. Suggested title: `Add grounded multiple-choice study quizzes`.

**Rollback:** Hide the quiz entry point and clear ephemeral session state; keep
model removal and writing coach behavior intact.

---

## Program-level risks and mitigations

| Risk | Consequence | Required mitigation |
| --- | --- | --- |
| "AI slop" becomes authorship detection | False accusations, especially for second-language students | Observable writing categories only; no probability or misconduct language; bilingual cohort review |
| Small model produces confident but unsupported feedback | Student learns incorrect material | Exact spans, bounded context, deterministic validators, discard invalid output, no cloud/larger fallback |
| Spanish is treated as translated English | Awkward or misleading pedagogy | Direct Spanish generation, native Spanish examples, two bilingual reviewers, AI translation only as precheck |
| Sidecar creates more ways to attack the desktop app | Text exposure or arbitrary process access | Rust ownership, ephemeral loopback, per-process key, bounded proxy, no direct webview localhost, no logs/tools |
| Model bloats installer or CI | Slow downloads, builds, releases, and PR feedback | Bundle pinned sidecar only; consented separate weights; fake PR provider; path-filter real model jobs |
| Native spelling differs by platform | Inconsistent visible feature | Capability parity gate, explicit missing-dictionary state, hidden feature until both platforms satisfy contract |
| Coach replaces student thinking | Product defeats its educational goal | Question before example, student revision first, no automatic passage rewrite, explicit accept/reject/undo |
| Quiz has two correct answers | Mis-teaches material and frustrates students | Exactly-one validator, distractor explanations, source spans, replacement cap, smaller honest quiz |
| Generated text sounds synthetic | Low trust and poor learning clarity | Versioned bilingual `unslopV1`, deterministic audit, one corrective pass maximum, human rubric |
| Stored AI analysis becomes surveillance | Privacy and trust failure | Findings, scores, and quiz sessions are ephemeral; no telemetry, history, dashboard, or cloud fallback |
| Nine PRs create process drag | Slow delivery despite small diffs | One PR per useful seam, subtasks inside OpenSpec, sequential fresh-main loop, focused local checks before push |

## Final rollout manual platform gate

After LT-01 through LT-09 are implemented and before any spelling capability is
made visible or included in a public release promise, run the private packaged
spelling proof on all of these physical targets:

- macOS 12 Intel;
- Windows 10 x64 with English and Spanish language features installed;
- Windows 11 x64 with English and Spanish language features installed; and
- a separate Windows packaged case with the requested dictionary absent.

Each bilingual target run must record the OS version and architecture, contract
version, English and Spanish capability, selected language tags, the fixed
misspelling UTF-16 ranges, non-empty suggestions, and overall status. The
separate missing-dictionary run must return the stable `missing-dictionary`
capability and install guidance without falling back to another language.

These physical runs are deliberately deferred to the end of the sequential
rollout so they can be completed together through the established manual E2E
handoff. Hosted diagnostics and constructed installers do not count as these
physical runs. Until every row passes and its evidence is recorded, spelling
stays hidden and Tesina makes no visible cross-platform spelling release
promise.

## Definition of program completion

The program is complete only when LT-01 through LT-09 are merged and verified,
or when an explicit product decision marks later model/quiz milestones Deferred
while retaining a complete deterministic product. Completion also requires:

- canonical ledger matches live Git/OpenSpec/PR state;
- all accepted changes are archived or intentionally active under repository
  policy;
- release notes and versions match landed behavior;
- macOS and Windows packaged evidence exists for every advertised native/model
  capability;
- model and sidecar licenses, hashes, sources, and update policy are documented;
- privacy proof shows no student text telemetry or network inference;
- English and Spanish human-review rubrics meet their hard gates;
- the final rollout manual platform gate above has passed on macOS 12 Intel,
  Windows 10 x64, Windows 11 x64, and the separate missing-dictionary case;
- failure and removal paths work without harming essays or deterministic tools.

This file should be edited when sequence, scope, thresholds, or status changes.
Research notes and individual OpenSpec changes may add evidence, but they must
link back here instead of creating a competing PR strategy.

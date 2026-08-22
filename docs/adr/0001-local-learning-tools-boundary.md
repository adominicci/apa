# ADR-0001: Keep learning assistance deterministic by default and local generation optional

**Status:** Proposed

**Date:** 2026-08-22

## Context

Tesina is a local-first academic word processor whose authoritative behavior is
APA formatting, document structure, citations, references, persistence, and
export. Students also need help noticing weak prose and practicing what they
read. These capabilities must work in English and Spanish and must encourage
learning rather than automate authorship.

Small local language models can help with contextual feedback and grounded quiz
drafting, but they are probabilistic, resource-heavy relative to the app, and
capable of producing plausible errors. A model must not become a prerequisite
for spelling, APA correctness, editing, or access to a student's work.

## Decision

Tesina will use three progressively less authoritative layers:

1. Host operating-system spelling services provide bilingual spelling behind a
   typed adapter. Corrections are always student-approved.
2. A pure deterministic writing-coach engine identifies observable symptoms in
   six categories and asks learning questions. It never identifies AI use.
3. Optional local generation may add context to selected-text coaching and create
   grounded multiple-choice quizzes. It runs through a Rust-managed,
   application-bundled `llama-server` sidecar and separately downloaded,
   verified model weights.

The webview does not connect to the sidecar directly. Rust owns process
lifecycle, loopback authentication, request bounds, cancellation, shutdown,
model paths, and error translation. There is no cloud fallback.

Generated feedback and quiz text use versioned bilingual task contracts and the
internal `unslopV1` output policy. Deterministic schema and grounding validation
run before display. The policy never rewrites or "humanizes" student prose.

The initial model candidate is Qwen3.5 2B Q4_K_M under a hard 1.5 GB model-file
ceiling. It is a candidate, not an entitlement to ship: it must pass the
bilingual quality, false-positive, grounding, schema, privacy, performance, and
platform gates in the canonical delivery plan. Failure stops the model rollout;
Tesina does not silently select a larger model.

## Considered options

### Use only deterministic rules

This is the safest and smallest option and remains the baseline. It cannot
provide the same contextual explanation or varied grounded quiz generation, so
it does not satisfy the complete longer-term learning goal.

### Run an in-process Rust model with Candle or llama.cpp bindings

This can reduce process overhead, but it couples model/runtime failures and
native compilation more tightly to the Tauri process. It also makes native
builds and upgrades harder. The sidecar boundary is easier to contain, test,
replace, and stop.

### Require Ollama or LM Studio

This is useful for local experiments but gives users a second application to
install and configure, weakens lifecycle control, and makes support depend on an
external moving runtime. It is not the production user experience.

### Run inference in the webview with WebGPU/WASM

This avoids a native child process but increases browser-runtime variability,
memory copies, asset delivery complexity, and dependence on WebGPU support. It
also places more model control in the least trusted process.

### Use a cloud model

This reduces local hardware requirements but transmits student writing and
introduces accounts, cost, connectivity, retention, and provider policy. It
conflicts with this feature's local-first privacy boundary.

## Consequences

- Spelling and deterministic coaching can ship and remain useful without any
  model work.
- Local inference adds installer size for the sidecar and separate disk/memory
  use for optional weights, but it does not make the normal installer carry the
  model.
- CI needs fake-provider coverage plus separate packaged acceptance for real
  binaries/models. Normal PR CI must not compile the runtime or download weights.
- macOS and Windows require capability and failure parity before advertising a
  feature.
- Generated content is advisory and can be discarded. APA checks and student
  documents never depend on successful generation.
- Human bilingual review remains necessary even when a model prechecks
  translations or language quality.
- The detailed sequence, quality thresholds, and PR boundaries are canonical in
  `docs/plans/local-learning-tools-delivery.md`.

## Context

See `proposal.md` for motivation and `specs/bilingual-spelling-service/spec.md` for observable behavior. Tesina currently has no spelling service. Its desktop frontend invokes narrow Rust commands, and the native crate already pins `objc2`/AppKit on macOS and `windows` on Windows for other platform work. The document language is only `"en" | "es"`; it is intentionally independent from the Paraglide UI locale. Both platform spelling APIs expose UTF-16 positions, but their availability, dictionary enumeration, suggestions, error models, and threading requirements differ.

The prior native webview spikes did not provide a sufficiently typed and controllable cross-platform boundary for capability, ranges, suggestions, and cancellation. LT-01 therefore uses direct operating-system spelling APIs. No UI consumes the service in this change.

## Goals / Non-Goals

**Goals:**

- Put one typed TypeScript facade in front of two native adapters.
- Preserve one range coordinate system from the native APIs through the future editor caller.
- Make dictionary selection and failure states deterministic, testable, and observable.
- Keep cancellation, correlation, result cleanup, and stale-response handling outside editor components.
- Produce automated and packaged evidence without changing a document or operating-system dictionary.

**Non-Goals:**

- Editor traversal, decorations, correction controls, keyboard navigation, or localization.
- Replacing text, ignoring a word, adding/removing personal dictionary terms, or persistence.
- Grammar, style, writing-coach rules, local inference, telemetry, network access, or a release flag.
- Selecting a document dialect in essay settings; the initial resolver adapts the existing base-language setting to installed dictionaries.

## Decisions

### D1. TypeScript owns the product contract; Rust owns native access

Create `apps/desktop/src/lib/spelling/types.ts`, `service.ts`, and `service.test.ts`. The facade validates caller fields, generates request IDs from one application-session ID source, tracks the current request per caller context, converts `AbortSignal` events to a bounded cancellation command, rejects stale responses, and exposes capability/check results as discriminated unions. Callers cannot provide or reuse native request IDs.

Create a Rust `spelling` module with platform adapters selected by `cfg`. Register only capability, check, and cancellation commands in `lib.rs`. The native command request omits the frontend-only caller context; it receives request ID, revision, language, text, and base UTF-16 offset. Rust returns only serializable correlation, selected language tag, issues, and stable codes.

Alternative: call platform APIs from Svelte/webview behavior. Rejected because the spikes did not expose equivalent explicit capability, suggestions, cancellation, and failure semantics on both targets. Alternative: expose a generic native RPC layer. Rejected because it would broaden authority and leak platform details.

### D2. Direct host adapters use existing dependency families

macOS uses `NSSpellChecker` through the pinned `objc2-app-kit` crate, enabling its `NSSpellChecker` feature and only required Foundation features. It enumerates `availableLanguages`, checks successive misspellings with the selected language, and asks for guesses for each reported word range. AppKit access is scheduled on the required native thread rather than marking Objective-C objects as cross-thread safe.

Windows uses `ISpellCheckerFactory` and `ISpellChecker` through the pinned `windows` crate, enabling only the required `Win32_Globalization` and COM features. Each blocking operation initializes its COM apartment, creates the selected checker, enumerates `ISpellingError` records, and requests suggestions for each issue. COM objects stay within the initialized operation thread.

The adapters do not call `learnWord`, `forgetWord`, `Ignore`, `Add`, `AutoCorrect`, or equivalent mutators. `objc2`, `objc2-app-kit`, `objc2-foundation`, and `windows` retain their existing MIT/Apache-2.0-compatible licensing; feature-only changes do not introduce a dictionary or new redistributable data. Exact feature and lockfile diffs are recorded in acceptance evidence.

Alternative: bundle Hunspell dictionaries. Rejected because it adds redistribution, update, and licensing responsibilities and violates this task's host-dictionary boundary. Alternative: add a spelling crate with bundled language data. Rejected for the same reason and because no additional abstraction is needed over two platform APIs.

### D3. One deterministic dialect resolver is shared by capability and checks

A pure Rust resolver canonicalizes installed BCP-47-like tags case-insensitively, filters to an exact base-language match, deduplicates them, and applies this priority:

1. the generic base tag (`en` or `es`);
2. the fixed preferred tag (`en-US` or `es-ES`);
3. remaining matching tags in case-insensitive lexical order.

Capability returns the chosen native tag. A check resolves again immediately before creating the checker so dictionary removal becomes `missing-dictionary`, not a platform failure or language fallback. Tests feed shuffled, duplicated, mixed-case, and near-match tag lists to the resolver.

Alternative: follow UI locale or operating-system locale. Rejected because those axes are not the document language and would make identical essays behave differently for reasons the contract does not expose. Alternative: require an exact regional setting in the essay. Deferred because it changes schema and product UI beyond LT-01.

### D4. UTF-16 is preserved end to end

TypeScript measures text with `string.length`; macOS uses `NSString`/`NSRange`; Windows spelling offsets are UTF-16 indices. The facade supplies a non-negative document base offset. Rust validates every platform range against the segment length, adds the base with checked arithmetic, slices the exact UTF-16 word without converting offsets through UTF-8 byte indices, and sorts issues by document range.

Results preserve native suggestion order while dropping empty values, exact duplicates, and entries after eight. Any invalid native range fails the whole operation as `adapter-failure`; partial or guessed ranges never cross the boundary.

Alternative: convert to Unicode scalar or grapheme offsets in Rust. Rejected because JavaScript and ProseMirror already address strings in UTF-16 units, and conversion would introduce avoidable ambiguity around non-BMP text.

### D5. Requests are bounded, correlated, and cancellable

The facade rejects text beyond 65,536 UTF-16 code units and invalid correlation/offset fields before invoking Rust. The bound is large enough for a future chunk while limiting main-thread/COM work and serialized payloads; editor integration can choose smaller segments later without changing the service contract. A module-scoped generator combines one application-session nonce with a monotonically increasing `bigint` counter. The counter does not wrap, and no facade instance accepts an externally supplied ID, so an ID cannot be reused during the session.

Rust maintains a request registry keyed by session-unique request ID with a per-request atomic cancellation flag and a hard global capacity of two active checks. Two is the smallest capacity that lets one cancelled or stale call remain in native code while its replacement for the same editor context begins; a capacity of one would defeat latest-request replacement, while a larger unmeasured pool would permit more stalled native calls. Admission and duplicate checks occur under the same registry lock. An over-capacity request returns typed `busy` before capability or platform work.

The check command inserts its entry before native work and only its native exit guard removes that entry. The cancellation command sets the matching flag but never removes the entry, so stalled platform calls cannot be replaced indefinitely and accumulate outside the capacity. Each adapter tests the flag before initialization, between issue iterations, and between suggestion iterations; cancellation discards accumulated issues. Because request IDs are never reused during the application session, a delayed cancellation for an already removed ID cannot match a later request. No hard timeout is added: the platform investigations establish cooperative checkpoints but do not establish a safe duration after which an in-process native API call can be terminated.

After admission, the native boundary resolves language capability before checking text. If capability is available and text is empty, it returns `completed` with the selected tag and no issues without calling `NSSpellChecker`'s check method or `ISpellChecker::Check`; this avoids Windows rejecting empty input while preserving missing-dictionary semantics.

The TypeScript facade tracks the newest `{requestId, documentRevision}` for each caller context. When an invoke resolves, it compares the correlation before returning. A mismatch produces `stale` and discards issues. Starting a newer request also cancels the prior request for that context as a best-effort optimization; correctness does not depend on the native cancellation racing successfully.

Alternative: rely only on ignored JavaScript promises. Rejected because native work would continue unnecessarily and could outlive rapid editing. Alternative: force-kill a worker or thread. Rejected because platform calls are short, cooperative checkpoints are sufficient, and termination would risk leaked native state.

### D6. Eligibility is a pure allowlist, not editor integration

`types.ts` defines the complete text-source union and `service.ts` exports a pure eligibility predicate. Only `body-prose` and `paper-title` return true. Generated citations/references, URLs, equations, identifiers, author/institution/course/instructor metadata, and `proper-name-heavy` return false. Contract tests enumerate every union member so adding a new source requires an explicit eligibility decision.

Alternative: accept arbitrary text and document exclusions only in LT-02. Rejected because the canonical LT-01 boundary requires a proven exclusion contract. Traversing ProseMirror now is also rejected because it would add editor behavior to a hidden service PR.

### D7. Tests separate deterministic contracts from installed-dictionary proof

TypeScript tests use a fake native client for request validation, correlation, capability distinctions, exclusions, stale results, cancellation, and error translation. Rust unit tests use fake adapters for the dialect resolver, UTF-16 range conversion, ordering, suggestion filtering, cancellation cleanup, and stable failures. Platform-gated deterministic seam tests cover adapter translation and cancellation. A serialized native proof executable exercises the real macOS adapter on its process main thread and the real Windows adapter when dictionaries are available, reporting a precise block reason otherwise.

Add a small proof harness only if existing Rust integration tests cannot run through the packaged command path. The proof emits structured non-document fixtures for English and Spanish: capability, selected tag, known misspelling, range, suggestions, contract version, platform/target, and pass/block status. It never emits user text, installed dictionary contents, or native error details.

The acceptance matrix is current macOS arm64 automation, current macOS Intel automation, one recorded macOS 12 Intel manual or self-hosted run, packaged Windows 10 x64, and packaged Windows 11 x64. Both Windows acceptance environments explicitly install English and Spanish language features; a separate packaged Windows case removes or withholds the requested dictionary to prove `missing-dictionary`. Ordinary hosted CI continues running deterministic fake-adapter tests and may record a real capability block, but its runner image does not replace a named OS/architecture acceptance target.

Alternative: accept unit tests alone. Rejected because installed dictionaries and packaging are properties of the target environment, not the fake boundary.

## Risks / Trade-offs

- [Installed dictionaries and their suggestions differ across machines] → Require semantic parity and structured evidence, not identical suggestion strings; always record the selected tag and block visibility when a required language is unavailable.
- [Native calls may have threading constraints] → Keep AppKit work on its required native thread and COM objects inside one initialized Windows operation thread; cover lifecycle cleanup in native tests.
- [Cooperative cancellation cannot interrupt one platform call already executing] → Bound text and suggestions, check cancellation between enumeration steps, and discard all output after cancellation or staleness.
- [A native call stalls after cancellation] → Keep its registry entry and capacity slot until native exit; reject excess work as `busy` instead of allowing an unbounded queue. Do not claim a timeout without evidence that the platform call can be stopped safely.
- [The session counter grows for the lifetime of the app] → Use a non-wrapping integer representation and keep only the counter and nonce, not a growing set of issued IDs.
- [A fixed preferred regional tag may not match every student's dialect] → Prefer a generic installed base dictionary first, expose the actual selected tag, and defer explicit dialect settings to a separately approved product change.
- [Platform APIs may return malformed or overlapping ranges] → Validate each range and fail the operation without partial output rather than repairing native results heuristically.
- [Hosted or packaged runners may lack Spanish dictionaries] → Install both language features on the named Windows acceptance environments, record precise blocks elsewhere, retain the separate missing-dictionary case, and do not bundle a workaround or expose a partial feature.

## Migration Plan

Implement the hidden module with failing contract tests first, then add both adapters and command registration in the same LT-01 branch. Run focused TypeScript/Rust tests, repository gates, and the full named macOS/Windows acceptance matrix. Because nothing calls the service from the editor and no data format changes, deployment does not migrate user state. Rollback removes the unreferenced facade, native module, command registrations, dependency features, tests, and proof harness.

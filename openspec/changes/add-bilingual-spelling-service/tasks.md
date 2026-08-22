## 1. Freeze platform and contract evidence

- [x] 1.1 Add an LT-01 evidence record summarizing the existing WKWebView/WebView2 spikes and the direct-platform investigation: webview behavior does not satisfy the typed parity boundary; macOS uses `NSSpellChecker`; Windows uses `ISpellChecker`; both use installed OS dictionaries and UTF-16 offsets. Record API availability, dictionary availability, issue ranges, suggestions, cancellation limits, and license conclusions without user text.
- [x] 1.2 Define the exact serialized TypeScript/Rust contracts, 65,536-code-unit limit, two-active-request global capacity, typed `busy` result, facade-generated session-unique ID format, text-source allowlist, stable capability/error codes, correlation fields, and dialect priority from the approved spec. Keep editor, persistence, mutation, model, and network types out of the boundary.

## 2. Red: TypeScript facade contracts

- [x] 2.1 Create failing `apps/desktop/src/lib/spelling/service.test.ts` coverage using a fake native client for English/Spanish capability, valid empty issues versus missing dictionary, empty text without a native check call, fixed dialect reporting, bounded/invalid requests, session-unique facade-generated IDs across contexts, late cancellation after later requests start, two-request capacity and typed `busy`, cancelled calls retaining capacity until native exit, punctuation, non-BMP UTF-16 offsets, repeated words, suggestion filtering, every eligible/excluded text source, stale document revisions, and translated adapter failure. Confirm failure because the facade does not exist.
- [x] 2.2 Create `types.ts` and the smallest `service.ts` implementation that satisfies the facade tests: request validation, module-scoped session nonce/monotonic `bigint` ID generation, pure eligibility, native-client injection, latest-request tracking per caller context, `AbortSignal` cancellation, stale-result discard, and typed result/error unions. Run the focused TypeScript suite.

## 3. Red: shared Rust boundary

- [x] 3.1 Add failing Rust unit/contract tests for shuffled installed-tag resolution, exact-base filtering, generic/preferred/fallback priority, available empty text bypassing the platform check API, checked UTF-16 range translation, issue ordering, suggestion filtering, invalid native ranges, two-request admission and `busy`, cancellation retaining capacity until native exit, late cancellation isolation, duplicate active request rejection, registry cleanup/idempotence, and stable error translation. Use fake adapters; confirm the new tests fail before implementation.
- [x] 3.2 Implement the platform-neutral Rust spelling boundary, two-entry request registry, native-exit cleanup guard, cooperative cancellation flag, empty-text fast path after capability resolution, dialect resolver, validated issue conversion, and stable serializable results. Make the focused fake-adapter Rust tests pass without registering commands yet.

## 4. Red/green: macOS `NSSpellChecker` adapter

- [x] 4.1 Add failing macOS-gated tests for installed-language capability, English/Spanish known fixtures when available, UTF-16 range/suggestion extraction, missing dictionary, adapter failure translation, and cancellation checkpoints; record a precise capability block rather than silently passing when a required dictionary is absent.
- [x] 4.2 Enable only the required pinned `objc2-app-kit`/Foundation features and implement the read-only `NSSpellChecker` adapter on the required native thread. Enumerate installed tags, iterate misspellings and guesses with cancellation checks, and do not call dictionary or ignore-list mutators. Make the focused macOS tests pass.

## 5. Red/green: Windows `ISpellChecker` adapter

- [ ] 5.1 Add failing Windows-gated tests for installed-language capability, English/Spanish known fixtures when available, UTF-16 error/suggestion enumeration, missing dictionary, COM/adapter failure translation, and cancellation checkpoints; record a precise capability block rather than silently passing when a required dictionary is absent.
- [ ] 5.2 Enable only the required pinned `windows` Globalization/COM features and implement the read-only `ISpellCheckerFactory`/`ISpellChecker` adapter with operation-scoped COM initialization. Keep COM objects on their initialized thread, check cancellation between enumeration steps, and do not call `Add`, `Ignore`, `AutoCorrect`, or other mutators. Make the focused Windows tests pass.

## 6. Command registration and end-to-end contract

- [x] 6.1 Add failing command-boundary tests for capability, check, empty-text bypass, duplicate/invalid request rejection, two-request admission and typed `busy`, cancellation without early slot release, late-cancel isolation, registry cleanup on native exit, no partial issues, and no raw native details. Then register only the bounded capability/check/cancel commands in `lib.rs` and make those tests pass.
- [x] 6.2 Run the TypeScript facade against the real Tauri command serialization in a focused integration test, proving correlation and stable unions without adding editor imports, UI, settings, persistence, dictionary mutation, network permissions, or model code.

## 7. Packaged parity and licensing gate

- [x] 7.1 Add or extend a structured proof harness and workflow contract tests so every acceptance target reports OS/version/architecture, contract version, English and Spanish capability, selected tags, known-misspelling UTF-16 ranges, non-empty suggestions, and pass/block status. Use fixed non-document fixtures and redact native error details.
- [ ] 7.2 Run current macOS arm64 and Intel automation and record a macOS 12 Intel manual or self-hosted packaged run. A hosted capability block is diagnostic only and does not replace any named target.
- [ ] 7.3 Run packaged Windows 10 x64 and Windows 11 x64 proof with English and Spanish language features installed, plus a separate packaged missing-dictionary case. A hosted capability block is diagnostic only and does not replace either Windows target.
- [x] 7.4 If any required target lacks its API/dictionaries or fails the contract, record the exact block and keep the feature hidden; do not bundle a dictionary, transmit text, or promise a platform-partial release.
- [x] 7.5 Record the exact Cargo feature/lockfile impact, compatible licenses and source packages for native bindings, and confirmation that no dictionary or other data asset is redistributed.

## 8. Final LT-01 gate

- [x] 8.1 Run focused TypeScript and Rust spelling tests, command/integration tests, `deno task check`, `deno task test`, `deno fmt --check`, `deno lint`, `cargo fmt --check`, `cargo test --locked`, and strict OpenSpec validation; distinguish any environment capability block from a test failure.
- [x] 8.2 Review the final diff against the hidden-service boundary and the single LT-01 branch/PR size gate. Confirm no editor UI, essay/app-setting change, persistence, grammar/style, model, network, OS dictionary mutation, bundled dictionary, or visible release promise entered the change.
- [ ] 8.3 Apply the repository per-change version synchronization and one human CHANGELOG entry only when the implementation is ready for its single main-bound PR; do not create separate checklist PRs or release artifacts.

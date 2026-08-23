## 1. Lock canonical persistence with aligned fixtures

- [ ] 1.1 Add shared failing fixtures for the exact essay and settings spelling fields, 256-entry and 128-UTF-16 bounds, outer-whitespace trimming, NFC display spelling, English and Spanish locale-lowercase keys, first-winner duplicates, controls, and internal whitespace.
- [ ] 1.2 Add failing trusted-mutation tests that reject invalid terms and overflow atomically, treat duplicate keys as no-ops, retain the first display spelling, and never mutate an operating-system dictionary.
- [ ] 1.3 Implement canonical term helpers and the optional `essay.spelling.documentIgnores.en` and `.es` schema-version-2 fields without writing defaults during load.
- [ ] 1.4 Add failing direct essay-load tests that sanitize only malformed optional spelling data in memory, retain the first 256 valid winners, and leave the source file and schema version unchanged.
- [ ] 1.5 Add failing snapshot assembly, archive round-trip, untrusted archive-validation, and semantic-identity tests from the same fixtures, proving canonical document ignores travel and malformed archive input is rejected rather than sanitized.
- [ ] 1.6 Implement portable validation and semantic support for canonical document ignores without a spelling-specific archive channel.
- [ ] 1.7 Add failing `UiSettingsStore` tests for default-enabled spelling, exact personal-dictionary fields, canonical trusted mutation, sanitized direct load without eager write, serialized persistence, and schema version 1 retention.
- [ ] 1.8 Implement device-local spelling settings and prove essay and library exports contain neither the enable flag nor personal dictionary terms.

## 2. Specify extraction and mapping through tests

- [ ] 2.1 Add failing table-driven fixtures for paper title, eligible `paragraph`, `heading`, `tableTitle`, `tableNote`, `figureTitle`, `figureNote`, and `keywordsLine` text, including paragraphs nested in lists, blockquotes, table cells, and table headers.
- [ ] 2.2 Add failing exclusion fixtures for citation atoms, generated references, equations, figure images, external metadata, link destinations, URL-shaped visible tokens, identifier tokens, and eligible linked prose.
- [ ] 2.3 Add failing mapping fixtures for adjacent marked text leaves, one LF block separator, inline masks, repeated words, punctuation, surrogate pairs, UTF-16 positions, preferred boundary splits, and the 65,536-unit hard-split fallback.
- [ ] 2.4 Add failing validation fixtures proving an issue that touches a mask or separator, exceeds a chunk, overlaps another issue, or maps discontinuously invalidates the chunk, while a contiguous cross-mark issue remains valid.
- [ ] 2.5 Implement the deterministic extractor, masks, chunker, and source maps without claiming LT-01 performs editor traversal.

## 3. Build one atomic title and body analysis controller

- [ ] 3.1 Add failing controller tests for one generation shared by ProseMirror body and paper title, source-qualified issue identities, document-language selection, UI-locale independence, debounce, and paper-title-first complete publication.
- [ ] 3.2 Add failing lifecycle tests proving any body or title mutation invalidates all prior issues and Ignore-once entries, cancels remaining chunks, and schedules a full recheck; also cover essay switch, disable, and editor destruction.
- [ ] 3.3 Add failing LT-01 interaction tests proving capability runs once and all chunks run sequentially under one context ID, never concurrently, because latest-in-context cancellation would cancel siblings.
- [ ] 3.4 Add failing whole-batch tests for available zero issues, busy with one debounced retry, missing dictionary, unavailable API, adapter failure, invalid request, stale result, active cancellation, supersession cancellation, invalid mapped chunk, and a missing later chunk.
- [ ] 3.5 Implement the unified generation controller, sequential batch accumulator, cancellation, truthful status model, and atomic publication.
- [ ] 3.6 Implement the ProseMirror extension as a body mutation and decoration adapter, and connect external paper-title mutations to the same controller at the EditorScreen seam.

## 4. Implement source-safe actions with TDD

- [ ] 4.1 Add failing body-action tests that verify source, generation, range, normalized term, and substring before replacement, change only one occurrence, and restore it through normal ProseMirror undo.
- [ ] 4.2 Add failing title-action tests for exact stale verification, range-only replacement through the canonical title mutation and autosave path, title-input undo, ignore actions, cancellation, full-generation invalidation, recheck, and focus-selection restoration.
- [ ] 4.3 Implement source-specific replacement and stale-action rejection; stop for a design challenge if either webview cannot preserve normal title-input undo.
- [ ] 4.4 Add failing Ignore-once tests keyed by source, generation, mapped range, and normalized term, including invalidation after a mutation in the other source.
- [ ] 4.5 Add failing document-ignore and personal-dictionary tests proving language scope, title and body filtering, complete recheck, distinct persistence ownership, and edit or clear behavior.
- [ ] 4.6 Implement Ignore once, Ignore in this document, Add to personal dictionary, and Next spelling issue without autocorrect, grammar, style, model, or network behavior.

## 5. Pin and implement the accessible menu

- [ ] 5.1 Add failing component tests for `role="menu"`, suggestion menuitems in native order, both separators, fixed durable-action order, disabled No suggestions, disabled dictionary or next actions, and non-color-only title and body indications.
- [ ] 5.2 Add failing keyboard tests for `Alt+F7`, title-form opening, paper-title-first source order, Arrow Up and Down wraparound, Home, End, Enter, Space, Escape, Tab, Shift+Tab, disabled-item no-op, live-status quietness, and exact body or title focus-selection restoration.
- [ ] 5.3 Add failing pointer tests that open the shared menu only when context-menu coordinates target a current issue and otherwise preserve the platform context menu.
- [ ] 5.4 Implement the shared correction menu, source anchor handling, pointer targeting, keyboard navigation, screen-reader labels, and focus behavior.
- [ ] 5.5 Add failing localization tests for English UI with Spanish document, Spanish UI with English document, accurate language naming, busy, unavailable, and missing-dictionary states.
- [ ] 5.6 Add English and Spanish Paraglide messages, regenerate output, and implement localized states without announcing routine background results.

## 6. Enforce production absence and separate proof layers

- [ ] 6.1 Add failing compile-time tests that only `VITE_TESINA_SPELLING_EXPERIENCE_PROOF=1` selects the proof editor entry and every other value selects unchanged production editor and settings components.
- [ ] 6.2 Add failing default-production runtime tests proving no spelling controls, decorations, status, settings, editor extension, capability call, or check call exists.
- [ ] 6.3 Add failing bundle-containment assertions for proof entry identifiers, proof-only modules, and spelling IPC call sites in normal output, then implement the SvelteKit compile-time alias and proof-only integration entry.
- [ ] 6.4 Add the automated fake-service editor UI journey for extraction, atomic batching, menu behavior, source replacement, ignores, localization, and cancellation without calling it native or physical accessibility evidence.
- [ ] 6.5 Extend hosted packaged native evidence only as needed to record bilingual capability, ranges, suggestions, stable failures, package identity, and hashes; do not claim the current non-editor proof page runs the editor keyboard journey.
- [ ] 6.6 Construct exact-source installed internal proof packages for the deferred physical keyboard and accessibility journey without enabling the ordinary release build.

## 7. Record release and verification evidence

- [ ] 7.1 Run focused Vitest targets while iterating, apply the Svelte autofixer to changed components, and resolve every functional or accessibility diagnostic without weakening the contract.
- [ ] 7.2 Update synchronized versions, CHANGELOG, README, and delivery-plan status for the approved `main` change while stating that default production spelling remains absent pending the final physical gate.
- [ ] 7.3 Run `deno task check`, `deno task test`, applicable Rust tests, `deno fmt --check`, `deno lint`, both production-negative and proof-positive containment checks, and `openspec validate add-bilingual-spelling-experience --strict` on the final source head.
- [ ] 7.4 Record fake-service editor UI evidence and hosted packaged native evidence as separate layers with exact source, runs, artifact identities, and hashes.
- [ ] 7.5 Record physical keyboard, non-color, VoiceOver, and Narrator testing as deferred and mandatory on macOS 12 Intel, Windows 10 x64, Windows 11 x64, and separate Windows missing-dictionary environments; automated components, hosted CI, and constructed installers do not satisfy it.

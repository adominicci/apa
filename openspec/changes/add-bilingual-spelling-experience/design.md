## Context

LT-01 supplies a bounded spelling service with UTF-16 offsets, capability states, context-scoped latest-request cancellation, and native English and Spanish adapters. It deliberately does not define editor traversal or decorations. A caller that launches concurrent checks under one context ID will cancel its own earlier checks.

The ProseMirror body and `essay.titlePage.title` have separate mutation paths. `EditorScreen.svelte` owns the live essay, title, document language, and autosave. `UiSettingsStore` is the sole owner of `settings.json`. Essays stay on schema version 2, device settings stay on schema version 1, and portable archives carry essays but exclude device settings.

The current editor is Tesina's writing surface. Variant C reserves a dedicated Study workspace for later learning tools, but an empty mode selector would add UI with no LT-02 value. The physical Intel and Windows matrix also remains deferred. LT-02 therefore needs an internal editor proof experience that cannot enter an ordinary production bundle.

## Goals and non-goals

Goals:

- Produce one deterministic, source-mapped analysis generation from body and paper title changes.
- Publish complete sequential LT-01 batches atomically and represent every incomplete outcome truthfully.
- Make body and title actions stale-safe, source-qualified, accessible, and student-approved.
- Pin one canonical persisted representation and distinct trusted-mutation, local-load, and untrusted-import behavior.
- Prove default production absence separately from internal UI, hosted native, and installed physical evidence.

Non-goals:

- A Write or Study selector, dedicated Study workspace, coaching, AI, quizzes, grammar, style, autocorrect, or authorship claims.
- Changing LT-01, mutating operating-system dictionaries, adding a network path, or bundling a dictionary.
- Claiming component automation proves physical assistive-technology behavior.
- Enabling spelling in an ordinary release before the final physical gate.

## Decisions

### Keep LT-02 on the current editor

The internal proof entry will add spelling to the current editor and title input. It will not add mode state or a placeholder Study screen. The Variant C decision remains recorded as the boundary for later learning-tool changes.

This is smaller and avoids a dead navigation path. A session-local Write and Study switch was rejected because Study would have no behavior in LT-02.

### Use one analysis controller for body and title

A controller at the `EditorScreen.svelte` seam will own essay ID, document language, one analysis generation, one LT-01 context ID, one abort controller, and an unpublished batch accumulator. A ProseMirror extension will report body mutations and render only controller-approved body decorations. The title binding will report every title mutation and render title issue state at the title input.

Either source changing increments the shared generation, clears all published issues and prior Ignore-once entries, aborts remaining chunks, and schedules a full title-plus-body analysis. An issue identity is `{ source, generation, from, to, termKey }`. Body ranges are ProseMirror positions expressed as half-open UTF-16 source spans. Title ranges are half-open UTF-16 indices in the current title string. Publication and Next spelling issue order paper-title ranges first, then body ranges in ProseMirror document order.

Keeping separate title and body generations was rejected. A title action could otherwise remain apparently current after the body changes even though document-level ignores, navigation order, and the published issue set had changed.

### Extract text from a fixed allowlist and map every admitted code unit

The extractor will admit text leaves under `paragraph`, `heading`, `tableTitle`, `tableNote`, `figureTitle`, `figureNote`, and `keywordsLine`. Paragraphs cover prose nested in lists, blockquotes, table cells, and table headers. It will exclude citation atoms, reference decorations, equations, figure-image atoms, link destinations, and external metadata other than the paper title.

Adjacent marked leaves in one textblock join without a separator. Blocks join with one unmappable LF. Inline excluded atoms and masked tokens contribute unmappable ASCII spaces. Link display text remains eligible unless it is URL-shaped. URL and identifier recognition follows the exact token rules in the capability spec.

The map records the source and source position of every admitted UTF-16 code unit. Chunking prefers the last block or whitespace boundary within 65,536 code units. A boundary-free chunk uses the largest safe prefix without splitting a surrogate pair. Returned issues are validated as a whole chunk. A range touching an unmappable span, leaving the chunk, overlapping another range, or mapping discontinuously invalidates the chunk. Crossing a mark boundary is valid only when the underlying source positions remain contiguous.

Flattening with guessed offsets and claiming LT-01 defines traversal were rejected. LT-01 classifies caller-provided source types but does not walk Tesina's document.

### Run chunks sequentially and publish once

The controller asks for capability once per generation. If available, it sends title and body chunks sequentially under one context ID and the same document revision value derived from the analysis generation. It keeps results private until all chunks complete and validate. Then it filters ignores and publishes one combined source-ordered issue list.

Busy discards the unpublished batch, exposes a temporary state, and schedules at most one debounced retry for that generation. A second busy result remains busy without another automatic retry. Missing dictionary and unavailable stop before chunking. Adapter failure, invalid request, invalid mapping, or active-generation cancellation discard the batch and expose a non-success state. Supersession and teardown cancellation remain silent. Only an available generation whose complete chunk set maps to zero issues becomes issue-free.

Parallel `Promise.all` chunking was rejected because LT-01's `latestByContext` behavior would cancel sibling requests. Incremental decoration publication was rejected because later failure would leave a misleading partial document.

### Verify and mutate each source through its owner

Before any action, the controller verifies the issue source, generation, range, term key, and current substring. Body replacement dispatches one ProseMirror transaction, preserving normal editor undo. Title replacement acts on the focused title input's verified range through its existing owner. When the title form is closed, the cover-title owner applies the canonical essay mutation and schedules autosave immediately. When `TitlePageForm` is open, replacement changes only its draft; normal Save commits that draft through the canonical essay mutation and autosave owner, while Close discards it. Tests must prove both ownership paths and that the input retains its normal undo behavior. If WKWebView or WebView2 cannot preserve it, implementation stops for a design challenge rather than shipping a weaker title action.

Ignore once is an in-memory set keyed by the full issue identity. Any body or title mutation drops the prior generation's set. Document and personal ignores use the normalized term key and current document language, then trigger a complete new generation.

Direct DOM body replacement and actions keyed only by the word were rejected. Both can alter the wrong occurrence after edits.

### Pin canonical stored fields and boundary behavior

Essay data uses only:

```ts
spelling?: {
  documentIgnores?: {
    en?: string[];
    es?: string[];
  };
};
```

Device settings use only:

```ts
spelling?: {
  enabled?: boolean;
  personalDictionaries?: {
    en?: string[];
    es?: string[];
  };
};
```

Each language array has at most 256 entries. A candidate trims outer Unicode whitespace, normalizes to NFC, must contain 1 through 128 UTF-16 code units, and may contain neither control characters nor remaining Unicode whitespace. The comparison key applies locale-aware lowercase with `en` or `es` to the NFC display string. Input order decides duplicate display spelling, and the first valid key wins.

Trusted mutation APIs canonicalize one complete requested change. They reject an invalid term or overflow without writing a partial result. A duplicate is a successful no-op that preserves the earlier display spelling. Direct local essay and settings loads sanitize only these optional fields in memory and do not eagerly rewrite a file. They retain the first 256 valid unique winners and drop invalid or excess values. Snapshot and archive assembly receive the canonical in-memory essay. Untrusted portable validation rejects malformed spelling data rather than changing signed or hashed input. Canonical document ignores participate in semantic identity; device settings never do.

Rejecting a complete local essay because one optional ignore is malformed was rejected as disproportionate. Sanitizing an untrusted archive was also rejected because import semantics and digest review must remain exact.

### Use one pinned accessible menu contract

The correction popup follows the menu structure and fixed item order in the spec. Suggestions retain native order. A disabled No suggestions row preserves a predictable first position. Disabled items remain focusable by arrow navigation but cannot activate. `Alt+F7` is the explicit cross-platform issue command. Pointer context-menu interception occurs only over a current issue.

The menu owns Arrow Up and Down, Home, End, Enter, Space, Escape, Tab, and Shift+Tab behavior. Escape and completed actions restore the exact body or title source selection. Tab closes and advances outside the menu instead of trapping focus. Next spelling issue intentionally transfers selection to the next source-qualified issue. Navigating to a title issue opens the existing title edit form when needed before focusing and selecting its range.

Using native webview spelling menus was rejected because their semantics, ignore ownership, keyboard support, and action order differ across WKWebView and WebView2.

### Select the proof experience through a compile-time alias

`VITE_TESINA_SPELLING_EXPERIENCE_PROOF=1` will be the only input that selects a proof-only editor integration entry through SvelteKit's compile-time alias configuration. The absent or any-other-value branch resolves to the existing editor and settings components, with no imports from the proof entry. Normal-bundle assertions will inspect output modules and spelling IPC call sites. Runtime assertions will confirm the default editor creates no spelling extension, control, decoration, setting, capability call, or check call.

A runtime `if` inside the ordinary editor was rejected because tree shaking is not a sufficient release boundary. CSS hiding was rejected because it leaves code and calls reachable.

### Record three proof layers

The first layer is automated editor and component behavior with a fake service. It covers extraction fixtures, sequential batching, source actions, localization, menu roles, and keyboard events. It does not prove native dictionaries or physical accessibility.

The second layer reuses LT-01's hosted packaged native proof architecture. It covers native capability, ranges, suggestions, stable failures, artifact construction, and package identity on macOS and Windows. Its proof page is not an editor and cannot claim a keyboard correction journey.

The third layer installs exact-source internal proof packages on the final physical matrix. A person completes the keyboard and non-color journey with VoiceOver on macOS 12 Intel and Narrator on Windows 10, Windows 11, and the separate Windows missing-dictionary environment. This layer alone can satisfy the deferred physical journey gate.

## Risks and trade-offs

- Unified generations recheck the body after a title edit. Debouncing and sequential bounded chunks favor consistency over minimum native calls.
- Masking and hard splits can reduce dictionary context. Exact fixtures and atomic chunk rejection prevent offset corruption, but native suggestion quality may vary at a split.
- Locale lowercase is not full linguistic case folding. English and Spanish dictionary terms need only the pinned two-locale behavior, and fixtures lock its result.
- Sanitized local loads differ from raw disk until the next trusted save. The app must expose only canonical in-memory values and avoid an eager write.
- Title input undo differs across webviews. Focused browser tests and the final physical journey must prove it. Failure triggers a design challenge.
- A proof-only editor build adds packaging work. Compile-time aliases give a stronger negative production guarantee than a runtime feature flag.

## Migration plan

1. Add shared canonical term fixtures and optional-field parsers without changing schema versions or writing defaults.
2. Add deterministic extraction, mapping, generation, sequential-batch, and source-action tests against a fake service.
3. Add the proof-only editor extension, title integration, menu, settings, and localized states behind the compile-time alias.
4. Prove direct load, snapshot assembly, untrusted archive validation, archive round trip, semantic identity, autosave, backups, and source-specific undo.
5. Prove the default production bundle and runtime contain no spelling experience, then build the internal proof flavor.
6. Record fake-service UI and hosted packaged native evidence as separate layers. Leave physical keyboard and accessibility evidence deferred to the final rollout gate.

Rollback removes the proof alias selection and proof-only entry while retaining optional canonical fields. Older compatible builds ignore those fields, so rollback needs no data migration.

## Why

Tesina cannot expose bilingual spelling until macOS and Windows provide the same hidden, testable contract for dictionary capability, issue ranges, suggestions, and failure handling. Establishing that boundary first keeps document text local, prevents a silent language fallback, and avoids coupling the later editor experience to platform-specific behavior.

## What Changes

- Add a hidden TypeScript spelling service for English and Spanish document text, with bounded requests and structured UTF-16 ranges.
- Add native macOS and Windows adapters backed by `NSSpellChecker` and `ISpellChecker`, using only operating-system dictionaries and the existing Rust platform crates.
- Add deterministic document-language-to-installed-dialect selection and an explicit capability result that distinguishes a missing dictionary from a valid check with no spelling issues.
- Add facade-generated session-unique request correlation, a two-request global capacity with typed busy handling, cooperative cancellation, and stale-result rejection without changing essay data, settings, or editor behavior.
- Define eligible authored-text surfaces and explicit exclusions so future editor integration checks body prose and paper titles, but not generated or proper-name-heavy content.
- Add current-head macOS arm64, current Intel, and Windows hosted diagnostics,
  private macOS and Windows proof installers, and one downloaded current-arm64
  packaged/manual bilingual pass. Transfer physical macOS 12 Intel, Windows 10
  x64, Windows 11 x64, and separate missing-dictionary proof to the canonical
  final rollout gate without treating those deferred runs as complete.
- Do not add editor UI, persistence, grammar or style checking, personal-dictionary mutation, model inference, network access, bundled dictionaries, or a visible release promise.

## Capabilities

### New Capabilities

- `bilingual-spelling-service`: Defines the hidden cross-platform spelling capability, request/result contracts, language selection, eligible text boundary, cancellation, errors, and platform parity evidence.

### Modified Capabilities

None.

## Impact

- New TypeScript boundary under `apps/desktop/src/lib/spelling/`.
- New Rust spelling module under `apps/desktop/src-tauri/src/`, plus narrowly registered Tauri commands.
- Native platform integration uses the existing `objc2`/AppKit and `windows` dependency families; dependency feature changes and lockfile updates are allowed only if required by the approved adapter.
- Focused TypeScript and Rust tests, hosted native diagnostics, private proof
  installer construction, and current-arm64 packaged/manual evidence are added
  without changing essay schema, storage, application settings, editor
  rendering, exports, localization, model behavior, or network permissions.

## Purpose

Defines a hidden, local spelling boundary that gives English and Spanish document text equivalent capability, range, suggestion, cancellation, and failure semantics on supported macOS and Windows installations.

## ADDED Requirements

### Requirement: Explicit bilingual capability
The service SHALL report spelling capability separately for English and Spanish document languages before checking text. A capability result SHALL be exactly one of `available` with the selected installed language tag, `missing-dictionary` with a stable help code, or `unavailable` with a stable platform/API reason. The service MUST NOT treat a missing dictionary as a successful check in another language.

#### Scenario: Installed English dictionary
- **WHEN** capability is requested for English and at least one matching English dictionary is installed
- **THEN** the service reports `available` and the selected English language tag

#### Scenario: Missing Spanish dictionary
- **WHEN** capability is requested for Spanish and no matching Spanish dictionary is installed
- **THEN** the service reports `missing-dictionary` with the `install-system-dictionary` help code and does not check with an English dictionary

#### Scenario: Platform spelling API is unavailable
- **WHEN** the supported platform cannot initialize its spelling API
- **THEN** the service reports `unavailable` with a stable reason distinct from `missing-dictionary`

#### Scenario: Valid text has no issues
- **WHEN** an available dictionary checks valid text and finds no unrecognized words
- **THEN** the service returns a completed result whose `issues` array is empty, which is distinct from every non-available capability result

#### Scenario: Empty text with an available dictionary
- **WHEN** an admitted request contains empty text and language capability resolves to an installed dictionary
- **THEN** the service returns a completed result with the selected language tag and `issues: []` without invoking the platform check API

### Requirement: Deterministic installed-dialect selection
For a document language, the service SHALL consider only installed tags whose canonical base language exactly matches that document language. It SHALL select the exact base tag first, then the fixed preferred tag (`en-US` for English or `es-ES` for Spanish), then the remaining matching canonical tags in case-insensitive lexical order. The selected tag SHALL be returned in capability and check results.

#### Scenario: Preferred English dialect is installed
- **WHEN** `en-US` and `en-GB` are installed, but generic `en` is not
- **THEN** English capability deterministically selects `en-US`

#### Scenario: Only another matching dialect is installed
- **WHEN** generic `es` and `es-ES` are absent and installed matching Spanish tags normalize to `es-MX` and `es-AR`
- **THEN** Spanish capability selects `es-AR` regardless of the platform enumeration order

#### Scenario: Similar non-matching language tag is installed
- **WHEN** the requested document language is English and no `en` or `en-*` tag is installed
- **THEN** the service reports `missing-dictionary` rather than selecting a tag from another base language

### Requirement: Bounded correlated check requests
The facade SHALL generate each check request ID and MUST NOT reuse an ID during the application session. Callers SHALL supply a context ID, a non-negative document revision, a supported document language, a non-negative document start offset, and at most 65,536 UTF-16 code units of text, but SHALL NOT supply the native request ID. The native boundary SHALL admit at most two active check requests globally. A request beyond that capacity SHALL receive a typed `busy` result without platform work. An admitted request SHALL continue occupying capacity until native work exits and registry cleanup completes, including after caller cancellation. The service SHALL reject invalid or oversized requests before invoking a platform adapter and SHALL return only typed spelling data, never filesystem paths or arbitrary native error details.

#### Scenario: Bounded request is accepted
- **WHEN** a caller supplies valid fields and text at or below 65,536 UTF-16 code units while global capacity is available
- **THEN** the facade generates a session-unique request ID and the service echoes that ID, the document revision, and the selected language tag in the result

#### Scenario: Oversized request is rejected
- **WHEN** request text exceeds 65,536 UTF-16 code units
- **THEN** the service returns the stable `invalid-request` code without invoking the platform spelling adapter

#### Scenario: Invalid offset is rejected
- **WHEN** a request has a negative start offset or an offset whose addition to the text length cannot be represented safely
- **THEN** the service returns `invalid-request` without checking text

#### Scenario: Global request capacity is full
- **WHEN** two admitted checks have not exited native work and another check is requested
- **THEN** the additional request returns `busy` without invoking capability or platform check work

#### Scenario: Cancelled native work still occupies capacity
- **WHEN** an admitted check is cancelled but its native adapter has not exited
- **THEN** that check continues counting toward the two-request capacity until its native exit path removes the registry entry

#### Scenario: Application-session request IDs do not repeat
- **WHEN** multiple contexts issue checks sequentially or concurrently during one application session
- **THEN** every facade-generated request ID differs from every earlier request ID in that session

### Requirement: Structured stable spelling issues
For a completed check, the service SHALL return spelling issues ordered by ascending document position. Every issue SHALL contain a zero-based, half-open `[from, to)` range measured in UTF-16 code units against the requested document revision, the exact word sliced by that range, and at most eight non-empty, deduplicated suggestions in platform order. Ranges MUST remain valid for punctuation, repeated words, and non-BMP Unicode text.

#### Scenario: Repeated misspelling
- **WHEN** the same unrecognized word appears twice at different positions
- **THEN** the completed result contains two issues with distinct document ranges in ascending order

#### Scenario: Punctuation surrounds an issue
- **WHEN** an unrecognized word is adjacent to punctuation
- **THEN** the issue range covers only the word reported by the installed spelling service

#### Scenario: Non-BMP text precedes an issue
- **WHEN** emoji or another non-BMP character precedes an unrecognized word
- **THEN** the issue range counts the preceding character as two UTF-16 code units and slices the exact reported word

#### Scenario: Suggestions repeat or exceed the limit
- **WHEN** a platform returns duplicate, empty, or more than eight suggestions
- **THEN** the service preserves the first eight unique non-empty suggestions in platform order

### Requirement: Cooperative cancellation and stale-result discard
The service SHALL allow a caller to cancel an in-flight request using its facade-generated session-unique request ID. Native adapters SHALL check cancellation between issue and suggestion enumeration steps, and the service SHALL discard a completed native response when its request ID or document revision is no longer current for the caller context. Cancellation and stale results SHALL NOT be exposed as spelling issues or adapter failures. Cancellation correlation MUST NOT affect any later request.

#### Scenario: Request is cancelled during enumeration
- **WHEN** cancellation is requested while the native adapter is enumerating issues or suggestions
- **THEN** enumeration stops at the next cooperative check, transient request state is removed, and the service returns `cancelled` without partial issues

#### Scenario: Older revision completes last
- **WHEN** a newer request becomes current for the same caller context before an older request completes
- **THEN** the older response is returned as `stale` and its issues are discarded

#### Scenario: Cancellation arrives after completion
- **WHEN** cancellation is requested after the correlated check has already completed and cleaned up
- **THEN** the cancellation operation is idempotent and does not affect another request

#### Scenario: Late cancellation after later requests start
- **WHEN** a delayed cancellation for a completed request arrives after one or more later requests have started
- **THEN** the never-reused completed request ID matches no active later request and no later cancellation flag is changed

### Requirement: Eligible authored-text boundary
The hidden service SHALL expose a deterministic eligibility contract that accepts body prose and paper-title text. It SHALL exclude generated citations and references, URLs, equations, identifiers, author, institution, course, and instructor metadata, and other fields designated as proper-name-heavy. LT-01 SHALL NOT add editor traversal or decorations.

#### Scenario: Body prose and paper title
- **WHEN** a caller classifies text as body prose or paper title
- **THEN** the eligibility contract permits that text to be sent in a bounded spelling request

#### Scenario: Generated or metadata text
- **WHEN** a caller classifies text as a generated citation, generated reference, URL, equation, identifier, author, institution, course, instructor, or proper-name-heavy field
- **THEN** the eligibility contract excludes that text from spelling requests

### Requirement: Local read-only platform adapters
On supported macOS and Windows targets, checks SHALL use the host operating system's installed spelling service and dictionaries. The service MUST NOT transmit document text, use a model, mutate an operating-system dictionary or ignore list, persist spelling state, or bundle a third-party dictionary.

#### Scenario: Native check executes
- **WHEN** an available dictionary checks document text on a supported platform
- **THEN** text is processed only through the local operating-system spelling API and only typed results cross the native boundary

#### Scenario: Check completes
- **WHEN** capability detection or a spelling check finishes, fails, is cancelled, or becomes stale
- **THEN** no essay, app setting, dictionary, ignore list, or persisted file has changed

### Requirement: Stable adapter failures
Adapter failures SHALL be translated to stable codes: `api-unavailable`, `missing-dictionary`, `invalid-request`, or `adapter-failure`. Native error messages, HRESULT values, Objective-C exception details, and filesystem information MUST NOT cross into the TypeScript result.

#### Scenario: Platform call fails during a check
- **WHEN** an initialized native adapter fails while enumerating spelling data
- **THEN** the service returns `adapter-failure` with the original request correlation and no partial issues or raw native details

#### Scenario: Dictionary disappears after capability detection
- **WHEN** the selected dictionary is no longer available when a check begins
- **THEN** the service returns `missing-dictionary` rather than an empty issue array or a different-language result

### Requirement: Cross-platform contract and packaged evidence
The same contract tests SHALL cover English, Spanish, punctuation, Unicode, repeated words, empty text, stale revisions, session-unique correlation, late cancellation, global capacity and busy handling, missing dictionaries, cancellation, and adapter failures. LT-01 acceptance evidence SHALL record exact-current-head hosted diagnostics on macOS arm64, current macOS Intel, and Windows; construction of private macOS and Windows proof installers with artifact identities and hashes; and a downloaded current-arm64 packaged/manual run that demonstrates capability and a known misspelling with suggestions for both document languages.

The canonical final rollout gate SHALL retain physical macOS 12 Intel, Windows 10 x64, Windows 11 x64, and separate Windows missing-dictionary runs. Both physical Windows bilingual environments SHALL have English and Spanish language features installed. Hosted diagnostics and installer construction MUST NOT be represented as those physical runs. The spelling feature SHALL remain hidden, and Tesina SHALL make no visible cross-platform spelling release promise, until that final physical matrix satisfies the contract.

#### Scenario: Current-head hosted diagnostics complete
- **WHEN** the LT-01 source head runs the hosted macOS arm64, current macOS Intel, and Windows native diagnostics
- **THEN** evidence records the exact head and run identities, each target's capability or precise block, selected tags when available, UTF-16 fixture ranges, suggestions, and contract status

#### Scenario: Private proof installers are constructed
- **WHEN** the manual-only proof workflow builds the feature-gated macOS and Windows installers at the exact LT-01 source head
- **THEN** evidence records the private workflow, artifact identities, and downloaded installer hashes without publishing a release or treating construction as a physical target run

#### Scenario: Current arm64 packaged proof passes
- **WHEN** the downloaded private macOS package runs manually on the current arm64 target with English and Spanish dictionaries available
- **THEN** evidence records the report path and hash, OS version, architecture, selected language tags, UTF-16 ranges, non-empty suggestions, and passing contract version

#### Scenario: Deferred physical rollout matrix
- **WHEN** LT-01 is accepted as a hidden service before physical macOS 12 Intel, Windows 10 x64, and Windows 11 x64 testing occurs
- **THEN** those rows remain explicitly `Deferred—not executed` in LT-01 evidence and remain mandatory in the canonical final rollout manual gate

#### Scenario: A packaged target lacks a required dictionary
- **WHEN** the final Windows packaged missing-dictionary case or any final physical acceptance target cannot provide the requested dictionary
- **THEN** evidence records `missing-dictionary` for that language and no visible bilingual spelling promise is enabled unless the complete required matrix also has its separately configured available-dictionary evidence

#### Scenario: Hosted CI reports a capability block
- **WHEN** ordinary hosted CI lacks a required dictionary
- **THEN** it records the precise capability block and does not count as a completed physical final-gate run

#### Scenario: Dependency and dictionary licensing is reviewed
- **WHEN** LT-01 platform integration is prepared for review
- **THEN** evidence records the licenses of any changed Rust dependency features and confirms that no third-party dictionary is redistributed

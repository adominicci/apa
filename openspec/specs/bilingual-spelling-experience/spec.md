# bilingual-spelling-experience Specification

## Purpose
Give students accessible bilingual spelling help in the editor while preserving document ownership, language boundaries, local-first behavior, and explicit approval for every correction.
## Requirements
### Requirement: Spelling stays on the current writing surface
LT-02 SHALL add spelling to Tesina's current editor without adding a Write or Study mode selector. Spelling SHALL remain available on that writing surface without entering Study. A later change MAY introduce Variant C's dedicated Study workspace, but LT-02 MUST NOT add coaching, local AI, quizzes, or a placeholder Study experience.

#### Scenario: Student opens the editor proof experience
- **WHEN** spelling is enabled in an internal proof build and the student opens an essay
- **THEN** the current editor exposes spelling issues and correction actions without a mode transition

#### Scenario: LT-02 is inspected for later learning behavior
- **WHEN** the spelling experience is rendered or its persisted data is examined
- **THEN** no Study selector, coaching result, model control, or quiz state exists

### Requirement: Document language controls deterministic extraction
Tesina SHALL select spelling capability from `essay.settings.documentLanguage`, independent of the UI locale. One deterministic extractor SHALL produce source-mapped text from the external `essay.titlePage.title` and from ProseMirror text whose nearest textblock ancestor is `paragraph`, `heading`, `tableTitle`, `tableNote`, `figureTitle`, `figureNote`, or `keywordsLine`. Paragraphs nested in lists, blockquotes, table cells, or table headers remain eligible. Citation atoms, generated reference decorations, equations, figure images, link destinations, and external author, institution, course, instructor, and other proper-name-heavy metadata MUST NOT enter analysis.

Within one eligible textblock, adjacent text leaves SHALL join without a separator even when marks differ. Separate textblocks SHALL join with one unmappable LF separator. Citation atoms and excluded inline spans SHALL contribute an unmappable ASCII-space mask. A link's displayed prose remains eligible unless it is URL-shaped. A maximal non-whitespace token beginning with `http://`, `https://`, or `www.` case-insensitively SHALL be URL-shaped and masked. A maximal token SHALL be an identifier and masked if it contains an underscore between word characters, or if it contains at least one ASCII letter and one ASCII digit and otherwise consists only of ASCII letters, digits, `.`, `:`, or `-`.

The extractor SHALL preserve a map for every UTF-16 code unit admitted to analysis. A chunk MUST NOT exceed 65,536 UTF-16 code units. It SHALL split first at the last available block separator or Unicode whitespace that fits. If no such boundary exists, it SHALL split at the largest prefix within the limit without dividing a surrogate pair. An issue that touches a mask or separator, exceeds its chunk, overlaps another issue, or maps across noncontiguous source spans SHALL invalidate the chunk. An issue may cross adjacent marked text leaves only when their source positions are contiguous.

#### Scenario: Spanish document in an English UI
- **WHEN** the UI locale is English and the essay document language is Spanish
- **THEN** Tesina analyzes the eligible title and body with Spanish capability and presents controls in English

#### Scenario: Marked prose and excluded tokens share a paragraph
- **WHEN** one paragraph contains adjacent plain and emphasized text, a citation atom, linked prose, a linked URL literal, and an identifier such as `APA7`
- **THEN** marked prose joins at contiguous positions, linked prose remains eligible, and the citation, URL literal, link destination, and identifier are masked with auditable UTF-16 mappings

#### Scenario: A single token exceeds the service limit
- **WHEN** one eligible token has more than 65,536 UTF-16 code units and has no earlier split boundary
- **THEN** Tesina hard-splits it without dividing a surrogate pair and retains the source map for each chunk

#### Scenario: Native issue crosses an excluded span
- **WHEN** a native issue touches a block separator, masked URL, masked identifier, or other unmappable span
- **THEN** Tesina rejects that chunk and publishes no issues from the analysis batch

### Requirement: Body and title share one atomic analysis generation
Tesina SHALL assign one monotonically increasing analysis generation to the current essay's ProseMirror body and paper title together. Every document-changing body transaction or title mutation SHALL increment the generation, invalidate all previous-generation issues and Ignore-once entries, cancel remaining work, and debounce a complete recheck. Each issue identity SHALL contain its source, `body` or `paper-title`, the analysis generation, its mapped half-open UTF-16 range in that source, and the normalized term key. Combined navigation order SHALL place paper-title issues first by range, followed by body issues in ProseMirror document order.

After one available capability result, Tesina SHALL submit all chunks sequentially under one LT-01 context ID because a later request in the same context cancels the earlier request. Tesina MUST NOT publish a partial batch. It SHALL atomically publish the combined title and body issues only after every chunk completes, correlates to the same generation, and maps validly.

#### Scenario: Paper title changes during a body chunk
- **WHEN** the paper title changes while a sequential body chunk is outstanding
- **THEN** Tesina cancels remaining work, invalidates title and body issues from the old generation, and schedules one complete analysis for the new generation

#### Scenario: Every chunk completes
- **WHEN** capability is available and every sequential title and body chunk completes with valid correlation and mapping
- **THEN** Tesina publishes their combined issues once as one generation

#### Scenario: A later chunk is incomplete
- **WHEN** any chunk is busy, failed, cancelled without supersession, stale, invalid, or missing from the generation
- **THEN** Tesina publishes none of that generation's issues and does not report the essay as issue-free

### Requirement: Spelling issues and actions are accessible
Tesina SHALL indicate each body and title issue without relying on color alone. `Alt+F7` SHALL select the current issue or the next issue in the pinned combined order and open the same correction menu used by pointer targeting. If navigation targets a paper-title issue while its edit form is closed, Tesina SHALL open that form before selecting the exact title range. A pointer context-menu event SHALL open Tesina's menu only when its coordinates target a current issue; otherwise Tesina SHALL leave the platform context-menu behavior unchanged.

The popup SHALL use `role="menu"`. Suggestions SHALL appear first as `role="menuitem"` in native order, followed by `role="separator"`, Ignore once, Ignore in this document, Add to personal dictionary, another separator, and Next spelling issue. When suggestions are empty, one disabled No suggestions menuitem SHALL occupy the suggestion position. Add to personal dictionary and Next spelling issue SHALL expose `aria-disabled="true"` when unavailable. Disabled items remain arrow-focusable but MUST NOT activate.

Arrow Down and Arrow Up SHALL move focus with wraparound among menuitems. Home and End SHALL move to the first and last menuitem. Enter and Space SHALL activate an enabled item. Escape SHALL close without action and restore the affected source's focus and selection. Tab or Shift+Tab SHALL close without action, restore the source selection, and then move to the next or previous focusable control rather than trap focus. Before Next spelling issue navigates, Tesina SHALL verify the current menu issue's source, generation, range, normalized term, and exact substring; a stale failure SHALL close or refresh the menu and restore the current source without navigating. A completed action SHALL restore the body selection and editor focus or the title input selection and focus unless the action intentionally navigates to the next issue. Live status MUST NOT announce every keystroke or background result.

#### Scenario: Keyboard user opens a body issue
- **WHEN** a keyboard user presses `Alt+F7` and a current body issue exists
- **THEN** Tesina selects the issue, opens the menu at that source, and places focus on the first menuitem

#### Scenario: Issue has no suggestions
- **WHEN** the current issue has no suggestions
- **THEN** the menu presents a disabled No suggestions item followed by the fixed ignore, dictionary, and navigation actions

#### Scenario: Pointer misses every issue
- **WHEN** a context-menu event occurs outside every current title or body issue
- **THEN** Tesina does not open its correction menu or suppress the platform context menu

#### Scenario: User dismisses with Escape
- **WHEN** the menu is open for a paper-title issue and the user presses Escape
- **THEN** Tesina closes the menu and restores the exact title-input selection and focus

#### Scenario: Source changes before Next activates
- **WHEN** a body or paper-title mutation makes the open menu issue stale before the student chooses Next spelling issue
- **THEN** Tesina does not navigate, closes or refreshes the stale menu, and restores the affected source focus and selection

### Requirement: Every replacement is source-specific and student-approved
Tesina SHALL offer suggestions without automatic correction. Before replacement, it SHALL confirm the current issue's source, analysis generation, mapped range, normalized term, and exact current substring. A body replacement SHALL dispatch one ordinary ProseMirror transaction and remain undoable through editor history. A paper-title replacement SHALL change only the verified title-input range through that input's existing owner and preserve the title field's normal editing undo behavior. When the title form is closed, the cover-title owner SHALL apply the canonical essay mutation and schedule autosave immediately. When `TitlePageForm` is open, replacement SHALL change only its draft; normal Save SHALL commit that draft through the canonical essay mutation and autosave owner, while Close SHALL discard it. A stale verification failure SHALL close or refresh the menu without changing either source. Tesina MUST NOT add autocorrect, automatic replacement, grammar checking, or style advice.

#### Scenario: Student replaces one body occurrence
- **WHEN** the student selects a suggestion for one of two matching current body issues
- **THEN** Tesina replaces only the approved range and normal editor undo restores its original text

#### Scenario: Student replaces a cover-title issue while the form is closed
- **WHEN** the paper-title generation, range, normalized term, and substring still match, the title form is closed, and the student selects a suggestion
- **THEN** Tesina replaces only that title substring through the canonical essay owner, schedules normal essay persistence, invalidates the generation, and preserves title-field undo behavior

#### Scenario: Student saves a correction made in the open title form
- **WHEN** the student replaces a verified paper-title issue while `TitlePageForm` is open and then chooses Save
- **THEN** Tesina keeps the replacement in the form draft until Save commits it through the canonical essay mutation and autosave owner

#### Scenario: Student closes the title form after a correction
- **WHEN** the student replaces a verified paper-title issue while `TitlePageForm` is open and then chooses Close without saving
- **THEN** Tesina discards the corrected draft and leaves the canonical essay title unchanged

#### Scenario: Paper title changed after the menu opened
- **WHEN** any paper-title mutation makes an open action stale
- **THEN** Tesina refuses replacement, ignore, and dictionary actions from that issue and changes no essay data

### Requirement: Ignore actions have distinct identities and scopes
Ignore once SHALL key one occurrence by source, analysis generation, mapped range, and normalized term. Any body or title mutation SHALL invalidate all prior-generation Ignore-once entries. Ignore in this document SHALL add the term to the current document language's essay-owned ignore list and suppress matching title and body issues in that essay. Add to personal dictionary SHALL add the term only to the current document language's device-owned dictionary. Neither durable action SHALL mutate an operating-system dictionary.

#### Scenario: Student ignores one of two matching issues
- **WHEN** the student chooses Ignore once for one current occurrence
- **THEN** Tesina suppresses only that source, generation, range, and term identity

#### Scenario: Another source changes after Ignore once
- **WHEN** a title issue was ignored once and the ProseMirror body then changes
- **THEN** the new unified generation contains no Ignore-once entry from the prior generation

#### Scenario: Student ignores a term in the document
- **WHEN** the student chooses Ignore in this document for a current title or body issue
- **THEN** the normalized term is stored under the essay's current document language and suppressed in both eligible sources for that essay

### Requirement: Document ignores have one canonical persisted form
Essay schema version 2 SHALL store document ignores only at `essay.spelling.documentIgnores.en` and `essay.spelling.documentIgnores.es`, where each optional language value is an array of at most 256 strings. Each display string MUST be at most 128 UTF-16 code units after trimming outer Unicode whitespace and applying Unicode NFC, MUST be nonempty, and MUST contain no control character or remaining Unicode whitespace. Its comparison key SHALL be the NFC display string converted with locale-aware lowercase for its language. The first valid display string in input order wins when keys duplicate.

Trusted in-app mutations SHALL canonicalize the candidate and reject an invalid term or count overflow atomically without changing persisted data. Adding a duplicate key SHALL be an idempotent no-op that retains the earlier display spelling. Direct local essay load SHALL sanitize only the optional spelling field in memory by retaining the first 256 valid canonical winners and dropping invalid, duplicate, and excess entries without rewriting the source file. Portable snapshot and archive assembly SHALL emit that canonical in-memory form. Untrusted archive validation SHALL reject noncanonical, invalid, duplicate, or over-limit document-ignore data rather than sanitize it. Canonical document ignores SHALL participate in portable semantic identity.

#### Scenario: Older essay has no spelling field
- **WHEN** Tesina loads a valid schema-version-2 essay created before spelling preferences existed
- **THEN** the essay has empty effective ignore sets without a write or schema-version change

#### Scenario: Local essay contains malformed optional terms
- **WHEN** direct local load sees valid essay content plus invalid, duplicate, or excess document-ignore entries
- **THEN** Tesina keeps the essay available with a canonical in-memory ignore set and does not rewrite the file until a later student mutation saves it

#### Scenario: Imported archive contains the same malformed terms
- **WHEN** untrusted archive validation sees invalid, duplicate, noncanonical, or over-limit document-ignore entries
- **THEN** validation rejects the archive before import and does not silently change its semantic identity

#### Scenario: Document ignore crosses an archive round trip
- **WHEN** a canonical essay with document ignores is exported and restored through a portable archive
- **THEN** the restored essay retains those ignores as part of its semantic identity and no device personal dictionary enters the archive

### Requirement: Personal dictionaries remain canonical and device-local
Device settings schema version 1 SHALL store spelling data only at `spelling.enabled`, `spelling.personalDictionaries.en`, and `spelling.personalDictionaries.es`. An absent `enabled` value means true. Each dictionary SHALL use the same 256-entry, 128-UTF-16-unit, whitespace, NFC, language-case-fold key, and first-winner rules as document ignores.

Trusted settings mutations SHALL canonicalize and atomically reject invalid terms or overflow, while duplicate additions remain no-ops. Direct settings load SHALL sanitize spelling fields in memory without rewriting the file. Personal dictionary terms MUST NOT enter essays, essay or library exports, operating-system dictionaries, or network requests.

#### Scenario: Older settings have no spelling fields
- **WHEN** Tesina loads valid schema-version-1 settings created before spelling preferences existed
- **THEN** spelling is effectively enabled, both personal dictionaries are empty, and the stored settings remain unchanged until a trusted mutation

#### Scenario: Student adds a Spanish term with outer whitespace
- **WHEN** a trusted mutation adds a valid Spanish term padded by Unicode whitespace
- **THEN** Tesina stores its trimmed NFC display spelling under Spanish and matches it by the Spanish locale-lowercase key

#### Scenario: Student edits or clears one dictionary
- **WHEN** the student edits or clears one language's personal dictionary
- **THEN** Tesina validates the mutation atomically and rechecks the current analysis without changing the other language

#### Scenario: Student exports data
- **WHEN** the student creates an essay archive or library export
- **THEN** no spelling enable preference or personal dictionary term is included

### Requirement: Capability and batch outcomes remain truthful
Tesina SHALL clear stale issues before a new generation runs. If capability is `missing-dictionary` or `unavailable`, it SHALL send no chunks and show the corresponding localized state. If capability is available and every chunk completes with zero valid issues, it MAY show an issue-free state. A busy result SHALL publish no issues, show a temporary busy state, and schedule at most one debounced retry for the same generation. A second busy result SHALL remain busy without another automatic retry. An adapter failure, invalid request, invalid mapped chunk, or active-generation cancellation SHALL publish no issues and show a non-success state. A cancellation caused by supersession or teardown SHALL publish no user-facing failure. No partial or incomplete batch MAY appear issue-free.

#### Scenario: Spanish dictionary is missing in an English UI
- **WHEN** a Spanish essay receives `missing-dictionary` with `install-system-dictionary` while the UI locale is English
- **THEN** Tesina sends no chunks and presents English guidance that accurately names Spanish as unavailable

#### Scenario: One sequential chunk reports busy
- **WHEN** earlier chunks completed but a later current-generation chunk reports busy
- **THEN** Tesina discards the whole unpublished batch, shows busy rather than issue-free, and schedules one current-generation recheck without repeating the generation's available capability call

#### Scenario: Superseded batch is cancelled
- **WHEN** body or title mutation supersedes and cancels the active batch
- **THEN** Tesina publishes no old issues or cancellation error and debounces the replacement generation

#### Scenario: Available complete batch has no issues
- **WHEN** every sequential chunk in an available current-generation batch completes and maps to zero issues
- **THEN** Tesina may publish the essay as issue-free for that generation

### Requirement: Ordinary release builds contain no spelling experience
Only the explicit compile-time input `VITE_TESINA_SPELLING_EXPERIENCE_PROOF=1` SHALL select the internal editor spelling entry module. When the input is absent or differs from `1`, the production build MUST render no spelling controls, decorations, status, or settings; instantiate no editor spelling extension; issue no spelling capability or check call; and exclude proof-only entry modules from its bundle. Containment assertions SHALL inspect the built module graph or output for the proof entry identifiers and spelling command call sites, not rely only on a hidden CSS state or runtime conditional.

#### Scenario: Ordinary production bundle is built
- **WHEN** the production build runs without `VITE_TESINA_SPELLING_EXPERIENCE_PROOF=1`
- **THEN** bundle containment and runtime tests prove the spelling experience is absent and no capability or check call occurs

#### Scenario: Internal editor proof bundle is built
- **WHEN** the build runs with `VITE_TESINA_SPELLING_EXPERIENCE_PROOF=1`
- **THEN** the proof-only editor entry module and spelling journey are present without changing the ordinary production input

### Requirement: Proof layers remain distinct from physical acceptance
LT-02 SHALL record three separate evidence layers. Automated editor and component tests SHALL use a fake spelling service to prove extraction, atomic batching, source actions, localization, and menu behavior. Hosted packaged native integration SHALL use the existing packaged spelling proof architecture to prove macOS and Windows native-service capability, ranges, suggestions, failures, and packaging without claiming an editor keyboard journey or installed physical run. The final gate SHALL use installed physical proof packages to exercise the keyboard, non-color indication, and screen-reader journey with VoiceOver on macOS 12 Intel and Narrator on Windows 10 x64, Windows 11 x64, and the separate Windows missing-dictionary environment. Both bilingual Windows environments SHALL have English and Spanish language features installed.

Automated component behavior MUST NOT be represented as physical assistive-technology parity. Hosted CI and constructed installers MUST NOT be represented as installed physical runs. Before Tesina enables or advertises visible spelling in an ordinary release, every required physical result SHALL be recorded against the exact accepted source and artifact.

#### Scenario: Fake-service editor journey passes
- **WHEN** automated editor tests complete the keyboard menu and source-action contract
- **THEN** evidence records UI contract coverage without claiming native service or physical assistive-technology proof

#### Scenario: Hosted packaged native proof passes
- **WHEN** the existing non-editor proof package reports bilingual capability, ranges, and suggestions on hosted macOS and Windows
- **THEN** evidence records native integration and artifact identity without claiming the editor keyboard journey ran

#### Scenario: LT-02 merges before physical acceptance
- **WHEN** automated and hosted proof pass but the physical matrix remains deferred
- **THEN** the ordinary release keeps spelling absent and makes no visible cross-platform spelling promise

#### Scenario: Installed physical targets pass
- **WHEN** the final gate records the keyboard and accessibility journey on every required installed physical environment, including the separate missing-dictionary case
- **THEN** those exact-source artifact results satisfy the visible spelling parity gate

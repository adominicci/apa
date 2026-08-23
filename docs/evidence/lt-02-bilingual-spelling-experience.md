# LT-02 bilingual spelling experience evidence

## Accepted source

The tested implementation source is
`956f52b5a88dc517bafaace8516e610145d58584`. This evidence-only record does
not relabel its later documentation commit as tested implementation source.

LT-02 remains an internal proof. Ordinary production builds contain no
spelling controls, decorations, status, editor extension, capability call, or
check call. The only selector is the exact compile-time input
`VITE_TESINA_SPELLING_EXPERIENCE_PROOF=1`.

## Automated editor evidence

The final repository test run at the accepted source passed 1,728 tests with
one intentional skip. The proof-only compile-time addon runs inside the real
AppPage, EditorScreen, CoverSheet, TitlePageForm, Editor, and
createTesinaEditor path. Its fake-service tests passed extraction and UTF-16
mapping, atomic title-and-body publication, source-safe replacement and undo,
canonical autosave of document ignores, persisted device-dictionary enable,
edit and clear behavior, essay teardown, title-form ownership, stale-menu
closure, half-open pointer ranges, verified durable actions, bilingual
document-language selection independent of the UI locale, correction-menu
ordering, keyboard navigation, focus movement, and localized status behavior.
The review-fix regressions additionally prove that ordinary settings writes
omit spelling data, proof settings reject non-boolean enable values, malformed
optional spelling data is sanitized only on trusted local load, paper-title
pointer targeting derives its UTF-16 caret from rendered coordinates, the
correction menu is focused outside Modal's inert application subtree, title
replacements use the canonical essay/autosave owner and synchronized form
draft, discarded title forms invalidate and recheck the canonical title, and
dictionary clears cannot be undone by saving stale textarea drafts. The final
review regressions prove disabled invalidation cancels queued analysis, cover
pointer mapping remains exact below and above scale 1, modal and body Tab
navigation restores the issue selection before moving within the correct
owner, untrusted archives reject unknown spelling keys and device-shaped data,
full dictionaries disable new-term actions while retaining duplicate no-op
semantics, and form-open reanalysis retains the requested source/range/term
identity without substituting the first issue. These are component and editor
tests. The final contract regressions prove complete personal-dictionary edits
canonicalize Unicode whitespace, NFC display forms, and locale-case duplicate
keys atomically in both languages; the disabled No suggestions row retains the
pinned initial and arrow-focus position without becoming activatable; and
programmatic title or body races close stale replacement menus, preserve the
mutated source, and restore a safe exact source selection. These tests are not
native-service or physical assistive-technology evidence.

The final static and runtime gates also passed:

- Svelte check: 0 errors and 0 warnings;
- Rust: 189 default tests and 192 tests with `spelling-ipc-test`;
- `deno fmt --check` and `deno lint`;
- ordinary production containment: 2,830,078 inspected text bytes and no LT-02
  proof markers or spelling IPC call sites;
- proof-positive containment: 2,857,191 inspected text bytes with the real app
  and editor path plus every pinned proof marker and spelling IPC call site;
- strict OpenSpec validation.

## Hosted packaged native boundary evidence

LT-02 does not change the LT-01 native service. The accepted LT-01 native
source remains `7856778e0f10d90e0c0f181727272c581e0114a3`.

- CI run `32606266527` passed at that source.
- Native diagnostic run `32606266614` passed with macOS Intel job
  `97111641089`, artifact `9484243468`; Windows job `97111641194`, artifact
  `9484240300`; and macOS arm64 job `97111641232`, artifact `9484239607`.
- Private installer run `32606612375` constructed macOS job `97112437540`,
  artifact `9484308010`, and Windows job `97112437640`, artifact `9484314553`.
- The universal DMG SHA-256 is
  `63bde62bbaa37ed825afc5b86f0956f2789013fbb83313004dfa66b1fd8ee909`.
- The Windows NSIS SHA-256 is
  `0b59ffe018d8824d0cbe4f621b07596eeb790b885dc361348f5aef916c3fcd08`.
- The accepted macOS arm64 structured report SHA-256 is
  `11fc5d0088abf811005735bbbb42174f83056b0e5d899db58f6848a08220a53f`.

This layer proves the unchanged bilingual native boundary, ranges,
suggestions, stable failures, package identity, and hashes. It does not prove
the LT-02 editor keyboard journey. LT-02 adds a manual-dispatch-only exact-source
workflow for universal macOS DMG and Windows x64 NSIS internal editor proof
installers. No LT-02 workflow run or artifact is claimed before the branch is
pushed and the workflow is explicitly dispatched.

## Mandatory physical evidence

The following installed-package results are deferred and mandatory before
spelling can be enabled or advertised in an ordinary release:

| Target | Status | Required journey |
| --- | --- | --- |
| macOS 12 Intel with VoiceOver | Deferred—not executed | English and Spanish keyboard journey, title native undo, non-color indication, and screen-reader output |
| Windows 10 x64 with Narrator | Deferred—not executed | Same journey with English and Spanish language features installed |
| Windows 11 x64 with Narrator | Deferred—not executed | Same journey with English and Spanish language features installed |
| Separate Windows missing-dictionary environment | Deferred—not executed | Truthful missing-dictionary state and help path |

Automated components, hosted CI, and constructed installers do not satisfy
these physical rows. Failure of title-input native undo on either webview,
keyboard or focus behavior, non-color indication, or screen-reader parity
keeps the ordinary production feature absent and requires a design challenge.

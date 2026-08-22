# LT-01 spelling boundary evidence

## Investigation record

The existing WKWebView and WebView2 pagination spikes prove that Tesina can run
native webviews, but webview spelling behavior does not expose the explicit,
equivalent capability, dictionary selection, ranges, suggestions, cancellation,
and stable failure contract required by LT-01.

| Contract point | macOS | Windows |
| --- | --- | --- |
| Direct API | `NSSpellChecker` | `ISpellCheckerFactory` and `ISpellChecker` |
| API availability | AppKit framework on supported macOS | Windows spell-check COM API on supported Windows |
| Dictionaries | `availableLanguages`, installed by the OS or user | `SupportedLanguages`, installed Windows language features |
| Issue ranges | `NSRange`, UTF-16 code units | `ISpellingError` start and length, UTF-16 code units |
| Suggestions | `guessesForWordRange` in platform order | `Suggest` enumeration in platform order |
| Cancellation | Cooperative checks between issue and suggestion calls; an active AppKit call cannot be interrupted safely | Cooperative checks between COM enumeration calls; an active COM call cannot be interrupted safely |
| Threading | AppKit work runs on the main thread | Each operation owns one COM apartment and keeps COM objects on that thread |
| Mutation | No learn, forget, or ignore-list calls | No add, ignore, or autocorrect calls |

Both adapters process fixed or caller-supplied text locally. Evidence output
contains only fixed fixture ranges, selected language tags, stable codes, and
target metadata. It never contains student text or native error details.

The Tauri check and capability commands run as asynchronous commands. Their
blocking work uses bounded worker tasks, while the macOS adapter dispatches only
the AppKit calls onto the application main thread. The cancellation command can
therefore set a request flag while native work is active. Windows creates and
drops its COM apartment inside the same worker operation.

The existing pinned bindings remain license-compatible: `objc2`,
`objc2-app-kit`, and `objc2-foundation` are Zlib, Apache-2.0, or MIT licensed;
the `windows` crate is MIT or Apache-2.0 licensed. LT-01 adds crate features,
not dependency families. Tesina does not redistribute OS dictionaries or any
other spelling data.

## Serialized contract

- Contract version: `1`
- Document languages: `en`, `es`
- Maximum text length: 65,536 UTF-16 code units
- Global native capacity: two active checks
- Request ID: one process-session UUID nonce followed by `:` and a monotonically
  increasing decimal `bigint`; callers cannot supply it
- Capability states: `available`, `missing-dictionary`, `unavailable`
- Check states: `completed`, `cancelled`, `busy`, `stale`, `failed`
- Stable codes: `api-unavailable`, `missing-dictionary`, `invalid-request`,
  `adapter-failure`, `busy`
- Correlation fields: request ID and non-negative integer document revision
- Native request fields: request ID, document revision, document language,
  non-negative document UTF-16 start offset, and text
- Eligible sources: `body-prose`, `paper-title`
- Excluded sources: generated citations and references, URLs, equations,
  identifiers, author, institution, course, instructor, and
  `proper-name-heavy`
- Dialect order: exact generic base, fixed preferred dialect `en-US` or `es-ES`,
  then exact-base matches in case-insensitive lexical order

The boundary has no editor, persistence, mutation, grammar, model, network, or
settings types.

## Acceptance matrix

| Target | Status | Evidence required before visibility |
| --- | --- | --- |
| Current macOS arm64 | Incomplete | Packaged English and Spanish fixture run |
| Current macOS Intel | Incomplete | Packaged English and Spanish fixture run |
| macOS 12 Intel | Incomplete | Recorded manual or self-hosted packaged run |
| Windows 10 x64 | Incomplete | Packaged English and Spanish fixture run |
| Windows 11 x64 | Incomplete | Packaged English and Spanish fixture run |
| Windows missing dictionary | Incomplete | Packaged `missing-dictionary` result |

The feature remains hidden while any named row is incomplete.

## Local diagnostic on 2026-08-22

The structured proof harness ran on macOS 26.6.1 arm64 with contract version 1.
The host exposed generic `en` and `es` dictionaries. Both fixed misspellings
returned the expected UTF-16 ranges, `0..5` for English and `0..8` for Spanish,
with non-empty suggestions. The report status was `pass` and contained no
fixture text. This is local adapter evidence. It does not replace the current
macOS arm64 automation row.

Cross-target `cargo check` for Windows still cannot compile on this macOS host
through the full Tauri graph. It stops in the existing `ring` dependency
because the macOS toolchain does not provide the MSVC `assert.h` header, before
compiling Tesina. Hosted evidence below now proves that the Windows adapter
itself compiles and runs on Windows.

## Hosted diagnostic on 2026-08-22

GitHub Actions run
[`32583614705`](https://github.com/adominicci/tesina/actions/runs/32583614705)
ran the `Spelling native diagnostic` workflow against commit
`1e612240836e5f0fd269781695d3a56c038b3479` on
`features/add-bilingual-spelling-service`. The pull-request workflow and both
matrix jobs completed successfully:

- macOS job
  [`97056536382`](https://github.com/adominicci/tesina/actions/runs/32583614705/job/97056536382)
  uploaded artifact `spelling-proof-macos-latest` with artifact ID
  `9478464740`.
- Windows job
  [`97056536256`](https://github.com/adominicci/tesina/actions/runs/32583614705/job/97056536256)
  uploaded artifact `spelling-proof-windows-latest` with artifact ID
  `9478488992`.

The macOS artifact reports macOS 26.5.2 arm64 and contract version 1. Generic
`en` and `es` dictionaries were available. The fixed fixtures returned UTF-16
ranges `0..5` and `0..8`, respectively, with non-empty suggestions, and the
report status was `pass`.

The Windows artifact reports Windows `10.0.26100.33296` x86_64, a Windows 11
host, and contract version 1. English was available as `en-US`; the fixed
fixture returned range `0..5` with non-empty suggestions. Spanish returned the
typed `missing-dictionary` capability with help code
`install-system-dictionary`, so the report status was `block`. This is an
expected capability block, not a workflow failure.

The workflow runs the native proof executable, so it proves that both platform
adapters compile and execute on the hosted targets. It does not run the
Windows-gated Rust test suite, exercise forced COM failures or cancellation
between real enumeration steps, or produce packaged application evidence.
Tasks 5.1 and 5.2 therefore remain incomplete. Hosted `latest` runners also do
not replace the named packaged or historical targets in tasks 7.2 and 7.3.

Current-head run
[`32584119257`](https://github.com/adominicci/tesina/actions/runs/32584119257)
executed the three-runner matrix against commit
`f4c13fd81bdd04689954cfdff69a1aa49adf0fd1`. All workflow jobs succeeded:

- arm64 job
  [`97057802502`](https://github.com/adominicci/tesina/actions/runs/32584119257/job/97057802502)
  uploaded `spelling-proof-macos-latest`, artifact ID `9478603814`;
- Intel job
  [`97057802604`](https://github.com/adominicci/tesina/actions/runs/32584119257/job/97057802604)
  uploaded `spelling-proof-macos-15-intel`, artifact ID `9478619485`;
- Windows job
  [`97057802836`](https://github.com/adominicci/tesina/actions/runs/32584119257/job/97057802836)
  uploaded `spelling-proof-windows-latest`, artifact ID `9478623519`.

The arm64 report repeated the macOS 26.5.2 bilingual pass. The Intel report
records macOS 15.7.7 x86_64 with `en` and `es` selected, fixture ranges `0..5`
and `0..8`, non-empty suggestions, and overall `pass`. The Windows report
repeated the Windows 11 English pass and typed Spanish dictionary block. This
adds current Intel hosted automation, but not macOS 12 Intel manual or
self-hosted proof and not a packaged run. Task 7.2 remains incomplete.

The incomplete automation and packaged rows keep the spelling service hidden.
No UI or release claim consumes it.

## Focused proof status

The macOS-gated adapter suite now covers installed-language capability,
bilingual known fixtures when dictionaries are present, exact UTF-16 fixture
ranges, non-empty suggestions, deterministic missing-dictionary and sanitized
adapter-failure results, pre-call cancellation, and cancellation between
suggestion enumeration steps. The deterministic cases use fields compiled only
under `cfg(test)`; production adapter behavior and installed dictionaries are
unchanged. The local macOS run passed all 13 focused spelling tests. The
workflow runs the same focused suite with uncaptured output before each native
proof so any unavailable English or Spanish fixture emits its target,
architecture, language, and typed capability block. Task 4.1 remains unchecked
until a hosted macOS run passes this exact suite.

The Windows-gated suite contains the equivalent exact-range fixture,
missing-dictionary, sanitized COM/adapter-failure, pre-call cancellation, and
between-COM-enumeration tests. The same `cfg(test)` restriction keeps its
deterministic overrides out of production builds. Tasks 5.1 and 5.2 remain
unchecked until the hosted Windows job compiles and passes these tests before
running the real native proof.

The focused `service.ipc.test.ts` integration test drives
`createTauriSpellingClient` from TypeScript into a feature-gated Rust process.
The Rust harness submits the received command and argument JSON through Tauri
2's `MockRuntime`, `InvokeRequest`, and `get_ipc_response` to the actual
`spelling_check` command macro and managed `SpellingState`. A deterministic
invalid request crosses command-name selection, argument serialization, state
injection, Rust validation, result-union serialization, and response parsing;
the returned `invalid-request` result preserves request ID and revision. The
Rust side is not replaced by a JavaScript stub, and the harness is excluded
unless the test-only Cargo feature is enabled.

## Dependency and redistribution record

`Cargo.toml` adds features to existing exact versions only:

- `objc2-app-kit` 0.3.2 adds `NSSpellChecker`.
- `objc2-foundation` 0.3.2 adds `NSArray`.
- `windows` 0.61.3 adds `Win32_Globalization` and `Win32_System_Com`.

The dependency package set and `Cargo.lock` are unchanged. The `objc2` family
uses Zlib, Apache-2.0, or MIT terms. The `windows` crate uses MIT or Apache-2.0
terms. Tesina redistributes no dictionary, word list, learned word, ignore list,
or other spelling data.

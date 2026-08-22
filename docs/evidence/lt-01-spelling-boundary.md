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

LT-01 closes the hidden-service implementation with current-head hosted
diagnostics, private installer construction, and current-arm64 packaged/manual
proof. Physical Intel and Windows execution is retained as a final rollout gate
rather than represented as work completed during LT-01.

| LT-01 evidence | Status | Record |
| --- | --- | --- |
| Replacement-head CI | Pending | Required after the reviewed production fixes land |
| Replacement-head hosted spelling diagnostics | Pending | Required on macOS arm64, current Intel, and Windows |
| Replacement-head private proof installers | Pending | Fresh macOS and Windows artifacts and hashes required |
| Replacement-head downloaded current-arm64 packaged proof | Pending | Fresh downloaded DMG run required |

| Final rollout physical target | Status | Required evidence before visibility |
| --- | --- | --- |
| macOS 12 Intel | Deferred—not executed | Recorded packaged bilingual run |
| Windows 10 x64 | Deferred—not executed | Packaged English and Spanish run with both language features installed |
| Windows 11 x64 | Deferred—not executed | Packaged English and Spanish run with both language features installed |
| Windows missing dictionary | Deferred—not executed | Separate packaged `missing-dictionary` result |

The feature remains hidden and has no visible release promise until every final
rollout physical row passes.

## Historical implementation-head evidence on 2026-08-22

Historical source head `2e01ad8002a0a095cae71d8276814b23be27a886` passed
[`CI` run `32603506352`](https://github.com/adominicci/tesina/actions/runs/32603506352)
and
[`Spelling native diagnostic` run `32603506368`](https://github.com/adominicci/tesina/actions/runs/32603506368).
The spelling matrix completed on hosted macOS arm64, current macOS Intel, and
Windows. Both macOS jobs reported bilingual passes. Windows passed its native
suite and reported English available plus the precise Spanish
`missing-dictionary` capability block with `install-system-dictionary`; that
hosted block is diagnostic, not a physical missing-dictionary final-gate run.

Manual-dispatch-only private installer
[`run 32603867576`](https://github.com/adominicci/tesina/actions/runs/32603867576)
passed at the same source head. It created, but did not release:

- artifact `9483708860`, `tesina-spelling-proof-macos-universal`; downloaded
  `Tesina Spelling Proof_0.1.19_universal.dmg` SHA-256
  `c24bdfb061baf4ae4840659e456fbfd85883c3d52cea598dafc66a84e649b270`,
  whose executable contains both `x86_64` and `arm64` slices;
- artifact `9483700434`, `tesina-spelling-proof-windows-x64`; downloaded
  `Tesina Spelling Proof_0.1.19_x64-setup.exe` SHA-256
  `b239bdd97a108f7e05562f901287021118d649145b8745dc4581806590521229`.

The downloaded DMG was mounted and its hidden proof executable ran on macOS
26.6.1 arm64. Contract version 1 reported English and Spanish available,
selected generic `en` and `es`, ranges `0..5` and `0..8`, non-empty
suggestions, and overall `pass`.

The user then completed the established manual packaged handoff on the same
current-arm64 Mac. Redacted report
`/Users/andresdominicci/Desktop/lt-01-macos-arm64-20260822-192554.json`
has SHA-256
`11fc5d0088abf811005735bbbb42174f83056b0e5d899db58f6848a08220a53f`.
It records contract version 1, macOS 26.6.1 arm64, English and Spanish
available, selected generic `en` and `es`, ranges `0..5` and `0..8`, non-empty
suggestions, and overall `pass`.

These artifacts and reports remain valid historical evidence, but later
production fixes mean they do not complete the replacement-head LT-01 gate.
Fresh exact-head diagnostics, private artifacts and hashes, and a downloaded
current-arm64 packaged run must be recorded before tasks 7.2 and 7.3 close.

No physical macOS 12 Intel, Windows 10 x64, Windows 11 x64, or separate
Windows missing-dictionary run was executed. Those rows are
`Deferred—not executed` and remain mandatory in the canonical final rollout
manual gate.

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
At this historical checkpoint, tasks 5.1 and 5.2 were still incomplete and the
hosted `latest` runners did not constitute physical target evidence. Later
sections record their completion and the product owner's transfer of physical
target runs to the final rollout gate.

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
adds current Intel-hosted automation, but not macOS 12 Intel manual or
self-hosted proof and not a packaged run. The physical macOS 12 Intel proof is
now explicitly deferred to the final rollout gate.

The spelling service remains hidden. No UI or release claim consumes it.

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
architecture, language, and typed capability block.

The Windows-gated suite contains the equivalent exact-range fixture,
missing-dictionary, sanitized COM/adapter-failure, pre-call cancellation, and
between-COM-enumeration tests. The same `cfg(test)` restriction keeps its
deterministic overrides out of production builds.

Hosted run
[`32585128795`](https://github.com/adominicci/tesina/actions/runs/32585128795)
executed the focused tests and native proof against commit
`1e4e6aa0beefe2ae17236f7647fb5f90e5e16d7c`. All three jobs passed:

- Intel macOS job
  [`97060239533`](https://github.com/adominicci/tesina/actions/runs/32585128795/job/97060239533)
  passed 13 of 13 focused tests and uploaded artifact
  `spelling-proof-macos-15-intel`, ID `9478880003`;
- arm64 macOS job
  [`97060239647`](https://github.com/adominicci/tesina/actions/runs/32585128795/job/97060239647)
  passed 13 of 13 focused tests and uploaded artifact
  `spelling-proof-macos-latest`, ID `9478860637`;
- Windows job
  [`97060239687`](https://github.com/adominicci/tesina/actions/runs/32585128795/job/97060239687)
  passed 13 of 13 focused tests and uploaded artifact
  `spelling-proof-windows-latest`, ID `9478888600`.

Both macOS jobs passed the deterministic missing-dictionary and sanitized
failure cases, immediate and between-enumeration cancellation, and real
bilingual fixture range and suggestion checks. Windows passed the equivalent
missing-dictionary, sanitized COM/adapter-failure, immediate and
between-COM-enumeration cases. Its real native fixture test emitted the precise
Spanish block: `MissingDictionary` with help code
`install-system-dictionary`. This run satisfies tasks 4.1, 5.1, and 5.2. It
does not provide any packaged target evidence.

The focused `service.ipc.test.ts` integration test drives
`createSpellingService(createTauriSpellingClient(...))` from TypeScript into
one persistent, feature-gated Rust process. The Rust harness submits every
command and argument through Tauri 2's `MockRuntime`, `InvokeRequest`, and
`get_ipc_response` to the actual command macros and one managed
`SpellingState`. An accepted request proves facade-generated correlation,
UTF-16 range serialization, and the `completed` union; a second accepted
request proves sanitized `adapter-failure` serialization through the same
state. The test feature selects a deterministic Rust adapter only for the
explicit test-state constructor; production state construction always selects
the native adapter. This IPC test proves the TypeScript/Tauri/Rust contract,
not native operating-system spelling behavior.

Real macOS dictionary and known-fixture evidence now runs only in the
serialized `spelling-proof` executable, whose process entry point owns the
main thread. Parallel Rust libtests use deterministic adapter seams and never
call `NSSpellChecker`. The executable returns a nonzero status when an
available dictionary fails its known range/suggestion fixture, so the workflow
cannot upload a passing-looking report for bad native behavior. A missing
dictionary remains an explicit capability block rather than a test failure.

## Dependency and redistribution record

`Cargo.toml` adds features to existing exact versions only:

- `objc2-app-kit` 0.3.2 adds `NSSpellChecker`.
- `objc2-foundation` 0.3.2 adds `NSArray`.
- `windows` 0.61.3 adds `Win32_Globalization` and `Win32_System_Com`.

The dependency package set and `Cargo.lock` are unchanged. The `objc2` family
uses Zlib, Apache-2.0, or MIT terms. The `windows` crate uses MIT or Apache-2.0
terms. Tesina redistributes no dictionary, word list, learned word, ignore list,
or other spelling data.

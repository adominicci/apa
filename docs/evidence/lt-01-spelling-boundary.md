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

The Windows adapter and Windows-gated tests cannot compile on this host through
the full Tauri graph. Cross-target `cargo check` stopped in the existing `ring`
dependency because the macOS toolchain does not provide the MSVC `assert.h`
header. It stopped before compiling Tesina. The hosted diagnostic workflow is
ready to produce Windows compile and capability evidence after the branch is
pushed, but hosted Windows does not replace the named packaged Windows 10 and
Windows 11 runs.

The incomplete automation and packaged rows keep the spelling service hidden.
No UI or release claim consumes it.

## Incomplete focused proof

The macOS-gated adapter tests prove installed-language capability, bilingual
known-fixture ranges and suggestions when both dictionaries are present, and a
pre-call cancellation checkpoint. They do not yet prove a real
missing-dictionary host case, force an AppKit adapter failure, or observe
cancellation between real issue or suggestion enumeration steps. Those cases
cannot be produced honestly on this host without changing installed system
dictionaries or introducing a test-only native fault seam, so task 4.1 remains
incomplete.

The TypeScript facade integration test uses an injected `invoke` stub to assert
the command names and serialized payloads. Rust command tests separately assert
the stable serde result shapes. No test currently crosses a live Tauri IPC
boundary from TypeScript into the registered Rust commands, so task 6.2 remains
incomplete.

## Dependency and redistribution record

`Cargo.toml` adds features to existing exact versions only:

- `objc2-app-kit` 0.3.2 adds `NSSpellChecker`.
- `objc2-foundation` 0.3.2 adds `NSArray`.
- `windows` 0.61.3 adds `Win32_Globalization` and `Win32_System_Com`.

The dependency package set and `Cargo.lock` are unchanged. The `objc2` family
uses Zlib, Apache-2.0, or MIT terms. The `windows` crate uses MIT or Apache-2.0
terms. Tesina redistributes no dictionary, word list, learned word, ignore list,
or other spelling data.

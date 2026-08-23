## Why

LT-01 proved a hidden bilingual spelling service, but students still cannot see or act on its results in the editor. Tesina now needs an accessible spelling experience that keeps document language separate from UI locale and leaves every document change under student control.

## What Changes

- Add spelling indications and a keyboard-accessible correction journey to the current editor writing surface.
- Let students review suggestions, replace the selected range through its current editor owner (immediate canonical cover-title mutation when the title form is closed, or draft-only mutation followed by normal Save or Close behavior when it is open), ignore an occurrence, ignore a term in one document, add terms to a device-local personal dictionary, and move to the next issue.
- Persist document ignores as optional schema-version-2 essay data and persist spelling preferences and English or Spanish personal dictionaries in additive schema-version-1 device settings.
- Analyze ProseMirror body text and the external paper title under one generation, publish only complete bounded batches, and reject stale source-qualified actions.
- Recheck with the essay's document language, cancel checks when their editor context ends, and show localized capability guidance when the required system dictionary is missing.
- Preserve Variant C as a future boundary: later learning tools may add a dedicated Study workspace, but LT-02 adds no mode selector, coaching, local AI, or quizzes.
- Retain physical macOS Intel and Windows parity checks as a mandatory final-rollout gate before Tesina makes a visible cross-platform spelling release promise.

## Capabilities

### New Capabilities

- `bilingual-spelling-experience`: Proof-gated editor integration, deterministic extraction and batching, student-approved corrections, scoped ignores and dictionaries, accessibility, lifecycle control, and cross-platform acceptance policy.

### Modified Capabilities

None.

## Impact

- Affects proof-only desktop editor integration, spelling controls, essay validation and persistence, device settings, Paraglide messages, versioned release records, and focused editor and component tests.
- Uses the existing `bilingual-spelling-service` contract without adding a model, network path, grammar or style checking, automatic correction, or bundled dictionary.
- Adds optional data to existing essay schema version 2 and device settings schema version 1. Older stored data remains valid and older compatible builds ignore the additive fields.

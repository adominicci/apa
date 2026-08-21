# Proposal: extract-autosave-controller

## Why

EditorScreen.svelte (2,205 lines) hides a deep engine — revision counters, a serialized
write chain, a 500 ms debounce, and the persistence-coordinator flush barrier — inside
component-private state. The only way to test stale-revision coalescing or the
close-barrier handshake is to mount the whole screen with fake timers and ten module
mocks (EditorScreen.test.ts, 1,500 lines). Autosave is data-safety code; it deserves a
narrow interface that can be exercised directly.

## What Changes

- Extract the inline autosave machinery (EditorScreen.svelte script ~lines 196–202 and
  435–535) into a new module exposing `createAutosaveController({ persist, delay })`
  returning `{ status, scheduleSave, persistNow, bindPersistence }`.
- EditorScreen becomes a thin adapter over the controller; no user-visible behavior change.
- Persistence-focused tests in EditorScreen.test.ts move to direct controller tests;
  the existing mount suite stays green as the behavior net.
- `persist/coordinator.ts` is untouched; the controller consumes it through the same
  registration call shape EditorScreen uses today.

This is a pure internal refactor: no schema, storage-format, UI-string, or behavioral
change. `skip_specs` applies.

## Capabilities

### New Capabilities

None — no spec-level behavior changes.

### Modified Capabilities

None — `live-editor-pagination` already requires autosave to keep working across page
boundaries; this refactor preserves that behavior and its existing coverage.

## Impact

- `apps/desktop/src/lib/components/EditorScreen.svelte` — engine removed, adapter wiring added.
- New file `apps/desktop/src/lib/persist/autosaveController.svelte.ts` — the
  `.svelte.ts` extension is load-bearing: the module uses the `$state` rune.
- `apps/desktop/src/lib/components/EditorScreen.test.ts` — persistence cases rewritten
  against the controller interface; mount smoke cases retained.
- No changes to `persist/coordinator.ts`, storage formats, Paraglide messages, DOCX/PDF
  export, or Rust backend.

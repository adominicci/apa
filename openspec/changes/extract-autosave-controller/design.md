# Design: extract-autosave-controller

## Context

EditorScreen.svelte carries the autosave engine inline:

- Private state (lines 196–202): `saveTimer`, `requestedSaveRevision`,
  `persistedSaveRevision`, `saveChain`, `activeSaveAttempt`,
  `activePersistFlush`, `persistenceRegistration`.
- Engine functions (lines 435–535): `enqueuePersist` (revision coalescing +
  serialized chain), `scheduleSave` (500 ms debounce + coordinator
  `markDirty`), `persistNow`/`flushUntilCaughtUp` (shared flush barrier),
  the `onMount` registration whose cleanup keeps the callback registered
  until its final serialized write settles, and `leaveEditor`.
- `capturePersistSnapshot` (line 435) is *not* engine code: it reads
  component state (`documentLanguage`, `lastDoc`, `citedCounts`) and must stay.
- `status` is `$state<"guardando" | "guardado" | "error">` consumed by markup
  (`STATUS_LABELS[status]`, CSS `[data-status=…]`) — values are load-bearing.

Constraints: Svelte 5 runes; repo already uses `.svelte.ts` modules for
reactive state (`src/lib/state/updater.svelte.ts`, `backup.svelte.ts`);
`persist/coordinator.ts` stays untouched; existing EditorScreen mount tests
are the behavior net.

## Goals / Non-Goals

**Goals:**
- One deep module owning revisions, chain, debounce, flush, status, and the
  register-until-settled lifecycle policy.
- Direct unit tests for stale-revision skip, duplicate-attempt sharing,
  serialization, flush loop, error status, and settle-before-unregister.
- EditorScreen shrinks to an adapter; zero user-visible change.

**Non-Goals:**
- Renaming the `"guardando" | "guardado" | "error"` identifiers (separate finding).
- Any change to `coordinator.ts`, storage format, or export flows.
- Extracting the export advisory state machine (follow-up candidate).
- Migrating all 28 mount tests off mounting — persistence-focused cases move;
  mount smoke coverage stays.

## Decisions

**D1 · Location & reactivity: `apps/desktop/src/lib/persist/autosaveController.svelte.ts`.**
Sits beside `coordinator.ts`, which it integrates with. Uses the `$state` rune so
`status` is directly consumable in component markup, matching the established
`.svelte.ts` pattern. Alternative considered: plain `.ts` with a status
subscriber callback — rejected as a shallower interface that forces the
component to mirror state.

**D2 · Interface:**
```ts
createAutosaveController(options: {
  persist: () => Promise<void>;
  delay?: number;            // default 500
}): {
  readonly status: "guardando" | "guardado" | "error";
  scheduleSave(): void;
  persistNow(): Promise<void>;
  bindPersistence(persistence: PersistenceCoordinator): () => void;
}
```
`bindPersistence` encapsulates lines 509–525 verbatim (register → on dispose:
flush, then unregister only after the final write settles) and returns the
cleanup fn for `onMount`. The component keeps `leaveEditor` (navigation policy)
calling `controller.persistNow()`.

**D3 · `persist` callback boundary.** Component passes
`() => essays.persist(capturePersistSnapshot())`. Snapshot capture stays in the
component because it reads component state; everything after the snapshot
(revisioning, ordering, retries of the write itself) moves into the controller.
Error logging (`console.error("No se pudo guardar el ensayo:", …)`) moves with
the engine so behavior is identical. One deliberate timing shift follows from
this boundary: HEAD captured the snapshot at enqueue time, the controller
captures at write execution time (when the queued callback runs). Because
writes serialize and the highest revision's write always executes last, the
final persisted state is unchanged — intermediate writes can only be fresher,
never staler, than HEAD.

**D4 · Test strategy.** New `autosaveController.test.ts` with an injected fake
`persist` and fake timers covers: debounce coalescing, stale revision resolves
immediately, duplicate attempt shares one promise, writes serialize in order,
`persistNow` drains to caught-up, failure sets `status = "error"` and rejects,
`bindPersistence` unregisters only after the settled final write. The ~7
persistence cases in EditorScreen.test.ts are rewritten against this interface;
mount tests that assert other screen behavior remain untouched and must pass
unmodified except where they referenced removed internals.

**D5 · No comment/code drift.** The explanatory cleanup comment (lines 513–515)
moves with the code it explains.

## Risks / Trade-offs

- [Subtle timing change during extraction] → Existing mount tests run
  unmodified with fake timers; any diff in observed save ordering fails loudly.
- [`$state` rune semantics differ from plain lets inside module scope] →
  Controller holds its own `$state` object; component only reads it. Verified
  by focused Vitest plus svelte-check.
- [Two sources of truth for status during migration] → Single-shot cutover in
  one commit; no period where both exist.
- [Blast radius creep] → Touches exactly three files (+1 new test file);
  anything beyond that stops and reports.

## Migration Plan

Single branch `refactor/autosave-controller`, one PR. Rollback = revert the
commit; no data or format migration involved.

## Open Questions

None.

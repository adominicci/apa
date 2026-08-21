# Tasks: extract-autosave-controller

## 1. Red — controller tests first

- [ ] 1.1 Create `apps/desktop/src/lib/persist/autosaveController.test.ts` covering: debounce coalescing, stale-revision skip, duplicate-attempt promise sharing, serialized write order, `persistNow` drains to caught-up, failure sets `error` status and rejects, `bindPersistence` unregisters only after the final write settles. Confirm the suite fails because the module does not exist.

## 2. Green — the controller module

- [ ] 2.1 Create `apps/desktop/src/lib/persist/autosaveController.svelte.ts` implementing `createAutosaveController({ persist, delay })` per design D1–D3, moving lines 196–202 and 435–535 of EditorScreen.svelte (engine state, `enqueuePersist`, `reportPersistError`, `scheduleSave`, `persistNow`, `flushUntilCaughtUp`, registration lifecycle as `bindPersistence`).
- [ ] 2.2 Make 1.1's suite pass; run focused target: `deno task test -- apps/desktop/src/lib/persist/autosaveController.test.ts` (or repo-equivalent filter).

## 3. Cutover — EditorScreen becomes an adapter

- [ ] 3.1 In `EditorScreen.svelte`: delete engine state/functions, instantiate the controller with `() => essays.persist(capturePersistSnapshot())`, replace `scheduleSave`/`persistNow` call sites (lines 228, 243, 552, 653, 842, 853, 510–524, 529) and point markup `status` reads (lines 1388–1390) at the controller's reactive status.
- [ ] 3.2 Rewrite the ~7 persistence-focused cases in `EditorScreen.test.ts` against the controller interface; leave all other mount tests untouched.

## 4. Verification gate

- [ ] 4.1 Focused evidence: controller suite + `EditorScreen.test.ts` green; `deno task check` clean.
- [ ] 4.2 Full gate: `deno task test`, `deno fmt --check`, `deno lint`; report real output.

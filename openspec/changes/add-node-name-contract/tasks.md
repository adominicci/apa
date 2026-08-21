# Tasks: add-node-name-contract

## 1. Contract module

- [x] 1.1 Create `packages/apa-engine/src/nodeNames.ts` per design D1–D2 (frozen const + `ApaNodeName` type + inclusion-rule header) and export it from `packages/apa-engine/src/index.ts`.
- [x] 1.2 Replace literals inside the engine package itself (`src/check/apa-check.ts`, `test/apa-check.test.ts`).

## 2. Production sweep

- [x] 2.1 Replace literals in all apps/desktop production files listed in design D6 (editor/, model/, pagination incl. proof harness, portable/, preview/).
- [x] 2.2 Replace literals in all packages/docx-export production files from D6 (blocks.ts, body-title.ts, pm-visitor.ts switch cases, sample.ts).

## 3. Test sweep

- [x] 3.1 Replace literals in all 27 test/fixture files from D6 — expectation values included; no test logic edits.

## 4. Proof and gates

- [x] 4.1 Ownership proof per D4 (as amended): census outside the module must be 0; document that a corrupted contract value keeps `deno task check` green because coverage is complete — consistency by construction, not type failure. Capture census output.
- [x] 4.2 Focused evidence: engine + docx-export + editor/portable/preview suites green.
- [x] 4.3 Full gate: `deno task check`, `deno task test`, `deno fmt --check`, `deno lint`; report real output.

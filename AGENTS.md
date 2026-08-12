# AGENTS.md - Tesina

Repository-specific guidance for Tesina, an MIT-licensed, local-first APA 7
academic word processor. Global agent guidance applies. This file is canonical.

## Repository shape

- `packages/apa-engine`: pure TypeScript APA engine; zero runtime dependencies.
- `packages/docx-export`: pure DOCX writer. `src/input.ts` is its sanctioned
  contract and must not import application or Tauri code.
- `apps/desktop`: Svelte 5 + Tauri 2 desktop application.
- Clean-room implementation: never copy Essayist code, text, name, or assets.

## Product invariants

- UI/chrome strings use Paraglide and the UI locale. Document content uses
  `essay.settings.documentLanguage`; never mix those axes within one surface.
- New ProseMirror block behavior must stay aligned across schema, editor CSS,
  HTML preview, DOCX export, and focused golden/snapshot coverage.
- Table, figure, appendix, and list numbering is computed at render time.
- Do not bump `essay.schemaVersion` from 2 for additive nodes or attributes.
- Preserve atomic writes, autosave, rotating backups, and relative figure assets.
- Pure packages never import Tauri APIs or receive data URLs.
- Dependencies must use MIT, Apache-2, ISC, BSD, or OFL-compatible licenses;
  never add AGPL code or copied APA-manual fixtures.

## Focused references

- Font delivery: `docs/runbooks/font-delivery.md`
- Release/updater/signing: `docs/runbooks/release.md`
- Editor/render contract: `docs/architecture/editor-renderers.md`
- Current roadmap and version policy: `README.md` and `CHANGELOG.md`

Create these runbooks from the current verified guidance before deleting the
equivalent detail from this file. A historical incident belongs in a runbook,
not in every agent prompt.

## Runtime and verification

- Dev: `deno task dev` from the repository root.
- The dev task owns the process it starts. Record that PID and stop only that
  verified PID. Never clear port 1420 or terminate Vite/Tauri by name.
- Localized code: focused Vitest target plus `deno task check`.
- Engine, DOCX, preview, schema, or shared contract: `deno task check` and
  `deno task test`.
- Formatting/lint when relevant: `deno fmt` and `deno lint`.
- If `.svelte-kit/tsconfig.json` is absent in a clean checkout, run
  `deno task check` before tests so SvelteKit sync can generate it.

Do not rerun unchanged full checks after every small correction. Run focused
evidence while iterating and one final applicable gate on the final diff.

## Version and release

- A change intended to merge to `main` follows the repository's per-change
  version policy. Keep desktop package, Tauri, Cargo, README, and CHANGELOG
  versions synchronized.
- The CHANGELOG section is the single release-note source.
- Tagging, publishing, or releasing is a separate external action and requires
  explicit authorization. Do not treat a local implementation task as release
  authorization.

## CLAUDE.md

Keep the existing short pointer to this file. Do not add duplicate guidance.
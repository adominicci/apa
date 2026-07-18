# AGENTS.md — Tesina

Canonical instructions for any AI agent (or human) working in this repo.

Open-source (MIT) APA-7 academic word processor. **Tauri 2 + Deno 2 + Svelte 5
+ TipTap 3**, bilingual (English/Spanish), Mac + Windows, local-first. Clean-room
functional clone of Essayist — never copy its name, code, text, or assets.

## Monorepo

- `packages/apa-engine` — pure TS APA-7 engine (references, in-text citations,
  disambiguation, locale terms). Zero runtime deps. The crown jewel.
- `packages/docx-export` — `.docx` writer (the `docx` npm lib). Pure; depends
  only on `@tesina/engine` + `docx`. **`src/input.ts` is the only sanctioned data
  contract** — it must never import app/Tauri code.
- `apps/desktop` — the Svelte 5 + Tauri app.

## Verify EVERY change (all from repo root)

```
deno task check   # svelte-check + tsc — must be 0 errors, 0 warnings
deno task test    # vitest (engine goldens, DOCX golden XML, preview snapshots)
deno fmt          # format
deno lint         # lint
```

- Every `.svelte` file MUST also pass the **svelte MCP autofixer** before commit.
- Commit each verified step. Branch off `main` before committing if asked to push.
- The dev server (`deno task dev`) is launched/managed by the agent as a
  background task. If fonts or HMR look stale after a long session, do a **clean
  restart**: kill port 1420, `rm -rf apps/desktop/node_modules/.vite`, relaunch.

## Fonts — do NOT regress this

`--font` (Inter), `--serif` (Iowan/Charter — macOS system), `--mono` (SF Mono).
Inter is **self-hosted** via an explicit `@font-face` in
`apps/desktop/src/lib/styles/tokens.css` pointing at
`static/fonts/inter-latin-variable.woff2` (SIL OFL, committed).

**Never** switch to a bare `import "@fontsource-*"` — that relies on Vite
optimizing an npm font package through Deno's symlinked `node_modules`, which is
flaky and repeatedly fell back to the system sans (SF Pro). Keep the woff2 in
`static/` + explicit `@font-face`.

## i18n — two independent axes, never mixed within one surface

- **UI / chrome** (toolbar, panels' titles + controls, home, settings, dialogs,
  status/preview messages) → **Paraglide** `m.*()` following the UI language
  (`uiLocale.current`).
- **Document** (cover sheet + its placeholders, section headings, references
  sheet, table/figure labels, everything in the three page-sheets, and the
  outline rows that name document sections) → the **document language**
  (`essay.settings.documentLanguage`), toggled by the status-bar ES/EN button.
  - Engine-rendered strings use `getTerms(documentLanguage)`.
  - Paraglide strings shown *inside the document* pass the locale explicitly:
    `m.foo(undefined, { locale: documentLanguage })`.
- Never hardcode a user-facing string; route it through Paraglide or getTerms.

## Editor architecture (keep the 3 renderers in sync)

One ProseMirror doc: `doc → sectionAbstract? sectionBody sectionAppendix*`. The
cover and references are **chrome** (Svelte sheets around the editor), NOT PM
nodes — the title page is structured `essay.titlePage` data, references are a
pure function of citations. Do not put them in the schema.

Any new block node (tables, figures, list attrs…) must land in the SAME commit
across ALL of:

1. schema — `apps/desktop/src/lib/editor/sections.ts` or `blocks.ts`
2. editor CSS — `apps/desktop/src/lib/editor/apa.css`
3. preview — `apps/desktop/src/lib/preview/renderEssayHtml.ts` (+ `renderEssayCss`)
4. DOCX — `packages/docx-export/src/pm-visitor.ts` (+ `blocks.ts`, `styles.ts`)
5. golden tests — a fixture in `docx-export/src/sample.ts` + asserts, and a
   `renderEssayHtml.test.ts` snapshot.

Numbering (tables, figures, appendix letters, list markers) is **computed at
render time, never stored** — count in document order in each renderer so it
renumbers automatically. The editor uses CSS counters + `data-doclang`.

## Data safety

- `essay.schemaVersion` is a hard filter: `state/essays.svelte.ts` drops any
  essay where it isn't `2`. **Do NOT bump it** — new nodes/attrs are additive.
  Bumping would hide every existing essay.
- Atomic writes (tmp + rename), autosave debounce, rotating backups.
- Figure images: copied into `essays/assets/` (relative path stored on the node);
  bytes are read at the app layer and passed to the pure packages — never data
  URLs, never Tauri imports inside `apa-engine`/`docx-export`.

## Licensing & distribution

- Deps only MIT / Apache-2 / ISC / BSD / OFL. **No AGPL** (that's why the APA
  engine is hand-rolled instead of citeproc-js).
- Fixtures/examples are invented — never copied from the APA manual or "normas"
  sites.
- Distribution: unsigned DMG (macOS) / MSI (Windows) via GitHub Releases only.
  **No Mac App Store.** Updater/signing deferred until there's a dev account.

## APA notes

- Spanish conventions: "Referencias", "Resumen", "y" not "&", RAE y→e before
  i/hi, "s. f.", "párr.", "2.ª ed.", localized brackets.
- Nested ordered-list markers cascade 1 → a → i by depth (Word/Docs convention;
  APA's online guidelines don't mandate a specific cascade).
- Autofill is real: CrossRef (DOI) + OpenLibrary (ISBN) + URL scraping
  (citation_* / JSON-LD / Open Graph; DOI-first) over the Tauri http plugin.
  Because URL autofill fetches user-pasted pages, the http capability scope is
  deliberately broad (`https://*/*` + `http://*/*`). BibTeX import is the only
  "coming soon" item.

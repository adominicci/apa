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

## Release every change

- Every change merged into `main` MUST include the next app version. Use a patch
  version unless the change clearly requires a minor or major version.
- Keep the version in `apps/desktop/package.json`,
  `apps/desktop/src-tauri/tauri.conf.json`,
  `apps/desktop/src-tauri/Cargo.toml`, the Tesina entry in
  `apps/desktop/src-tauri/Cargo.lock`, the visible version in both message
  files, and the current-version statements in `README.md` in sync.
- Move the completed items from `CHANGELOG.md` under `Unreleased` into a dated
  section for the new version. Release notes must explain what users will
  notice in plain English. Do not use technical jargon, internal file names, or
  implementation details.
- A change is not finished when its PR reaches `main`. Tag that exact `main`
  commit with the matching `v` version, let the release workflow create its
  draft, verify the updater files, and publish the release so users can receive
  it.

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

Inter's `@font-face` is **embedded as a base64 `data:` URI inside the static
document head — `apps/desktop/src/app.html`** — using `format("woff2")`. The
canonical source is `static/fonts/inter-latin-variable.woff2` (variable, SIL
OFL, committed); `app.html` carries the regeneration one-liner in a comment.

**Why it lives there and nowhere else** (this broke repeatedly): the
`@font-face` must NOT go through Vite's module graph. When it lived in a
JS-imported CSS (`tokens.css`, imported by `+layout.svelte`), `deno task dev`
kept dropping it — HMR re-injects the rule and WKWebView then falls back to the
system sans (SF Pro), and `url()` font assets can 404 on the Vite dev server
(known Tauri/Vite issue). Embedding the bytes in `app.html` means there is
**nothing to fetch and nothing for HMR to invalidate**, so the UI font is
deterministic in dev and in the packaged build.

**Never** (a) move the `@font-face` back into `tokens.css` or any
JS-imported/Svelte-`<style>` CSS, (b) switch to a bare `import "@fontsource-*"`
(relies on Vite optimizing an npm font through Deno's symlinked `node_modules`
— flaky, falls back to SF Pro), or (c) use the non-standard
`format("woff2-variations")` hint. If the UI font looks like SF Pro, the
`@font-face` is being delivered through Vite again — fix the delivery, don't
just clean-restart.

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
  **No Mac App Store.** The in-app updater is live: `tauri-plugin-updater`
  checks GitHub Releases (`…/releases/latest/download/latest.json`) on launch
  and updates on one click; artifacts are signed in CI with a minisign updater
  key (public key in `tauri.conf.json`, private key + password in the
  `TAURI_SIGNING_PRIVATE_KEY`/`_PASSWORD` repo secrets — never committed).
  Releases stay drafts (`releaseDraft: true`) so publishing is the manual gate
  that ships an update. Apple codesigning/notarization is still deferred until
  there's a dev account (that only removes the first-launch Gatekeeper warning).
- Because `createUpdaterArtifacts` is on, a **local** `deno task build` now tries
  to sign the updater `.tar.gz` and fails with "no private key" unless the key is
  in the env: `export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/tesina-updater.key)"`
  (empty password). For just running the app locally use `deno task dev` — it
  doesn't bundle, so no key is needed. The `.app`/`.dmg` are produced before the
  signing step, so they still appear even if that final step errors.

## APA notes

- Spanish conventions: "Referencias", "Resumen", "y" not "&", RAE y→e before
  i/hi, "s. f.", "párr.", "2.ª ed.", localized brackets.
- Nested ordered-list markers cascade 1 → a → i by depth (Word/Docs convention;
  APA's online guidelines don't mandate a specific cascade).
- Autofill is real: CrossRef (DOI) + OpenLibrary (ISBN) + URL scraping
  (citation_* / JSON-LD / Open Graph; DOI-first) over the Tauri http plugin.
  Because URL autofill fetches user-pasted pages, the http capability scope is
  deliberately broad (`https://*/*` + `http://*/*`). The reference-input flow is
  now complete; the broader pending list (signing/updater, post-v1 items) lives
  in README → Hoja de ruta.
- BibTeX import (`.bib`) is real: `@retorquere/bibtex-parser` (ISC) parses,
  `src/lib/bibtex/map.ts` maps each entry onto the 20 engine types (pure,
  mirroring the autofill mappers), and `plan.ts` builds a review plan with
  DOI/title dedupe. The file is read via `<input type=file>` + `file.text()`
  (no new capabilities); `BibImportModal.svelte` is the shared review UI, opened
  from the library toolbar and the reference form. The published parser tarball
  ships no `.d.ts`, so `bibtex-parser.d.ts` declares the surface we use.

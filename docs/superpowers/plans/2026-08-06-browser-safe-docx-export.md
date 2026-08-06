# Browser-Safe DOCX Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every public DOCX byte-export path work in the Tauri webview and
save a valid `.docx` through the native dialog.

**Architecture:** Keep document construction and the `Uint8Array` package
contract unchanged. Ask `docx`/JSZip for the browser-standard `ArrayBuffer`
output in both public exporters, then wrap that result in `Uint8Array` for the
existing Tauri filesystem and Deno script consumers. Add regression tests that
make the Node-only packer path fail deliberately, so a future return to
`Packer.toBuffer()` cannot pass merely because Vitest runs with Node globals.

**Tech Stack:** TypeScript, `docx@9`, JSZip, Vitest, Deno 2, Tauri 2, Svelte 5.

## Root Cause and Evidence

- `apps/desktop/src/lib/components/EditorScreen.svelte:407-428` routes the
  toolbar action to `exportEssayToDocx()` and displays its error.
- `apps/desktop/src/lib/export/exportEssay.ts:114-150` builds the pure export
  input, calls `exportDocx()` before showing the native save dialog, and returns
  thrown packer errors to the UI.
- `packages/docx-export/src/index.ts:114-115` calls `Packer.toBuffer()`. In
  `docx@9.7.1`, that method calls JSZip with output type `"nodebuffer"`.
- Tauri's WKWebView has no Node `Buffer`, so JSZip throws
  `nodebuffer is not supported by this platform` before the save dialog opens.
- The same latent assumption exists in the public spike exporter at
  `packages/docx-export/src/spike.ts:176-179`.
- The package tests use `environment: "node"` in
  `packages/docx-export/vitest.config.ts`, so the current XML/ZIP goldens prove
  document correctness but do not prove browser compatibility.
- A browser-runtime reproduction with the current package fails with the exact
  user-visible error. In the same runtime, `Packer.toArrayBuffer()` succeeds and
  its first four bytes are `80, 75, 3, 4` (`PK\x03\x04`, a ZIP package).

## Global Constraints

- Work only in `/Users/andresdominicci/Projects/apa-docx-browser-export` on
  branch `fix/docx-browser-export`; do not edit the primary checkout.
- Keep `packages/docx-export/src/input.ts` as the only app-to-exporter data
  contract. Do not import app or Tauri code into the pure package.
- Do not add dependencies, polyfill Node `Buffer`, alter the returned
  `Promise<Uint8Array>` contract, or change `essay.schemaVersion` from `2`.
- Do not touch Svelte, UI copy, Paraglide messages, document rendering, or
  export formatting; this fix changes only the ZIP output representation.
- Verify every code change from the worktree root with `deno task check`
  (0 errors, 0 warnings), `deno task test`, `deno fmt`, and `deno lint`.
- No `.svelte` file should change. If one unexpectedly must change, stop and
  revise this plan before implementation; it must then pass the Svelte MCP
  autofixer as required by `AGENTS.md`.
- Commit messages and PR comments must be in English. Do not push or create a
  PR unless separately authorized.

---

### Task 1: Guard Both Public Exporters Against Node-Only Packing

**Files:**

- Modify: `packages/docx-export/test/export.test.ts:1-24`
- Modify: `packages/docx-export/test/spike.test.ts:1-17`

**Interfaces:**

- Consumes: `exportDocx(input: ExportInput): Promise<Uint8Array>` and
  `exportSpikeDocx(): Promise<Uint8Array>`.
- Produces: regression tests that require `Packer.toArrayBuffer()` and forbid
  `Packer.toBuffer()` for both public byte-export functions.

- [ ] **Step 1: Add the failing real-export regression test**

In `packages/docx-export/test/export.test.ts`, import `Packer` and `vi`:

```ts
import { Packer } from "docx";
import { strFromU8, unzipSync } from "fflate";
import { beforeAll, describe, expect, it, vi } from "vitest";
```

Add this test at the start of `describe("exportDocx (student, es)", ...)`:

```ts
it("uses browser-safe ArrayBuffer packing", async () => {
  const toArrayBuffer = vi.spyOn(Packer, "toArrayBuffer");
  const toBuffer = vi.spyOn(Packer, "toBuffer").mockRejectedValue(
    new Error("nodebuffer is not supported by this platform"),
  );
  try {
    const bytes = await exportDocx(sampleInput());
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(toArrayBuffer).toHaveBeenCalledOnce();
    expect(toBuffer).not.toHaveBeenCalled();
  } finally {
    toArrayBuffer.mockRestore();
    toBuffer.mockRestore();
  }
});
```

- [ ] **Step 2: Add the failing spike-export regression test**

In `packages/docx-export/test/spike.test.ts`, import `Packer` and `vi`:

```ts
import { Packer } from "docx";
import { strFromU8, unzipSync } from "fflate";
import { beforeAll, describe, expect, it, vi } from "vitest";
```

Add this test at the start of `describe("spike DOCX structure", ...)`:

```ts
it("uses browser-safe ArrayBuffer packing", async () => {
  const toArrayBuffer = vi.spyOn(Packer, "toArrayBuffer");
  const toBuffer = vi.spyOn(Packer, "toBuffer").mockRejectedValue(
    new Error("nodebuffer is not supported by this platform"),
  );
  try {
    const bytes = await exportSpikeDocx();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(toArrayBuffer).toHaveBeenCalledOnce();
    expect(toBuffer).not.toHaveBeenCalled();
  } finally {
    toArrayBuffer.mockRestore();
    toBuffer.mockRestore();
  }
});
```

- [ ] **Step 3: Run the focused tests and verify the browser simulation fails**

Run:

```bash
deno run --frozen -A npm:vitest run --project docx-export \
  packages/docx-export/test/export.test.ts \
  packages/docx-export/test/spike.test.ts
```

Expected: exactly the two new tests fail with
`nodebuffer is not supported by this platform`; all 33 existing tests in these
files remain green. This establishes that the test exercises the production
method choice, rather than merely asserting a `Uint8Array` in Node.

---

### Task 2: Pack DOCX Bytes Through the Browser-Standard Type

**Files:**

- Modify: `packages/docx-export/src/index.ts:114-115`
- Modify: `packages/docx-export/src/spike.ts:176-179`

**Interfaces:**

- Consumes: `Packer.toArrayBuffer(file): Promise<ArrayBuffer>` from `docx@9`.
- Produces: the unchanged public `Promise<Uint8Array>` result used by
  `writeFile()` and `scripts/generate-sample.ts`.

- [ ] **Step 1: Replace NodeBuffer packing in the real exporter**

Replace the last two lines of `exportDocx()` with:

```ts
const arrayBuffer = await Packer.toArrayBuffer(doc);
return new Uint8Array(arrayBuffer);
```

- [ ] **Step 2: Replace NodeBuffer packing in the spike exporter**

Replace the last two lines of `exportSpikeDocx()` with:

```ts
const arrayBuffer = await Packer.toArrayBuffer(doc);
return new Uint8Array(arrayBuffer);
```

- [ ] **Step 3: Run the focused tests and verify the fix**

Run:

```bash
deno run --frozen -A npm:vitest run --project docx-export \
  packages/docx-export/test/export.test.ts \
  packages/docx-export/test/spike.test.ts
```

Expected: both regression tests and all existing ZIP/XML assertions pass (35
tests total across these two files). No production code should mention
`Packer.toBuffer()` afterward:

```bash
rg -n "Packer\.toBuffer\(" packages/docx-export/src
```

Expected: no matches.

- [ ] **Step 4: Verify the Deno sample consumer still accepts the bytes**

Run:

```bash
deno task spike:docx
```

Expected: both `samples/tesina-spike.docx` and
`samples/tesina-ensayo.docx` are written. Validate the generated packages:

```bash
unzip -t samples/tesina-spike.docx
unzip -t samples/tesina-ensayo.docx
```

Expected: both commands finish with `No errors detected`. These generated
artifacts are ignored by `.gitignore:24`; confirm they remain untracked and
unstaged before continuing.

- [ ] **Step 5: Run every repository verification gate**

Run from the worktree root, reading each complete result:

```bash
deno task check
deno task test
deno fmt
deno lint
git diff --check
git status --short
```

Expected: check reports 0 errors and 0 warnings; all tests pass; formatting and
lint pass; `git diff --check` is silent; only the four intended source/test
files are modified after excluding any generated sample artifacts.

- [ ] **Step 6: Commit the verified implementation**

```bash
git add \
  packages/docx-export/src/index.ts \
  packages/docx-export/src/spike.ts \
  packages/docx-export/test/export.test.ts \
  packages/docx-export/test/spike.test.ts
git commit -m "Fix DOCX export in browser runtimes"
```

---

### Task 3: Validate the Complete Tauri Save Path

**Files:**

- Verify only: `apps/desktop/src/lib/components/EditorScreen.svelte:407-428`
- Verify only: `apps/desktop/src/lib/export/exportEssay.ts:114-150`
- Artifact: one temporary `.docx` outside the repository

**Interfaces:**

- Consumes: the toolbar Export action, `exportEssayToDocx()`, native save
  dialog, Tauri `writeFile()`, and the fixed `exportDocx()` bytes.
- Produces: evidence that the actual WKWebView-to-native-filesystem flow saves
  an intact Word document, not merely that package tests pass.

- [ ] **Step 1: Start the app from the isolated worktree**

First inspect port 1420 and stop only a confirmed stale Tesina dev process if
one is already listening. Then run from this worktree:

```bash
deno task dev
```

Expected: Vite becomes ready at `http://localhost:1420/`, Rust finishes, and
`target/debug/tesina` launches. Keep this process running for the remaining
steps.

- [ ] **Step 2: Create and record an isolated export destination**

In a second terminal, create a unique directory outside the repository and
print its resolved path:

```bash
export TESINA_EXPORT_TMP="$(mktemp -d)"
test -d "$TESINA_EXPORT_TMP"
printf '%s\n' "$TESINA_EXPORT_TMP"
```

Keep this terminal open so the verified `TESINA_EXPORT_TMP` value remains
available for the package checks below.

- [ ] **Step 3: Export a representative existing essay through Tauri**

Open the existing `Test` essay shown in the bug report; do not edit its saved
content. It already exercises ordinary paragraphs, a citation, references,
nested lists, and an equation. Click **Export**, select the printed
`TESINA_EXPORT_TMP` directory, keep the filename `Test.docx`, and confirm the
native save dialog.

Expected:

1. The save dialog opens; the status bar never shows `nodebuffer is not
   supported by this platform`.
2. The localized `Exported` / `Exportado` message contains the exact printed
   `TESINA_EXPORT_TMP/Test.docx` path.
3. A non-empty `$TESINA_EXPORT_TMP/Test.docx` exists.

- [ ] **Step 4: Validate the saved package and representative content**

In the second terminal from Step 2, run:

```bash
test -s "$TESINA_EXPORT_TMP/Test.docx"
file "$TESINA_EXPORT_TMP/Test.docx"
unzip -t "$TESINA_EXPORT_TMP/Test.docx"
unzip -p "$TESINA_EXPORT_TMP/Test.docx" word/document.xml \
  > "$TESINA_EXPORT_TMP/document.xml"
rg -Fq "Ligia Torres" "$TESINA_EXPORT_TMP/document.xml"
rg -Fq "Serivice Member Killed" "$TESINA_EXPORT_TMP/document.xml"
rg -Fq "Clark" "$TESINA_EXPORT_TMP/document.xml"
```

Expected: `file` identifies Microsoft Word/OpenXML or ZIP data; `unzip -t`
reports no errors; all three fixed-string checks succeed, proving the document
XML contains the essay's representative title, body heading, and citation.

- [ ] **Step 5: Verify cancellation after packing remains non-destructive**

Click **Export** again and cancel the native dialog.

Expected: no error message appears, no second file is created, and the Export
button returns from its busy state. This confirms the fixed packer reaches the
existing `status: "cancelled"` branch without changing its behavior. Confirm
the directory still contains exactly one DOCX:

```bash
find "$TESINA_EXPORT_TMP" -maxdepth 1 -type f -name '*.docx' | wc -l
```

Expected: `1`.

- [ ] **Step 6: Record final containment and evidence**

Run:

```bash
git status --short --branch
git log -1 --oneline --decorate
git diff main...HEAD --stat
```

Expected: the feature branch contains only the four implementation/test files
plus this plan document if the plan commit is retained; the primary checkout
remains on `main`; no generated `.docx`, app data, or unrelated files are
staged or committed.

---

## Independent Review Gate

Before any push or PR, dispatch a fresh reviewer with no implementation
history. Give it the diagnosis above, this plan, `BASE_SHA=1649c04`, and the
implementation `HEAD_SHA`. Require it to inspect the exact diff and answer:

1. Does every production/public `Packer.toBuffer()` path disappear?
2. Do the tests fail on the original implementation for the platform reason,
   then pass on the fix without relying on a Node `Buffer` polyfill?
3. Is `Promise<Uint8Array>` preserved for both Tauri `writeFile()` and the Deno
   sample generator?
4. Is the Tauri E2E evidence sufficient to prove dialog, write, and OOXML
   integrity?
5. Are there any Critical or Important findings?

Address every valid Critical or Important finding, rerun all four repository
gates plus the affected E2E step, and request a second independent review of
the corrected `HEAD_SHA` before considering the branch ready.

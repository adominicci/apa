# List Block Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the complete ProseMirror structure of complex list items in
print preview and DOCX without changing Tesina's compliant body-paragraph or
list indentation.

**Architecture:** Both output visitors will distinguish a list item's single
marker-bearing paragraph from continuation paragraphs, nested lists, and
supported block children. Preview will reuse `blocksHtml` for non-list segments;
DOCX will reuse `visitBlocks` for special blocks and a shared list-text-indent
calculation for continuation paragraphs.

**Tech Stack:** Deno 2, TypeScript, Vitest, TipTap/ProseMirror JSON, `docx` 9,
OOXML assertions.

## Global Constraints

- Work only in the isolated `fix/list-block-formatting` worktree.
- Preserve ordinary body paragraphs at a 0.5-inch first-line indent.
- Preserve list text at 1 inch for level 0 and add 0.5 inch per nested level.
- Preserve reference hanging indents, block-quotation indents, abstract rules,
  and table/figure formatting.
- Do not change `essay.schemaVersion` from `2`.
- Add no dependencies, node types, user-facing strings, or Tauri capabilities.
- Do not modify level 4–5 heading behavior in this change.
- Tests must fail for the identified renderer defect before production code is
  modified.
- Run all repository verification commands from the worktree root.

---

## File Map

- `apps/desktop/src/lib/preview/renderEssayHtml.ts` — render list-item block
  structure into semantic preview HTML and scope the paragraph reset to lists.
- `apps/desktop/src/lib/preview/renderEssayHtml.test.ts` — preview regression
  fixture and assertions for continuation paragraphs, nested lists, tables, and
  post-list body paragraphs.
- `packages/docx-export/src/styles.ts` — one authoritative function for the
  text position of each list depth.
- `packages/docx-export/src/pm-visitor.ts` — emit one marker per logical item,
  aligned continuation paragraphs, and delegated special blocks.
- `packages/docx-export/src/sample.ts` — exporter golden fixture covering the
  complete complex-list data path.
- `packages/docx-export/test/export.test.ts` — OOXML assertions proving marker,
  continuation, special-block, and post-list paragraph properties.
- `apps/desktop/src/lib/editor/apaCss.test.ts` — characterization test locking
  the already-correct editor boundary between body and list paragraphs.

---

### Task 1: Preserve list-item structure in print preview

**Files:**

- Modify: `apps/desktop/src/lib/preview/renderEssayHtml.test.ts:69-123`
- Modify: `apps/desktop/src/lib/preview/renderEssayHtml.test.ts:353-410`
- Modify: `apps/desktop/src/lib/preview/renderEssayHtml.test.ts:441-448`
- Modify: `apps/desktop/src/lib/preview/renderEssayHtml.ts:193-215`
- Modify: `apps/desktop/src/lib/preview/renderEssayHtml.ts:293-303`

**Interfaces:**

- Consumes: existing `blocksHtml(blocks, state)` and
  `listHtml(block, state, depth, seedLettered)`.
- Produces: semantic `<p>` boundaries for list paragraphs, existing nested-list
  marker cycling, normal block HTML for list-item tables/figures, and the CSS
  rule `li > p { margin: 0; text-indent: 0; }`.

- [ ] **Step 1: Extend the preview fixture before changing production code**

In `listEssay()`, add a second paragraph and a minimal `apaTable` after
`Primer criterio`, keep the nested bullet after those blocks, and add a normal
paragraph after the ordered list:

```ts
{
  type: "paragraph",
  content: [{ type: "text", text: "Continuación del primer criterio" }],
},
{
  type: "apaTable",
  content: [
    {
      type: "tableTitle",
      content: [{ type: "text", text: "Tabla dentro de la lista" }],
    },
    {
      type: "table",
      content: [{
        type: "tableRow",
        content: [{
          type: "tableHeader",
          content: [{
            type: "paragraph",
            content: [{ type: "text", text: "Dato" }],
          }],
        }],
      }],
    },
    { type: "tableNote" },
  ],
},
```

After the ordered-list node, add:

```ts
{
  type: "paragraph",
  content: [{ type: "text", text: "Párrafo posterior a la lista" }],
},
```

- [ ] **Step 2: Write semantic HTML assertions that expose the defect**

Replace the old inline-only list assertion with assertions that require
paragraph boundaries, delegated table rendering, nested-list containment, and
a normal paragraph after `</ol>`:

```ts
expect(html).toContain(
  '<ol type="a"><li><p>Primer criterio</p>' +
    "<p>Continuación del primer criterio</p>",
);
expect(html).toContain('<figure class="apa-table">');
expect(html).toMatch(
  /<\/figure><ul><li><p>Matiz anidado<\/p><\/li><\/ul><\/li>/,
);
expect(html).toContain(
  "</ol><p>Párrafo posterior a la lista</p>",
);
```

Update the decimal nested-list assertions to expect `<li><p>Paso uno</p>` and
`<li><p>Subpaso</p>`.

Add this CSS assertion to the existing list-indentation test:

```ts
expect(css).toContain("li > p { margin: 0; text-indent: 0; }");
```

- [ ] **Step 3: Run the preview tests and verify RED**

Run:

```sh
/Users/andresdominicci/.deno/bin/deno task test --run apps/desktop/src/lib/preview/renderEssayHtml.test.ts
```

Expected: the complex-list and CSS assertions fail because preview currently
flattens paragraph children and omits the table block.

- [ ] **Step 4: Delegate non-list segments to the normal preview renderer**

Refactor `listHtml` so it buffers consecutive non-list children and flushes
them through `blocksHtml`; flush before each nested list and once at the end of
the item:

```ts
for (const item of block.content ?? []) {
  out += "<li>";
  let segment: PMJson[] = [];
  const flushSegment = () => {
    if (segment.length === 0) return;
    out += blocksHtml(segment, state);
    segment = [];
  };
  for (const child of item.content ?? []) {
    if (child.type === "bulletList" || child.type === "orderedList") {
      flushSegment();
      out += listHtml(child, state, depth + 1, seedLettered);
    } else {
      segment.push(child);
    }
  }
  flushSegment();
  out += "</li>";
}
```

Add the list-scoped reset immediately after the `ul, ol` rule:

```css
li > p { margin: 0; text-indent: 0; }
```

Do not alter `p { text-indent: 0.5in; }`, top-level list padding, or nested-list
padding.

- [ ] **Step 5: Run the preview tests and verify GREEN**

Run:

```sh
/Users/andresdominicci/.deno/bin/deno task test --run apps/desktop/src/lib/preview/renderEssayHtml.test.ts
```

Expected: every preview test passes, including the updated nested-list cases.

- [ ] **Step 6: Format, inspect, and commit the preview change**

Run:

```sh
/Users/andresdominicci/.deno/bin/deno fmt apps/desktop/src/lib/preview/renderEssayHtml.ts apps/desktop/src/lib/preview/renderEssayHtml.test.ts
git diff --check
git diff -- apps/desktop/src/lib/preview/renderEssayHtml.ts apps/desktop/src/lib/preview/renderEssayHtml.test.ts
git add apps/desktop/src/lib/preview/renderEssayHtml.ts apps/desktop/src/lib/preview/renderEssayHtml.test.ts
git commit -m "fix: preserve list blocks in preview"
```

---

### Task 2: Emit one DOCX marker per logical list item

**Files:**

- Modify: `packages/docx-export/src/styles.ts:109-139`
- Modify: `packages/docx-export/src/pm-visitor.ts:1-101`
- Modify: `packages/docx-export/src/sample.ts:256-309`
- Modify: `packages/docx-export/test/export.test.ts:7-22`
- Modify: `packages/docx-export/test/export.test.ts:266-287`

**Interfaces:**

- Produces: `listTextIndent(depth: number): number` returning
  `ONE_INCH + depth * HALF_INCH` in twips.
- Produces: `BULLET_LIST_REF = "tesina-bullet"` with nine custom bullet
  levels using the same text positions and 360-twip hanging geometry as the
  ordered-list definitions, while preserving the depth cycle `● → ○ → ■`.
- Consumes: `visitBlocks([child], state)` for non-paragraph special blocks and
  the existing shared counters in `VisitState`.
- Preserves: ordered-list numbering reference/instance, bullet depth, citation
  order, table/figure counters, and `BodyText` after the list.

- [ ] **Step 1: Extend the DOCX sample fixture before changing production code**

Add this continuation paragraph and minimal table to the first ordered-list
item in `sample.ts`, before `Matiz anidado`:

```ts
{
  type: "paragraph",
  content: [{ type: "text", text: "Continuación del primer criterio" }],
},
{
  type: "apaTable",
  content: [
    {
      type: "tableTitle",
      content: [{ type: "text", text: "Tabla dentro de la lista" }],
    },
    {
      type: "table",
      content: [{
        type: "tableRow",
        content: [{
          type: "tableHeader",
          content: [{
            type: "paragraph",
            content: [{ type: "text", text: "Dato" }],
          }],
        }],
      }],
    },
    { type: "tableNote" },
  ],
},
```

Add this ordinary body paragraph immediately after the ordered list and before
the equations:

```ts
{
  type: "paragraph",
  content: [{ type: "text", text: "Párrafo posterior a la lista" }],
},
```

The existing top-level table remains `Tabla 1`; the table inside the list is
`Tabla 2` because numbering is computed in document order.

- [ ] **Step 2: Add an OOXML paragraph lookup helper and failing assertions**

Near the module-level XML variables in `export.test.ts`, add:

```ts
function paragraphContaining(text: string): string {
  const paragraphs = documentXml.match(/<w:p(?:>| [^>]*>)[\s\S]*?<\/w:p>/g) ?? [];
  const paragraph = paragraphs.find((candidate) => candidate.includes(text));
  if (!paragraph) throw new Error(`Paragraph not found: ${text}`);
  return paragraph;
}

function numberingDefinitionContaining(format: string): string {
  const definitions = numberingXml.match(
    /<w:abstractNum(?:>| [^>]*>)[\s\S]*?<\/w:abstractNum>/g,
  ) ?? [];
  const definition = definitions.find((candidate) =>
    candidate.includes(`w:numFmt w:val="${format}"`)
  );
  if (!definition) throw new Error(`Numbering definition not found: ${format}`);
  return definition;
}
```

Add a focused test after the existing nested-list test:

```ts
it("keeps list continuation and special blocks inside one logical item", () => {
  const marker = paragraphContaining("Primer criterio");
  const continuation = paragraphContaining("Continuación del primer criterio");
  const nested = paragraphContaining("Matiz anidado");
  const tableCaption = paragraphContaining("Tabla 2");
  const afterList = paragraphContaining("Párrafo posterior a la lista");

  expect(marker).toContain("<w:numPr>");
  expect(continuation).not.toContain("<w:numPr>");
  expect(continuation).toContain('w:left="1440"');
  expect(nested).toContain('w:ilvl w:val="1"');
  expect(tableCaption).not.toContain("<w:numPr>");
  expect(afterList).toContain('w:pStyle w:val="BodyText"');
  expect(afterList).not.toContain("<w:numPr>");
});
```

Extend the nested bullet in the sample with a second paragraph named
`Continuación del matiz`. The same focused test must also assert:

```ts
const bulletMarker = paragraphContaining("Matiz anidado");
const bulletContinuation = paragraphContaining("Continuación del matiz");
const bulletNumbering = numberingDefinitionContaining("bullet");

expect(bulletMarker).toContain("<w:numPr>");
expect(bulletMarker).toContain('w:ilvl w:val="1"');
expect(bulletContinuation).not.toContain("<w:numPr>");
expect(bulletContinuation).toContain('w:left="2160"');
expect(bulletNumbering).toContain('w:left="1440"');
expect(bulletNumbering).toContain('w:left="2160"');
expect(bulletNumbering).toContain('w:lvlText w:val="●"');
expect(bulletNumbering).toContain('w:lvlText w:val="○"');
expect(bulletNumbering).toContain('w:lvlText w:val="■"');
```

- [ ] **Step 3: Run the exporter test and verify RED**

Run:

```sh
/Users/andresdominicci/.deno/bin/deno task test --run packages/docx-export/test/export.test.ts
```

Expected: `Continuación del primer criterio` incorrectly contains numbering,
`Tabla 2` is absent, and the new test fails for those reasons.

- [ ] **Step 4: Centralize list text indentation**

In `styles.ts`, add and use:

```ts
export function listTextIndent(depth: number): number {
  return ONE_INCH + depth * HALF_INCH;
}
```

Change `numberingLevels` to use `left: listTextIndent(level)` while preserving
the existing `hanging: 360` marker geometry.

Add `BULLET_LIST_REF = "tesina-bullet"` and a nine-level bullet configuration
to `buildNumbering()`. Each level uses `LevelFormat.BULLET`, the bullet glyph
`["●", "○", "■"][level % 3]`, `left: listTextIndent(level)`, and
`hanging: 360`. This preserves the prior depth-specific visual cue while
replacing the `docx` library's built-in geometry, which starts 0.5 inch
shallower than Tesina's ordered lists. APA does not mandate one particular
bullet shape, so the cycle remains compliant.

- [ ] **Step 5: Separate marker, continuation, nested-list, and special-block output**

Import `BULLET_LIST_REF` and `listTextIndent` into `pm-visitor.ts`. Within each
list item, track `markerEmitted = false` and handle children in this order:

```ts
if (child.type === "bulletList" || child.type === "orderedList") {
  visitList(child, depth + 1, isOrdered ? reference : inheritedRef);
} else if (child.type === "paragraph") {
  const markerProps = isOrdered
    ? { numbering: { reference, level: depth, instance } }
    : { numbering: { reference: BULLET_LIST_REF, level: depth } };
  emit(
    "Normal",
    inlineToTextRuns(child.content ?? [], state.ctx, state.citationCounter),
    markerEmitted
      ? { indent: { left: listTextIndent(depth) } }
      : markerProps,
  );
  markerEmitted = true;
} else {
  const specialBlocks = visitBlocks([child], state);
  if (specialBlocks.length > 0) {
    emittedFirst = true;
    out.push(...specialBlocks);
  }
}
```

The list schema guarantees a leading paragraph, so no synthetic marker is
needed for a special block. Do not give a special block numbering or bullet
properties.

- [ ] **Step 6: Run the exporter test and verify GREEN**

Run:

```sh
/Users/andresdominicci/.deno/bin/deno task test --run packages/docx-export/test/export.test.ts
```

Expected: every exporter test passes; the continuation paragraph aligns at
1440 twips without a marker, the nested bullet continuation aligns at 2160
twips without a marker, `Tabla 2` is present without a marker, and the post-list
paragraph uses `BodyText`.

- [ ] **Step 7: Format, inspect, and commit the DOCX change**

Run:

```sh
/Users/andresdominicci/.deno/bin/deno fmt packages/docx-export/src/styles.ts packages/docx-export/src/pm-visitor.ts packages/docx-export/src/sample.ts packages/docx-export/test/export.test.ts
git diff --check
git diff -- packages/docx-export/src/styles.ts packages/docx-export/src/pm-visitor.ts packages/docx-export/src/sample.ts packages/docx-export/test/export.test.ts
git add packages/docx-export/src/styles.ts packages/docx-export/src/pm-visitor.ts packages/docx-export/src/sample.ts packages/docx-export/test/export.test.ts
git commit -m "fix: preserve DOCX list item structure"
```

---

### Task 3: Lock editor compliance and verify the complete data path

**Files:**

- Create: `apps/desktop/src/lib/editor/apaCss.test.ts`
- Verify: `apps/desktop/src/lib/editor/apa.css`
- Verify: all files changed by Tasks 1–2

**Interfaces:**

- Consumes: the existing editor CSS rules for body paragraphs, block quotes,
  list-item paragraphs, tables, and figures.
- Produces: a characterization test preventing a future list reset from leaking
  into body paragraphs or special formats.

- [ ] **Step 1: Add the editor CSS characterization test**

Create `apaCss.test.ts`:

```ts
import { describe, expect, it } from "vitest";

const css = Deno.readTextFileSync(new URL("./apa.css", import.meta.url));

describe("APA editor indentation", () => {
  it("scopes indentation exceptions to their special blocks", () => {
    expect(css).toMatch(
      /\.apa-editor \.tiptap p\s*\{[^}]*text-indent:\s*0\.5in;/s,
    );
    expect(css).toMatch(
      /\.apa-editor \.tiptap li p\s*\{[^}]*text-indent:\s*0;/s,
    );
    expect(css).toMatch(
      /\.apa-editor \.tiptap blockquote p\s*\{[^}]*text-indent:\s*0;/s,
    );
    expect(css).toMatch(
      /\.apa-editor \.tiptap \.apa-table th p,\s*\.apa-editor \.tiptap \.apa-table td p\s*\{[^}]*text-indent:\s*0;/s,
    );
    expect(css).toMatch(/\.tbl-title\s*\{[^}]*text-indent:\s*0;/s);
    expect(css).toMatch(/\.fig-title\s*\{[^}]*text-indent:\s*0;/s);
  });
});
```

This is characterization of already-correct behavior, so it is expected to
pass immediately and does not authorize a production CSS change.

- [ ] **Step 2: Run all cross-renderer formatting tests**

Run:

```sh
/Users/andresdominicci/.deno/bin/deno task test --run apps/desktop/src/lib/editor/apaCss.test.ts apps/desktop/src/lib/preview/renderEssayHtml.test.ts packages/docx-export/test/export.test.ts
```

Expected: all selected tests pass with no failures.

- [ ] **Step 3: Run the canonical repository verification gate**

Run, in this order:

```sh
/Users/andresdominicci/.deno/bin/deno task check
/Users/andresdominicci/.deno/bin/deno task test
/Users/andresdominicci/.deno/bin/deno fmt
/Users/andresdominicci/.deno/bin/deno lint
```

Expected: Svelte check reports 0 errors and 0 warnings, all Vitest files pass,
formatting completes, and lint exits successfully.

- [ ] **Step 4: Prove scope containment and commit the guard test**

Run:

```sh
git status --short
git diff --check
git diff main...HEAD --stat
git add apps/desktop/src/lib/editor/apaCss.test.ts
git commit -m "test: lock APA indentation boundaries"
```

- [ ] **Step 5: Perform fresh pre-PR verification**

Run the canonical four-command gate again after the final commit, then inspect:

```sh
git status --short --branch
git log --oneline main..HEAD
git diff --check main...HEAD
git diff --name-status main...HEAD
```

Expected: the worktree is clean, commits are limited to the approved design,
plan, preview, DOCX, and test files, and every gate command exits successfully.

---

## Pull Request and Closeout

After Task 3, use `superpowers:requesting-code-review` for an internal review,
then `superpowers:finishing-a-development-branch` with the user's already chosen
PR path:

1. Fetch `origin/main`, merge it into local `main`, and verify zero divergence.
2. Merge updated `main` into `fix/list-block-formatting` only if the remote
   advanced, resolving conflicts before push.
3. Push `fix/list-block-formatting` and open a PR to `main`; this repository has
   no `dev` branch.
4. Use an English PR title/body with the defect, renderer behavior, APA boundary,
   and exact verification evidence.
5. Post exactly `@codex review`; request no other reviewer.
6. Wait for CI and Codex review. Address every valid actionable thread with
   test-first fixes, reply in English on the original thread, and resolve only
   addressed or demonstrably informational threads.
7. Repeat checks and thread inspection until all checks pass and no actionable
   unresolved review thread remains.
8. Merge the PR to `main`, fetch `origin`, fast-forward local `main`, and prove
   local/remote parity by commit and zero divergence.
9. Remove only `.worktrees/fix-list-block-formatting`, prune its registration,
   delete the merged local feature branch, and prove both are gone.

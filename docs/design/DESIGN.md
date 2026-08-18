# Tesina — Design System v2 (chrome only)

The visual contract for Tesina's **application chrome**. This file is
canonical; when it and a component disagree, the component is wrong.

**Reference implementations** (open either straight from the working tree):

| File | What it is |
|---|---|
| `docs/design/design-system-v2.reference.html` | The v2 gallery. Links the app's **real** `tokens.css`, `controls.css`, `modal.css` and `controls-v2.css`, so no specimen can drift from what ships. |
| `docs/design/new-paper-modal.reference.html` | The v1 origin artifact — one modal, self-contained, light/dark toggle in the titlebar. |

**Implementation files**

| File | Holds |
|---|---|
| `apps/desktop/src/lib/styles/tokens.css` | Every token. Raw hex lives only in the two theme blocks. |
| `apps/desktop/src/lib/styles/controls.css` | v1: fields, Select, segmented control, status panel, buttons. |
| `apps/desktop/src/lib/styles/controls-v2.css` | v2: badge, chip, quiet button, empty state, modal width scale. |
| `apps/desktop/src/lib/components/modal.css` | Modal chrome. Imported by `Modal.svelte`. |

## What v2 changed

v1 specified the big surfaces and left the small ones to each author,
so five components each invented a badge and two invented a chip. v2
adds the missing layer and one rule that decides it — see
**§5.0 The shape and colour rule**.

- **New:** `.badge` (+ 6 tones), `.chip`, `.btn-quiet`, `.empty-state`,
  `.popover` (+ its status header).
- **Renamed:** `.btn-ghost` → `.btn-secondary` (they were already the
  same rule); `.modal-ref` → `.modal-lg`; `.modal-sm` added.
- **Retired:** the `.btn-ghost` and `.modal-ref` aliases. Both are
  gone; there is no compatibility shim to fall back on.
- **Unchanged:** color, type, space, elevation, modal chrome, fields,
  Select, segmented control, status panel. v2 is additive.

---

## 0. Scope — what this system may never touch

**Frozen. The APA document sheet and everything rendered on it.**

| Frozen path | Why |
|---|---|
| `apps/desktop/src/lib/editor/apa.css` | The paper sheet. Every selector is `.apa-editor …` |
| `apps/desktop/src/lib/preview/renderEssayHtml.ts` | Same document, print/preview |
| `packages/docx-export/src/styles.ts` | Same document, DOCX output |
| `apps/desktop/src/lib/components/CoverSheet.svelte` | Title page on paper |
| `apps/desktop/src/lib/editor/pagination/**` | 816×1056 / 96px margin / 624×864 geometry |
| `apps/desktop/src/lib/components/PrintPreview.svelte` | Shows the printed page |

The seam is the `<Editor>` inside `<main class="canvas">` in
`EditorScreen.svelte`. **Chrome outside it, document inside it.**
This includes editing-only affordances that live inside the sheet
(ghost gridlines, figure edit button and menu, citation hover/selected
states, reference-overflow outlines): leave them alone.

Everything else is in scope: titlebar, sidebars, toolbars, float menus,
modals, home, library, backup surfaces, release notes, update banner.

---

## 1. Direction

The document is stark black-on-white paper. The chrome should therefore
**recede** — a quiet studio around the page — and earn its quality from
material, not from color volume.

Three decisions carry the whole system:

1. **Warm-neutral surfaces.** All neutrals sit at hue `85` with chroma
   `0.003–0.005` — an imperceptible warmth that reads as paper stock
   rather than screen gray. Never beige, never cream.
2. **A real elevation stack.** `canvas → chrome → surface → elevated`,
   with three shadow steps. The old system had one flat gray and one
   shadow, which is why modals looked pasted on.
3. **One typeface, always.** The chrome uses Inter and nothing else.
   Hierarchy comes from size, weight and tracking — never from a second
   family.

The accent is **the app's existing blue, `#2f6feb`** (`#5b8def` on
dark), carried over unchanged. Decided 2026-08-14: a first pass
proposed a darker, less chromatic ink blue; Andres kept the current
one.

This is the right call, and it sharpens what the system actually
claims: the old chrome did not look flat *because the blue was wrong*.
It looked flat because there was one gray, one shadow, and no
elevation ladder. Fixing surfaces, elevation, type scale and state
discipline is what does the work — the accent was never the problem.

> **Rejected direction, 2026-08-14.** The first pass set modal titles,
> page titles and the brand in the `--serif` stack (Iowan Old
> Style / Charter / Georgia) for an editorial, paper-echoing feel.
> Andres rejected it outright: the UI ships one typeface, and a serif
> headline reads as Times New Roman intruding on the app. **Do not
> reintroduce a display serif anywhere in chrome.** The serif belongs
> to the document, not to the interface.

---

## 2. Color

All values in `oklch()`. Raw hex is allowed **only** for the three
macOS traffic-light dots.

### Light — `:root`

```css
color-scheme: light;
accent-color: var(--accent);

--canvas:       oklch(0.967 0.0022 85);   /* app background            */
--bg:           oklch(0.979 0.0018 85);   /* recessed wells, inputs    */
--surface:      oklch(1 0 0);             /* cards, modals             */
--chrome:       oklch(0.988 0.0020 85);   /* titlebar, sidebar, footer */
--elevated:     oklch(1 0 0);             /* popovers over surface     */

--fg:           oklch(0.235 0.010 265);
--fg-2:         oklch(0.415 0.012 265);
--muted:        oklch(0.485 0.012 265);

--border:       oklch(0.895 0.004 85);
--border-soft:  oklch(0.945 0.003 85);
--border-strong:oklch(0.640 0.005 85);    /* text-entry edges, 3.2:1   */

--accent:       oklch(0.5726 0.1989 261.8);  /* #2f6feb — unchanged  */
--accent-on:    oklch(1 0 0);                /* pure white, on purpose */
--accent-hover: oklch(0.5000 0.1989 261.8);  /* #1858d2              */

--success:      oklch(0.520 0.115 152);
--warn:         oklch(0.560 0.115 68);
--danger:       oklch(0.520 0.165 27);
--paper:        oklch(1 0 0);
```

### Dark — `:root[data-theme="dark"]`

```css
color-scheme: dark;

--canvas:       oklch(0.185 0.008 265);
--bg:           oklch(0.215 0.009 265);
--surface:      oklch(0.248 0.010 265);
--chrome:       oklch(0.222 0.009 265);
--elevated:     oklch(0.278 0.011 265);

--fg:           oklch(0.948 0.004 85);
--fg-2:         oklch(0.815 0.008 265);
--muted:        oklch(0.675 0.010 265);

--border:       oklch(0.330 0.012 265);
--border-soft:  oklch(0.282 0.010 265);
--border-strong:oklch(0.530 0.014 265);

--accent:       oklch(0.6545 0.1562 262.5);  /* #5b8def — unchanged  */
--accent-on:    oklch(0.180 0.012 265);
--accent-hover: oklch(0.7200 0.1562 262.5);  /* #6ea2ff              */

--success:      oklch(0.720 0.135 152);
--warn:         oklch(0.780 0.120 75);
--danger:       oklch(0.680 0.155 25);
--paper:        oklch(0.260 0.010 265);
```

Note the dark surface ladder: `canvas 0.185 < chrome 0.222 <
surface 0.248 < elevated 0.278`. A modal on dark is **lighter** than
the app behind it. The old dark theme had `surface` barely above
`bg`, which is why dark modals read as flat rectangles.

### Derived (theme-independent)

```css
--hover:        color-mix(in oklab, var(--fg), transparent 94%);
--hover-strong: color-mix(in oklab, var(--fg), transparent 89%);
--raise:        color-mix(in oklab, var(--fg), transparent 88%);
--accent-soft:  color-mix(in oklab, var(--accent), transparent 88%);
--success-soft: color-mix(in oklab, var(--success), transparent 88%);
--warn-soft:    color-mix(in oklab, var(--warn), transparent 86%);
--danger-soft:  color-mix(in oklab, var(--danger), transparent 88%);
--warn-strong:  color-mix(in oklab, var(--warn), var(--fg) 45%);
--focus-ring:   0 0 0 3px color-mix(in oklab, var(--accent), transparent 72%);
```

All four semantic tones get a wash, so a status surface can change tone
without reaching for a literal. `--warn-strong` exists because raw
`--warn` is a mid yellow that cannot carry 11px text on its own wash.

### Overlay + elevation

Overlay and shadow are the only tokens that differ structurally per
theme, so they are declared inside each theme block:

```css
/* light */
--overlay-tint: oklch(0.235 0.010 265 / 0.34);
--edge-hi: transparent;
--elev-1: 0 1px 1px oklch(0.235 0.01 265/0.05), 0 1px 3px oklch(0.235 0.01 265/0.05);
--elev-2: 0 1px 2px oklch(0.235 0.01 265/0.06), 0 6px 16px oklch(0.235 0.01 265/0.07);
--elev-3: 0 1px 2px oklch(0.235 0.01 265/0.07),
          0 12px 28px oklch(0.235 0.01 265/0.10),
          0 40px 76px oklch(0.235 0.01 265/0.10);

/* dark */
--overlay-tint: oklch(0.120 0.010 265 / 0.62);
--edge-hi: oklch(1 0 0 / 0.07);            /* inset top hairline       */
--elev-1: 0 1px 2px oklch(0 0 0/0.32);
--elev-2: 0 2px 4px oklch(0 0 0/0.34), 0 8px 20px oklch(0 0 0/0.30);
--elev-3: 0 2px 4px oklch(0 0 0/0.40),
          0 16px 34px oklch(0 0 0/0.42),
          0 48px 90px oklch(0 0 0/0.44);
```

On dark, elevated containers add `inset 0 1px 0 var(--edge-hi)` — a
1px top highlight. That single line is most of what makes dark modals
look crafted instead of drawn.

Keep `--elev-raised` and `--elev-lg` as aliases of `--elev-2` /
`--elev-3` so existing call sites keep working.

### Accent discipline

Accent carries **selection and the primary action** — nothing else.
Permitted uses:

1. The one primary button per surface.
2. The selected item in a segmented control.
3. The focus ring.
4. The sidebar brand mark.

Everything else stays neutral. In particular the titlebar mark is ink,
not accent, and empty-state affordances (the "new essay" plus badge)
are neutral.

> **Deviation from the usual 2-accents-per-screen cap, decided
> 2026-08-14.** The first pass rendered the selected segment as a
> raised white pill (`--surface` + `--elev-1`). Andres rejected it as
> "too whitey" — on a white modal the selected and unselected states
> were nearly indistinguishable. Selection now takes a solid `--accent`
> fill with `--accent-on` text. This puts up to 4 accent marks on the
> new-essay modal; that is intentional, because selection state is
> information, not decoration.

Hover on an unselected segment stays neutral (`--hover` + `--fg`), so
the accent never appears on a state the user has not chosen.

### Contrast — computed, not estimated

Ratios below were calculated from the OKLCh values via linear-sRGB
relative luminance (WCAG 2.x). Resolved hex is shown for reference only;
the CSS ships OKLCh.

| Pair | Light | Dark |
|---|---|---|
| `--fg` on `--surface` | **16.68:1** | **13.83:1** |
| `--fg-2` on `--surface` | 8.65:1 | 9.06:1 |
| `--muted` on `--surface` (12px labels) | 6.40:1 | 5.48:1 |
| `--muted` on `--bg` | 6.02:1 | 5.97:1 |
| `--muted` on `--chrome` | 6.18:1 | 5.87:1 |
| `--accent-on` on `--accent` (primary btn, selected segment) | **4.57:1** | 5.81:1 |
| `--accent-on` on `--accent-hover` | 6.26:1 | 7.38:1 |
| `--accent` as a focus border on `--bg` | 4.31:1 | 4.68:1 |
| `--border-strong` on `--bg` (control edge) | 3.17:1 | 3.32:1 |

Every text pair clears 4.5:1; every control boundary clears 3:1. Primary
hover **raises** contrast in both themes (4.57 → 6.26 light, 5.81 → 7.38
dark). Disabled is the only state permitted to drop.

**v2 pairs — text on its own wash**

| Pair (11–12px) | Light | Dark |
|---|---|---|
| `--fg-2` on `--hover-strong` (neutral `.badge`) | 6.72:1 | 7.21:1 |
| `--warn-strong` on `--warn-soft` (`.badge-warn`) | 7.12:1 | 8.43:1 |
| `--accent-text` on `--accent-soft` (`.badge-accent`, selected `.chip`) | 4.90:1 | 5.02:1 |
| `--success-text` on `--success-soft` | 4.72:1 | 6.07:1 |
| `--danger-text` on `--danger-soft` | 4.96:1 | 4.97:1 |

Each figure is the **worst** of the four surfaces the wash can sit on
(`--surface`, `--chrome`, `--bg`, `--canvas`), because a soft wash is
translucent and inherits the ground beneath it.

The `--*-text` tokens exist for exactly this. Setting the raw tone as
text on its own wash lands at 3.58–4.44:1 and breaks the floor above —
which is condition 2 below, restated. Use the raw tone for a fill and
the `-text` variant for a label.

**The 4.57:1 is a deliberate, narrow pass — respect its two conditions:**

1. **`--accent-on` must stay pure white on light.** The earlier
   off-white `oklch(0.995 0.001 85)` drops it to ~4.55:1. Do not
   "soften" it.
2. **Never set text in `--accent` on a non-white surface.** On `--bg`
   it is 4.31:1 and fails, and on its own `--accent-soft` wash it is
   3.91:1. In this system `--accent` only ever appears as a *fill*
   (with `--accent-on` text), a focus ring, a selection tint, or a 1px
   focus border — the border needs 3:1 and clears it at 4.31:1.
   Accent-colored **text** uses `--accent-text`
   (`oklch(0.50 0.1989 261.8)` light, `oklch(0.70 0.1562 262.5)` dark),
   which is the darkened value this section prescribed before v2 needed
   it. `--success` and `--danger` have the same pair of variants for
   the same reason. Keep the raw tones for fills.

Resolved values — light: `--fg` `#1c1e23`, `--muted` `#5c5f66`,
`--accent` `#2f6feb`, `--accent-hover` `#1858d2`. Dark: `--fg`
`#efeeeb`, `--muted` `#94979d`, `--accent` `#5b8def`, `--accent-hover`
`#6ea2ff`, `--surface` `#1f2126`, `--canvas` `#111316`.

### `--border-strong`

`--border` (1.37:1) is a structural hairline — fine for dividers, but it
cannot carry the boundary of an **empty text field**, which has no label
inside it to identify it. Those get a separate token:

```css
/* light */ --border-strong: oklch(0.640 0.005 85);   /* #8d8c89 */
/* dark  */ --border-strong: oklch(0.530 0.014 265);  /* #686c74 */
```

Scope it to `input` and `textarea` **only**. Ghost buttons and the
segmented track are identified by their own text, so they keep the
hairline `--border` — giving them a heavy edge makes them compete with
the primary button, which is exactly the hierarchy inversion this
system exists to prevent.

### Native controls

Each theme block sets `color-scheme: light` / `dark`, and `:root` sets
`accent-color: var(--accent)`. Without this the native date picker,
scrollbars and checkboxes render in the wrong theme — visible today on
the due-date field in dark mode.

---

## 3. Typography

```css
--font: Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
--mono: ui-monospace,"JetBrains Mono","SF Mono",Menlo,monospace;
```

**There is no `--font-display`.** Every chrome surface — titlebar,
sidebar, brand, screen titles, modal titles, labels, buttons — resolves
to `--font`. No new font file ships and no second family is introduced.

`--serif` stays defined in `tokens.css` because the **document** needs
it (`apa.css`, `CoverSheet`, the font picker's APA-approved serif
stacks). It must never be referenced from chrome. See §3.1 for the
twelve existing chrome call sites that move off it, and the one frozen
site that keeps it.

### Scale — replaces 24 ad-hoc values

```css
--t-caption: 11px;   --t-small: 12px;  --t-body: 13px;   --t-ui: 14px;
--t-h3: 16px;        --t-h2: 20px;     --t-h1: 26px;

--lh-tight: 1.15;    --lh-snug: 1.35;  --lh-body: 1.55;
--w-read: 400;       --w-medium: 530;  --w-strong: 600;
```

`12.5px`, `13.5px`, `11.5px`, `10.5px`, `9.5px` and every `rem` value
in chrome are to be deleted. Weight `700+` is not used. As of v2 the
sweep is still pending: twelve `rem` values survive in chrome (three
more sit in `PrintPreview.svelte`, which §0 freezes).

| Role | Size / weight | Tracking |
|---|---|---|
| Screen title (`Tus ensayos`) | `--t-h1` / `--w-strong` | **`-0.024em`** |
| Modal title | `--t-h2` / `--w-strong` | **`-0.018em`** |
| Brand wordmark | `--t-h3` / `--w-strong` | `-0.014em` |
| Card title, nav item | `--t-body` / `--w-medium` | `-0.003em` |
| Input text | `--t-ui` / `--w-read` | `0` |
| Field label | `--t-small` / `--w-medium`, `--fg-2` | `0.004em` |
| Hint, meta | `--t-caption`, `--muted` | `0` |
| Section / nav label (ALL CAPS) | `--t-caption` / `--w-medium`, `--muted` | **`0.09em`** |

Tracking is doing the work a second typeface used to do. With one
family, a 26px headline at default tracking reads as nothing more than
large body text; `-0.024em` is what makes it a headline. Do not relax
these values.

All-caps tracking of `0.09em` is mandatory — the current `nav-label`
and badges are set without it, which is the loudest amateur tell in
the app today.

### 3.1 Existing serif call sites in chrome

`var(--serif)` appears at 13 component call sites today (plus three in
`apa.css`, which is frozen). **Twelve move to `--font`. One does not.**

**Remove `font-family: var(--serif)` — let them inherit `--font`:**

Locate them with `grep -rn "var(--serif)" apps/desktop/src`.

| File | Element |
|---|---|
| `EssayHome.svelte` | sidebar logo `T` |
| `EssayHome.svelte` | titlebar mark `T` |
| `EssayHome.svelte` | `.thumb-text` — essay-card first-lines preview |
| `LibraryScreen.svelte` | logo `T` |
| `LibraryScreen.svelte` | `.pc-entry` — reference preview |
| `EditorScreen.svelte` | logo `T` |
| `EditorScreen.svelte` | `.rtxt` / `.ref-card :global(.rtxt)` |
| `EditorScreen.svelte` | `.bb.it` — italic style button |
| `ReferencesPanel.svelte` | `.runs` — reference list entries |
| `RefEntry.svelte` | `.rtxt` — formatted APA reference |
| `CitationPopover.svelte` | `.item span` — citation preview |
| `HeadingMenu.svelte` | `.pv` — heading style previews |

Decided 2026-08-14: the interface is Inter everywhere, with no
exception for document previews. The consequence is deliberate — the
references panel now sets APA entries in Inter while the paper sets
them in Times. The panel is UI; the sheet is the document. They are not
supposed to match.

**Do NOT touch — this one is inside the frozen zone:**

| File | Element |
|---|---|
| `CoverSheet.svelte` | `.cf` — `var(--doc-font, var(--serif))` |

`.cf` is the editable title-page field rendered **on the paper**, and
`--serif` is only its fallback when the user has not picked an APA
font. Switching it to Inter would put a sans title page on the sheet
and break the document. It is covered by the §0 boundary.

After this pass, `var(--serif)` would survive only in `apa.css`,
`CoverSheet.svelte`, `nativeProof.css` and the font-picker stacks —
all document territory, leaving chrome referencing it zero times. **The
pass has not been done.** All thirteen call sites are still live as of
v2, so §8's lint would fail today; write the lint and the sweep in the
same change.

---

## 4. Space, radius, layers, motion

```css
--sp-05:2px; --sp-1:4px;  --sp-15:6px; --sp-2:8px;  --sp-3:12px;
--sp-4:16px; --sp-5:20px; --sp-6:24px; --sp-7:32px; --sp-8:40px;

--r-xs:6px; --r-sm:8px; --r-md:12px; --r-lg:16px; --r-pill:999px;

--z-base:0; --z-sticky:20; --z-dock:40;
--z-overlay:100; --z-modal:110; --z-popover:120; --z-toast:200;

--ease: cubic-bezier(0.2,0,0,1);
--ease-out: cubic-bezier(0.16,1,0.3,1);
--fast:150ms; --slow:260ms;

--ctl-h-sm:32px; --ctl-h:36px; --ctl-h-lg:42px;
```

`--z-*` replaces the ten ad-hoc z-index values currently scattered
from `2` to `200`.

Wrap all transitions and animations in a
`@media (prefers-reduced-motion: reduce)` override.

---

## 5. Component specs

### 5.0 The shape and colour rule

v1's small components drifted because nothing said which shape or
colour meant what, so each author picked. Two rules close that gap, and
every component below follows from them.

> **Shape says whether you can click it. Colour says how urgent it is.**

| Shape | Radius | Means |
|---|---|---|
| Squared | `--r-xs` | Information. Badges and counts are labels on the content, not controls. |
| Pill | `--r-pill` | A control. Chips, the editor dock and its buttons. If it is fully round, pressing it does something. |

| Tone | Means |
|---|---|
| Neutral | A category. Reference type, section kind, file format, document language. |
| `--accent` | What the user is acting on **right now**, or a live count tied to the current selection. |
| `--warn` | Fix this, but you are not blocked. |
| `--danger` | Broken or invalid. |
| `--success` | Something finished, and stayed finished. |

Colour encodes **urgency, never category**. A reference's type and an
essay's language are categories, so they are neutral. "Uncited" and
"Duplicate" are things to fix, so they are warm. Accent is the app's
only live colour and it is scarce on purpose: a badge earns accent only
when it names what the user is acting on right now.

The mechanical part of adopting a badge is the class name. The
judgement part is deciding, per badge, whether it classifies or needs
fixing. A global find-and-replace to `.badge-accent` reproduces the
v1 problem in new syntax.

### Modal

| Part | Spec |
|---|---|
| Overlay | `--overlay-tint`, `backdrop-filter: blur(3px) saturate(0.9)`, `z-index: var(--z-overlay)`, padding `--sp-5` |
| Dialog | `min(520px,100%)`, `--surface`, `1px --border`, `--r-lg`, `--elev-3` + `inset 0 1px 0 --edge-hi` |
| Entry | overlay fades `--slow --ease-out`; dialog rises `translateY(10px) scale(0.985)` |
| Head | `--sp-5 --sp-6 --sp-4`, bottom `1px --border-soft`; title display/`--t-h2`; subtitle `--t-small --muted` |
| Body | `--sp-5 --sp-6`, `gap: --sp-4`, `overflow-y:auto`, `overscroll-behavior:contain` |
| Foot | `--sp-4 --sp-6`, top `1px --border-soft`, background `--chrome` |
| Close | 30×30, `--r-xs`, `--muted` → hover `--hover-strong` + `--fg` |

Head and foot are `flex: 0 0 auto`; only the body scrolls. The footer
sitting on `--chrome` rather than `--surface` is what gives the dialog
a base instead of a cut edge.

**Width scale** — `Modal.svelte`'s `size` prop. `.modal-ref` named a
caller; these name sizes.

| `size` | Class | Width | For |
|---|---|---|---|
| `"sm"` | `.modal-sm` | 420px | Confirmations — delete a reference, quit with unsaved work. One sentence and two buttons; at 520px they looked like an empty form. |
| `"default"` | — | 520px | The default. Settings, title page, table insert, equation. |
| `"lg"` | `.modal-lg` | 564px | Long scrolling forms with two-up field rows — the reference form and the BibTeX import review list. |

Both size rules are written compounded (`.modal.modal-sm`) rather than
bare. `.modal { width }` lives in `modal.css`, which `Modal.svelte`
imports on its own, so a bare `.modal-sm` would tie on specificity and
be decided by bundle order.

**Footer order is fixed:** note left, then secondary, then primary at
the trailing edge. Never two primaries, never a primary on the left.
Cancel is always `.btn-secondary`, labelled from `common_close` for a
dialog you can leave, or a verb-negating label ("Keep editing") when
leaving would discard work.

One line of orienting copy goes in `subtitle`, not as the body's first
paragraph.

**Dismissal:** Escape and the close button only. Overlay click does
**not** dismiss any modal that holds in-progress edits — that rule is
already in `Modal.svelte`'s `dismissOnOverlay` prop; keep it.

### Fields

- `.field` = column, `gap: --sp-15`; label `--t-small --w-medium --fg-2`.
- `.field-row` = `grid-template-columns: repeat(2, 1fr)`, `gap: --sp-3`.
  **Explicit columns — never `auto-fill` / `auto-fit`.** Mixed-width
  field groups must use explicit row wrappers.
- Input: `--bg` well, `1px --border-strong`, `--r-sm`, padding `9px 11px`,
  font `--t-ui`.
- `:hover` → `border-color: --fg-2`. `:focus` → background lifts to
  `--surface`, `border-color: --accent`, plus `--focus-ring`. The
  well-to-surface lift on focus is the detail that makes typing feel
  responsive.

### Buttons

One action, one primary. Height `--ctl-h`, radius `--r-sm`, font
`--t-body --w-strong`, `:active { transform: translateY(1px) }`.

`.btn-quiet` is the one exception and is **not** written as `btn
btn-quiet` — it is a standalone class with its own dense geometry
(`--ctl-h-sm`, `--r-xs`, `--t-small`, `--w-medium`, no `:active`
transform), because it lives inside a row of content rather than in a
footer of actions.

| Variant | Rest | Hover | Disabled |
|---|---|---|---|
| `.btn-primary` | `--accent` / `--accent-on` | `--accent-hover` | `color-mix(--accent, --bg 58%)` / `--accent-on` |
| `.btn-secondary` | `--surface` / `--fg-2`, `--border` | `--hover`, `--fg`, `--fg-2` border | `opacity: .5` |
| `.btn-danger` | `--surface` / `--danger`, `--border` | `--danger-soft`, `--danger` border | `opacity: .5` |
| `.btn-danger-solid` | `--danger` / `--accent-on` | `color-mix(--danger, --fg 14%)` | `opacity: .5` |
| `.btn-quiet` | none / `--fg-2`, no border | `--hover`, `--fg` | `opacity: .5` |

**When to use which**

| Variant | Use it for |
|---|---|
| `.btn-primary` | Exactly one per surface, always last in a footer row. |
| `.btn-secondary` | Everything else with a border: cancel, close, back, open folder. **Canonical name** — `.btn-ghost` was the same rule and is retired. |
| `.btn-quiet` | Borderless inline action in a dense row — a reference row's Cite/Delete, a collection row's icons, the home footer's links. This is what "ghost" should have meant. |
| `.btn-danger` | *Opens* a destructive flow. Stays bordered; the label carries the warning. |
| `.btn-danger-solid` | *Commits* it. Only ever in the primary slot of a confirmation modal. |

Sizes: `.btn-sm` (32px, dense panels), `.btn-block` (full width, 42px,
a wizard's single action). `.btn-quiet.btn-icon` is a 32px square, so a
row of icon actions keeps an even rhythm. `.btn-quiet.btn-danger-text`
is the destructive member of a quiet row.

Primary hover **darkens** on light and **lightens** on dark, so
contrast rises in both themes.

A blocked primary stays a **washed accent**, never a neutral chip. The
new-essay modal opens with its primary blocked; rendered as a gray chip
it lost to the ghost Cancel beside it, and the user could no longer
tell which button was the real action.

**Use `aria-disabled="true"`, not the `disabled` attribute**, for a
primary blocked by validation. `disabled` drops the control out of the
tab order, so a keyboard or screen-reader user reaches the end of the
dialog without ever meeting the button that would submit it, and gets
no explanation. With `aria-disabled` the control stays focusable and
pressing it surfaces the reason. Reserve the real `disabled` attribute
for genuinely inert moments — the in-flight submit below.

### Segmented control

Track `--bg` + `1px --border` + `--r-sm`, 3px inner padding, `--r-xs`
on the items.

| State | Background | Text |
|---|---|---|
| Selected | `--accent` + `--elev-1` | `--accent-on`, `--w-strong` |
| Unselected | transparent | `--muted` |
| Unselected hover | `--hover` | `--fg` |

Selected contrast is **4.57:1 light / 5.81:1 dark** — the same pair as
the primary button, so it holds in both themes. Because the light side
sits close to the 4.5:1 floor, the selected label must stay pure white;
see §2's two conditions.

Drive it from `aria-pressed`, not a `.active` class alone. When
migrating, keep `.active` as a selector alias so no component logic has
to change.

### Section divider

`--t-caption` uppercase, `letter-spacing: 0.09em`, `--muted`, followed
by a flexible `1px --border-soft` rule. Groups long forms without
adding another card.

### Badge — v2

A static label on content the user is reading. **Never clickable,
never animated, one size**: 18px tall, `--r-xs`, `--t-caption` at
`--w-medium`. If it needs to be pressed, it is a chip.

| Class | Use it for |
|---|---|
| `.badge` | Classification and metadata. **The default**, and what most badges should be: reference type, section kind, file format. |
| `.badge-accent` | What the user is acting on right now, or a live count tied to the current selection. Scarce by design. |
| `.badge-warn` | Fix this, but you are not blocked: uncited reference, duplicate BibTeX key, missing title-page field. |
| `.badge-danger` | Broken or invalid: a citation pointing at a deleted reference, an asset that failed to import. |
| `.badge-success` | Something finished. Rare — a *lasting* state. A transient confirmation belongs in the status panel. |
| `.badge-code` | A machine value rather than a word: language tag, file extension, BibTeX key. Mono, uppercased. |
| `.badge-count` | A number at the end of a nav or collection row. Tabular figures, `min-width: 18px`, so a stacked column cannot jitter. |

`.badge-warn` takes `--warn-strong`, not `--warn`: raw `--warn` is a mid
yellow and cannot carry 11px text on its own wash.

A component may add a **layout** hook for a badge it hosts
(`margin-left: auto`, `flex: 0 0 auto`). It may not restate the badge's
appearance.

### Chip — v2

A filter you toggle. Always a `<button>`, always in a wrapping flex row
at `gap: var(--sp-2)`. 26px tall, `--r-pill`, `--t-small`.

Selected reads `aria-pressed="true"`; the `.on` class is accepted as an
alias so existing markup needs no logic change.

| State | Spec |
|---|---|
| Rest | `--surface`, `1px --border`, `--fg-2` |
| Hover | border `--fg-2`, text `--fg`. **Border and text only** — the wash is reserved for selected, so hovering never previews selection. |
| Selected | `--accent-soft` wash, `--accent` text, border `color-mix(--accent, transparent 45%)` |
| Disabled | `opacity: 0.5` |

**Chip vs. segmented control.** A chip narrows a list and any number can
be off, so it takes the soft wash. The segmented control picks exactly
one mode and keeps the **solid** accent fill. Two jobs, two shapes, two
weights of colour — so "which filter" and "which mode" never look alike.

### Popover — v2

**One floating surface.** Before v2 there were **eight** of them, and they
agreed on nothing:

| Surface | Radius | Shadow | Inset hairline |
|---|---|---|---|
| `.select-pop` | `--r-md` | `--elev-3` | yes |
| `UpdatePill .card` | `--r-md` | `--elev-3` | yes |
| `CitationPopover .pop` | **raw `10px`** | `--elev-raised` | no |
| `EditorScreen .menu` (× 3) | `--r-sm` | `--elev-raised` | no |
| `EssayHome .menu` | `--r-sm` | `--elev-raised` | no |
| `float-menu .menu-pop` (× 5) | `--r-md` | `--elev-raised` | no |

Four radii, two elevation steps, one raw literal — across thirteen
call sites. `.popover` replaces all of it:

| Part | Spec |
|---|---|
| Surface | `--elevated`, `1px --border`, `--r-md`, `--elev-3` + `inset 0 1px 0 --edge-hi` |

`--elevated`, not `--surface`: a popover floats **above** a surface, so
it takes the next step on the elevation ladder. The inset hairline is
what separates it in dark mode, where a drop shadow has nothing to
darken.

**`.popover` is the material only.** Placement, width and `z-index`
stay with each caller, deliberately — see §Popover & dock: the editor's
menus sit on a local stacking ladder anchored at `--z-dock`, and
promoting one to `--z-popover` would put a toolbar menu on top of an
open modal.

**Two surfaces are deliberately not popovers.** The modal is its own
component at `--r-lg`. The editor dock is a *control*, so §5.0's shape
rule gives it `--r-pill`.

#### Status header

A popover that reports state opens with a tinted header carrying a dot,
a title and optional meta — the `.status-panel` anatomy, moved onto a
popover.

| Part | Spec |
|---|---|
| `.popover-head` | `--sp-2 --sp-3`, tone wash, `1px --border-soft` bottom, top corners rounded to `--popover-r` |
| `.popover-dot` | 9px circle, `--muted` by default |
| `.popover-title` | `--t-small --w-strong --fg` |
| `.popover-meta` | `--t-caption --fg-2` |
| `.popover-foot` | `--sp-2 --sp-3`, `1px --border-soft` top, bottom corners rounded |

Tone comes from `data-tone`, and the values are **§5.0's four names** —
`success`, `accent`, `warn`, `danger` — so one vocabulary covers every
tinted thing in the app. (`.status-panel` still uses an older
`ok / busy / warn / off` set; converging the two is deferred.)

A **list picker** has no header at all. The Select listbox and the
heading, list, table and font menus are lists, not status reports.

`--popover-r` is `calc(--r-md - 1px)`: the children that paint to an
edge round themselves against the border, so the surface never needs
`overflow: hidden` — which is what would clip a beak.

#### The beak — deferred, on purpose

The chosen direction (prototype variant E) includes a beak tethering
the popover to the control that opened it. It is **not shipped yet**,
because the direction has to be right per surface and the app opens
popovers four different ways: the export menu opens up, the outline
menu opens down, and both `.menu-pop` and the citation popover flip
across all four edges with the dock. A beak pointing at nothing is
worse than no beak, and a beak on two surfaces out of seven would
rebuild the inconsistency v2 exists to remove. Do it in one pass.

### Empty state — v2

One component, two variants: `.empty-state` is a padded centred block
for a full column; `.empty-state.is-inline` is left-aligned and tighter,
for a panel or popover too short to centre anything in.

| Part | Spec |
|---|---|
| Block | column, `gap --sp-2`, padding `--sp-7 --sp-5`, centred, `--muted` |
| `.empty-title` | `--t-ui --w-medium --fg-2` |
| `p` | `--t-small`, `max-width: 34ch`, `text-wrap: pretty` |
| `.btn` | gets `margin-top: --sp-2` |
| `.is-inline` | padding `--sp-4 --sp-3`, `align-items: flex-start`, left-aligned |

**Copy rule:** name what is missing, then give one way forward. No
illustrations, no exclamation marks, and never the word "oops".

---

### Form states

Every form surface ships four states. A modal with only a default state
is unfinished.

**1. Default** — as specced above.

**2. Blocked** — primary at `aria-disabled="true"`, washed accent, still
focusable. No error is shown yet; the user has not tried anything.

**3. Invalid** — triggered by *attempting* the action, never by blur on
an untouched field:

| Part | Spec |
|---|---|
| Field border | `var(--danger)` via `[aria-invalid="true"]` |
| Field focus ring | `0 0 0 3px color-mix(in oklab, var(--danger), transparent 74%)` |
| Message | `--t-caption`, `--danger`, 13px alert icon, `--sp-15` gap |
| Wiring | `role="alert"`, `aria-describedby` from the field, `aria-invalid` on it |
| Focus | moves to the offending field |

`--danger` as message text is **5.99:1 light / 5.21:1 dark**; as a 1px
field border it is 5.64:1 / 5.67:1 against the well. No new token
needed.

Write the message text **when you show it**. A `role="alert"` whose
copy is already sitting in the DOM may not re-announce; populating it
on show is what makes the announcement reliable.

Clear the invalid state on the next keystroke, not on blur.

**4. Submitting** — the dialog owns the keyboard until it resolves:

| Part | Spec |
|---|---|
| Body | `opacity: 0.55; pointer-events: none` |
| Primary | real `disabled`, 13px spinner + label swap (`Creando…`) |
| Cancel and close | real `disabled` |
| Escape | suppressed mid-flight |
| Reset | on close — value, error, label and spinner all restored |

The spinner is `640ms linear infinite` but **resolves on its own**; no
indefinite spinner ships. Under `prefers-reduced-motion: reduce` the
spinner is `display: none` and the `Creando…` label carries the state
alone — a frozen ring is worse than no ring.

Enter in the single required field submits.

---

## 6. Applied to the new-essay modal

Today there is no create-paper modal — new essays come from a bare
`ES / EN` dropdown. The artifact proposes the modal:

- **Required now:** essay title only. Document language defaults to
  Spanish.
- **No APA-variant control.** This version supports the **student**
  variant only and the professional variant is hidden, so the modal
  does not offer the choice. Document language therefore sits as a
  full-width field, not in a two-up row — a lone control stranded in a
  2-column grid is the exact failure the explicit-rows rule guards
  against. Restore the two-up row only if the professional variant
  ships.
- **Deferred:** authors, affiliations, course, instructor, due date sit
  under a `PORTADA` divider. This is product-true — every
  `titlepage_error_missing_*` message says those fields are required
  *before exporting*, not before writing.
- Primary is disabled until the title has content.
- Footer note carries the contract: *"Solo el título es obligatorio ahora."*

### i18n

Every string maps to an existing Paraglide key except three, which
must be **added to both `messages/es.json` and `messages/en.json`**:

| Key | ES | EN |
|---|---|---|
| `home_new_create` | Crear ensayo | Create essay |
| `common_cancel` | Cancelar | Cancel |
| `home_new_required_note` | Solo el título es obligatorio ahora. | Only the title is required for now. |
| `home_new_error_missing_title` | Añade un título para crear el ensayo. | Add a title to create the essay. |
| `home_new_creating` | Creando… | Creating… |

`home_new_error_missing_title` is deliberately distinct from
`titlepage_error_missing_title` ("…antes de exportar"): one blocks
creation, the other blocks export. Do not reuse the export string.

Reused: `home_new_card_title`, `home_new_card_sub`, `common_close`,
`titlepage_essay_title`, `cover_title_ph`, `editor_doc_language_aria`,
`chip_spanish`, `chip_english`, `titlepage_authors`,
`titlepage_authors_placeholder`, `titlepage_hint`,
`titlepage_affiliations`, `titlepage_affiliations_placeholder`,
`titlepage_course`, `titlepage_course_placeholder`,
`titlepage_instructor`, `titlepage_due_date`, `titlepage_title`.

---

## 7. Known token bugs

**Fixed in v1** — kept here because each one names a failure mode worth
recognising again:

1. `--panel` was referenced by `routes/+page.svelte` and **defined
   nowhere**, so it always resolved to a hardcoded cream and ignored
   dark mode. `tokens.css` now defines `--panel: var(--chrome)`.
2. `LibraryScreen.svelte` carried a raw `#fff` and a raw `#000` inside
   a `color-mix`. Both are gone.

**Still open as of v2:**

3. Stale `var(--x, #hex)` fallbacks that encode a second, wrong
   palette: `var(--muted, #666)` and `var(--danger, #a33)` in
   `BackupSetupWizard` (two), `BackupStatusCard` and
   `LibraryImportModal`. Drop the fallback — bug 1 proves the
   assumption they protect has already failed once. (`BackupSettings`
   was named in v1 and has since been cleaned.)

---

## 8. Enforcement

**Not written yet.** Add one focused Vitest check over chrome CSS only,
excluding every frozen path in §0:

- no raw hex outside the two theme blocks in `tokens.css` (allow the
  three `--tl-*` traffic-light dots);
- no `var(--token, <color>)` fallback form;
- no `font-size` literal outside the `--t-*` definitions;
- no `z-index` literal outside the `--z-*` definitions.

---

## 9. The document — locked layer (APA 7)

Everything above this line is chrome, and chrome is ours to design. The
paper sheet is not. Its geometry, type sizes, spacing and indents are
fixed by the *Publication Manual of the American Psychological
Association* (7th ed.) and by <https://apastyle.apa.org>, and the app
exists to guarantee them — a student should never have to check.

> **No chrome token, component or aesthetic preference may change a
> measurement inside the paper sheet.** If a value is prescribed by
> APA, it is not a design decision.

§0 lists the frozen files. This section records the rules those files
implement, so a future change can be checked against the spec rather
than against the previous diff.

### Page geometry — US Letter at 96dpi

| Value | Where |
|---|---|
| `816 × 1056px` (8.5 × 11in) | `apa.css` |
| `padding: 96px` (1in, all four sides) | `apa.css` |
| `624px` (6.5in) text column | `apa.css` |
| `line-height: 2` (double), throughout | `apa.css` |

The 816px coordinate system never changes. The canvas may scale the
whole stack to fit a narrow window, but wrapping and pagination are
computed in page units, so what you see on screen breaks where the
printed page breaks.

### The seven permitted fonts

Times New Roman 12pt · Georgia 11pt · Computer Modern 10pt ·
Aptos 12pt · Calibri 11pt · Arial 11pt · Lucida Sans Unicode 10pt.

**Size is bound to family, not chosen separately** — picking Georgia
sets 11pt, picking Times sets 12pt. There is no font-size control in
the document and there must never be one: that is the single most
common way a paper falls out of compliance.

`apps/desktop/src/lib/model/fonts.ts` (`APA_FONTS`) is the source of
truth for screen and preview. `@tesina/docx-export` keeps a parallel
table that must change in the same commit.

### Headings — five levels, all at document size

| Level | Format |
|---|---|
| 1 | Centered, bold |
| 2 | Flush left, bold |
| 3 | Flush left, bold italic |
| 4 | Indented, bold, ends with a period — **run-in** |
| 5 | Indented, bold italic, ends with a period — **run-in** |

No heading changes size, and none is underlined or set in caps. Levels
4 and 5 are run-in: the app marks a heading as run-in only when a
paragraph actually follows it, appends the terminal period if the
author did not type one, and leaves both nodes independently editable.

### Indents — the four cases

| Case | Rule |
|---|---|
| Body paragraph | `text-indent: 0.5in`, first line only. No space between paragraphs (`margin: 0`). |
| Reference entry | Hanging: `padding-left: 0.5in; text-indent: -0.5in`. |
| Block quotation | `margin-left: 0.5in`; first line flush, no quotation marks, no rule or border. |
| Abstract, first line | `text-indent: 0`. The keywords line below it takes the 0.5in indent and an italic label. |

"References" is centered and bold at document size, double-spaced like
everything else, entries alphabetical. It is **not** a Level 1 heading
and is not italicized.

### Where compliance is enforced

| Rule | Enforced by | How it cannot drift |
|---|---|---|
| Margins, page size, double spacing, indents | `editor/apa.css` | Structural CSS on `.tiptap`. There is no UI that can change them. |
| Font family and its point size | `model/fonts.ts` | A closed set of seven; size is a property of the choice, not a separate control. |
| Heading level formatting and run-in periods | `apa.css` + a derived decoration | Derived from node type, not from author formatting. |
| Table and figure anatomy (7.8, 7.22) | `apa.css` counters | "Table N" / "Figure N" and "Note." are generated content; numbering renumbers itself. |
| Skipped heading levels, empty titles, empty paragraphs | `packages/apa-engine/src/check/apa-check.ts` | Live check, four rules. Flags the block with a soft tint — colour only, never layout. |

### Known gap — Title Case in headings

APA sets headings in Title Case. That is **the one prescribed heading
rule with no check behind it**: `apa-check.ts` ships four rules and
none of them reads heading text.

A fifth rule would close it, but it is not a mechanical addition. Title
Case is an English convention, and `essay.settings.documentLanguage`
also accepts Spanish, whose headings follow Spanish capitalization. Any
such rule must therefore be gated on the document language and carry
its own small-word list. Deliberately deferred — recorded here so the
gap stays visible rather than being rediscovered.

### Editing affordances that must never print

- Dashed ghost gridlines inside tables
- Citation chips, set in the chrome font at `0.82em`
- The APA-check tint and the reference-overflow outlines
- The pencil buttons on tables, figures and equations
- The "no references yet" message on the reference page

Each is chrome living inside the document. The preview and DOCX export
render from their own stylesheets, which is what keeps them off the
page — and the reason any new in-document affordance has to be added
there as an exclusion **in the same commit**.

### The document keeps its own palette

`.apa-editor` in `tokens.css` pins the pre-v1 hex values for `--fg`,
`--paper` and the rest, and restates the derived tokens rather than
inheriting them. Retuning the chrome palette therefore cannot restyle
the sheet.

`--paper-print` is deliberately theme-independent: the export CSS
hardcodes near-black ink, so following `--paper` in dark mode would
darken the page while the text stayed black.

---

## 10. v2 migration record

Completed in one branch. The class renames were mechanical — the v2
selectors accept the class names already in the markup — but three
changes went further than a rename, and are called out below: the
filter chips moved to `aria-pressed`, the membership chips gained it,
and two dialogs gained `size="sm"`.

| File | Deleted | Now uses |
|---|---|---|
| `ReferencesPanel.svelte` | `.pill`, `.pill.blue`, `.actions button`, `.empty` | `.badge`, `.badge-warn`, `.btn-quiet`, `.btn-quiet.btn-danger-text`, `.empty-state.is-inline` |
| `BibImportModal.svelte` | `.pill`, `.pill.warn` | `.badge`, `.badge-warn` |
| `EssayHome.svelte` | `.badge`, `.chip`, `.count`, `.foot button`, `.empty` | `.badge-code`, `.chip`, `.badge-count`, `.btn-quiet`, `.empty-state` |
| `LibraryScreen.svelte` | `.chip`, `.chip.on`, `.count`, `.mini`, `.empty` | `.chip`, `.badge-count`, `.btn-quiet.btn-icon`, `.btn-quiet.btn-danger-text`, `.empty-state` |
| `CitationPopover.svelte` | `.empty` | `.empty-state.is-inline` |
| 9 call sites | `btn-ghost` | `btn-secondary` |
| `Modal.svelte` | `ModalSize = "default" \| "ref"` | `"sm" \| "default" \| "lg"` |
| `controls.css`, `modal.css` | `.btn-ghost`, `.modal.modal-ref` | aliases retired |
| `Select`, `Toolbar`, `HeadingMenu`, `ListMenu`, `TableMenu`, `FontMenu`, `CitationPopover`, `EditorScreen` (× 3), `EssayHome`, `UpdatePill` | each surface's own background / border / radius / shadow | `.popover` |
| `UpdatePill`, `EditorScreen` (APA check) | a bare title paragraph | `.popover-head` + `.popover-dot` |

Tone decisions taken during the migration:

- A reference **type** classifies → neutral `.badge`.
- "In text only" classifies → neutral `.badge` (it was accent in v1,
  which put it in the same colour as two unrelated things).
- "Uncited" and "Duplicate" are things to fix → `.badge-warn`.
- A document **language** tag is a machine value → `.badge-code`.
- Nav and collection counts → `.badge-count`.
- The update popover reports state, so it earns a header: `success`
  when up to date, `accent` when an update is waiting, `danger` on a
  failed check.
- The APA check went from `--danger` to `--warn`, pill and popover
  alike. `apa-check.ts` says in as many words that the check "never
  blocks saving or export", and §5.0 reserves `--danger` for *broken
  or invalid* while *fix this, but you are not blocked* is `--warn`.
  The red pill was the drift, not the amber one.

Both chip rows now drive off `aria-pressed`. `EssayHome`'s filter row
moved from `class:active`, and `LibraryScreen`'s membership chips moved
from `class:on` — those are the app's genuine multi-select toggles and
they previously had a visual selected state with no ARIA state behind
it. `controls-v2.css` still accepts `.on` as an alias for anything not
yet migrated.

One known imperfection: `EssayHome`'s four filters are mutually
exclusive, so `role="radiogroup"` with `aria-checked` would model them
more exactly than four toggle buttons. `aria-pressed` announces the
state correctly and is a strict improvement on the class it replaced;
the radiogroup rewrite needs roving `tabindex` and is deferred.

### Deferred — shapes v2 defines but has not adopted

Recorded so they are not rediscovered. None was in the handoff's
migration map, and each needs a tone judgement rather than a rename:

| Site | Today | Should become |
|---|---|---|
| `EditorScreen.svelte` `.apa-pill-count` | static count drawn as a `--r-pill` with a solid `--danger` fill | `.badge.badge-count`. It also breaks §5.0's shape rule (a pill that cannot be pressed), and `--warn` fits an advisory check better than `--danger`. |
| `EditorScreen.svelte` `.apa-check-empty` | hand-rolled popover empty message | `.empty-state.is-inline` |
| `EssayHome.svelte` `.essay-actions button` / `.del` | borderless action row | `.btn-quiet` / `.btn-quiet.btn-danger-text` |
| `LibraryScreen.svelte` `.card-foot .del` | the same button, hand-rolled again | `.btn-quiet.btn-danger-text` |
| `BibImportModal.svelte` `.bibkey` | bare mono `<code>` beside two real badges | `.badge-code` |
| `EssayHome.svelte` `.lib-count` | live count reflecting the active filter | `.badge-count`, or `.badge-accent` per §5.0 |

Also deferred: the popover **beak** (see §5 Popover), and converging
`.status-panel`'s `data-tone` vocabulary onto §5.0's four names.

Also deferred, and older than v2: §5's `aria-disabled` rule has zero
call sites (`BibImportModal` blocks its primary with the real
`disabled` attribute); no `.empty-state` is announced through
`role="status"` when a filter empties a list; and `--focus-ring` is
1.45:1 against `--chrome`, short of the 3:1 WCAG 1.4.11 wants for a
focus indicator.

### Two things to watch

**Scope.** `.badge`, `.chip`, `.btn-quiet` and `.empty-state` are
global, like `.btn`. The APA paper sheet uses `cover-form-*` and the
editor dock uses `fm-*`, so neither is reachable.

A Svelte component's own `<style>` block outranks these rules **only on
the properties it declares** — everything else still cascades in. So a
local definition has to be **deleted**, not left unused.
`UpdatePill.svelte` is the case that proves it: its local `.badge` was
a 7px round dot, and the global `.badge`'s `padding: 0 var(--sp-15)`
cascaded through and stretched it into a 12px oval under
`box-sizing: border-box`. It is `.dot` now. **Before adding a class to
`controls-v2.css`, grep the whole app for that name.**

**Tone, not shape.** See §5.0. The class rename is mechanical; deciding
per badge whether it classifies or needs fixing is the point.

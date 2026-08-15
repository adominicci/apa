kother # Tesina — Design System v1 (chrome only)

The visual contract for Tesina's **application chrome**. Reference
implementation: `tesina-new-paper-modal.html` (light/dark toggle in the
titlebar).

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

The seam is `EditorScreen.svelte:983` — the `<Editor>` inside
`<main class="canvas">`. **Chrome outside it, document inside it.**
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
--warn-soft:    color-mix(in oklab, var(--warn), transparent 86%);
--focus-ring:   0 0 0 3px color-mix(in oklab, var(--accent), transparent 72%);
```

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

**The 4.57:1 is a deliberate, narrow pass — respect its two conditions:**

1. **`--accent-on` must stay pure white on light.** The earlier
   off-white `oklch(0.995 0.001 85)` drops it to ~4.55:1. Do not
   "soften" it.
2. **Never set text in `--accent` on a non-white surface.** On `--bg`
   it is 4.31:1 and fails. In this system `--accent` only ever appears
   as a *fill* (with `--accent-on` text), a focus ring, a selection
   tint, or a 1px focus border — the border needs 3:1 and clears it at
   4.31:1. If a future surface wants an accent-colored link, darken it
   to ~`oklch(0.50 0.199 262)` for that use and keep `#2f6feb` for
   fills.

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
--mono: ui-monospace,"SF Mono",Menlo,monospace;
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
in chrome are deleted. Weight `700+` is not used.

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

| File | Line | Element |
|---|---|---|
| `EssayHome.svelte` | 455 | sidebar logo `T` |
| `EssayHome.svelte` | 514 | titlebar mark `T` |
| `EssayHome.svelte` | 874 | `.thumb-text` — essay-card first-lines preview |
| `LibraryScreen.svelte` | 634 | logo `T` |
| `LibraryScreen.svelte` | 960 | `.pc-entry` — reference preview |
| `EditorScreen.svelte` | 1405 | logo `T` |
| `EditorScreen.svelte` | 1790 | `.rtxt` / `.ref-card :global(.rtxt)` |
| `EditorScreen.svelte` | 1923 | `.bb.it` — italic style button |
| `ReferencesPanel.svelte` | 213 | `.runs` — reference list entries |
| `RefEntry.svelte` | 27 | `.rtxt` — formatted APA reference |
| `CitationPopover.svelte` | 220 | `.item span` — citation preview |
| `HeadingMenu.svelte` | 113 | `.pv` — heading style previews |

Decided 2026-08-14: the interface is Inter everywhere, with no
exception for document previews. The consequence is deliberate — the
references panel now sets APA entries in Inter while the paper sets
them in Times. The panel is UI; the sheet is the document. They are not
supposed to match.

**Do NOT touch — this one is inside the frozen zone:**

| File | Line | Element |
|---|---|---|
| `CoverSheet.svelte` | 191 | `.cf` — `var(--doc-font, var(--serif))` |

`.cf` is the editable title-page field rendered **on the paper**, and
`--serif` is only its fallback when the user has not picked an APA
font. Switching it to Inter would put a sans title page on the sheet
and break the document. It is covered by the §0 boundary.

After this pass, `var(--serif)` survives only in `apa.css`,
`CoverSheet.svelte`, `nativeProof.css` and the font-picker stacks —
all document territory. **Chrome references it zero times**, which is
what §8's lint asserts.

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

--ctl-h:36px; --ctl-h-lg:42px;
```

`--z-*` replaces the ten ad-hoc z-index values currently scattered
from `2` to `200`.

Wrap all transitions and animations in a
`@media (prefers-reduced-motion: reduce)` override.

---

## 5. Component specs

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

| Variant | Rest | Hover | Disabled |
|---|---|---|---|
| `.btn-primary` | `--accent` / `--accent-on` | `--accent-hover` | `color-mix(--accent, --bg 58%)` / `--accent-on` |
| `.btn-ghost` | `--surface` / `--fg-2`, `--border` | `--hover`, `--fg`, `--fg-2` border | `opacity: .5` |

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

## 7. Known token bugs this system fixes

1. `--panel` is referenced at `routes/+page.svelte:303` and **defined
   nowhere** — it always resolves to the hardcoded cream `#f4f1ea` and
   ignores dark mode. Add `--panel: var(--chrome)` or drop the
   reference.
2. `LibraryScreen.svelte:1064` raw `#fff`; `:1068` raw `#000` inside a
   `color-mix`.
3. Stale `var(--x, #hex)` fallbacks that encode a second, wrong
   palette: `var(--muted, #666)`, `var(--danger, #a33)` in
   `BackupSettings`, `BackupSetupWizard`, `BackupStatusCard`,
   `LibraryImportModal`. Drop the fallback — `--panel` proves the
   assumption they protect has already failed once.

---

## 8. Enforcement

Add one focused Vitest check over chrome CSS only, excluding every
frozen path in §0:

- no raw hex outside the two theme blocks in `tokens.css` (allow the
  three `--tl-*` traffic-light dots);
- no `var(--token, <color>)` fallback form;
- no `font-size` literal outside the `--t-*` definitions;
- no `z-index` literal outside the `--z-*` definitions.

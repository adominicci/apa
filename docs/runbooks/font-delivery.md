# Font delivery runbook

This runbook describes the current font-delivery contract for Tesina's desktop
application and DOCX exports. It covers two independent systems: the Inter font
used by application chrome, and the user-selected APA document font.

## Application chrome: bundled Inter

Tesina's chrome uses the `--font` token from
`apps/desktop/src/lib/styles/tokens.css`. Inter is first in that stack, followed
by native system UI fallbacks.

The Inter variable font is delivered without a runtime request:

- `apps/desktop/static/fonts/inter-latin-variable.woff2` is the source font
  asset.
- `apps/desktop/src/app.html` contains a matching base64 `data:font/woff2`
  `@font-face` in the static document head. It covers normal style at weights
  100 through 900.
- The rule must stay in `app.html`. Moving it into Vite-processed CSS has caused
  WKWebView development reloads to drop the face or request a missing font URL.
- Production and development CSP both allow `data:` in `font-src`.
- `apps/desktop/src-tauri/resources/Inter-OFL-1.1.txt` is bundled through
  `bundle.resources` as `Inter-OFL-1.1.txt`. The distribution test pins its
  upstream copyright, license text, and checksum.

The static WOFF2 file and the inline payload are two copies of the same bytes;
changing one does not update the other automatically. After replacing the source
asset, regenerate the payload using the command documented beside the
`@font-face` in `app.html`, then verify the byte-for-byte match below. If the
upstream font or license changes, review and update the bundled OFL file and its
distribution test together rather than weakening the license assertion.

Inter is a chrome font only. Do not use `--font` for the essay sheet, preview,
or exported document.

## APA document fonts

`essay.settings.font` stores one of the seven `FontChoice` identifiers. The
desktop map in `apps/desktop/src/lib/model/fonts.ts` is the source of truth for
the editor, title-page font picker, and HTML/PDF preview. Each descriptor
defines the visible family name, CSS fallback stack, point size, and serif or
sans-serif grouping.

`EditorScreen.svelte` passes the selected stack and size to the editor through
`--doc-font` and `--doc-font-size`. `renderEssayHtml.ts` uses the same
descriptor for preview and printable HTML, including page-margin text. These
surfaces must stay aligned when a font changes.

The application does not bundle the seven document typefaces. CSS uses the
configured fallback stack when the selected family is unavailable on the host.
Therefore, selecting a family does not guarantee that the host has that exact
typeface installed.

| Setting                  | Screen/preview primary family                                                |  Size | DOCX typeface       |      DOCX size |
| ------------------------ | ---------------------------------------------------------------------------- | ----: | ------------------- | -------------: |
| `times-new-roman-12`     | Times New Roman                                                              | 12 pt | Times New Roman     | 24 half-points |
| `georgia-11`             | Georgia                                                                      | 11 pt | Georgia             | 22 half-points |
| `computer-modern-10`     | Computer Modern, via a stack beginning with Latin Modern Roman and CMU Serif | 10 pt | CMU Serif           | 20 half-points |
| `aptos-12`               | Aptos                                                                        | 12 pt | Aptos               | 24 half-points |
| `calibri-11`             | Calibri                                                                      | 11 pt | Calibri             | 22 half-points |
| `arial-11`               | Arial                                                                        | 11 pt | Arial               | 22 half-points |
| `lucida-sans-unicode-10` | Lucida Sans Unicode                                                          | 10 pt | Lucida Sans Unicode | 20 half-points |

Consult `APA_FONTS` for the complete ordered CSS stacks; the table intentionally
shows only the selected primary family except where the Computer Modern label
and installed font names differ.

## DOCX contract

`packages/docx-export` is a pure package and must not import desktop or Tauri
code. Its sanctioned contract in `src/input.ts` therefore repeats the
`FontChoice` union. `src/styles.ts` maintains the parallel `FONT_MAP` and turns
the selected value into the default and named paragraph-style run properties.
DOCX font sizes are expressed in half-points.

DOCX files name the selected typeface; they do not embed its font bytes. The
application's CSS fallback stack does not carry into DOCX, so the program that
opens the file decides how to substitute a missing typeface.

When adding, removing, or changing a document font, update all of these in one
commit:

1. `apps/desktop/src/lib/model/essay.ts` (`FontChoice`).
2. `apps/desktop/src/lib/model/fonts.ts` (`APA_FONTS`, `APA_FONT_ORDER`, and
   the `isFontChoice` persisted-data guard). App validators must reuse this
   guard rather than maintain separate font registries.
3. `packages/docx-export/src/input.ts` (the pure-package input union).
4. `packages/docx-export/src/styles.ts` (`FONT_MAP`, using half-points).
5. Focused app guard, editor/preview, and DOCX tests for the selected family
   and size.

Do not add a font file unless its license is compatible with the repository's
dependency policy and the required attribution or license resource is included.

## Validation

After changing the Inter asset or `app.html`, confirm that the inline payload
matches the source WOFF2:

```sh
python3 - <<'PY'
import base64
import pathlib
import re

source = pathlib.Path("apps/desktop/static/fonts/inter-latin-variable.woff2").read_bytes()
html = pathlib.Path("apps/desktop/src/app.html").read_text()
match = re.search(r'data:font/woff2;base64,([^\"]+)', html)
if match is None or base64.b64decode(match.group(1)) != source:
    raise SystemExit("app.html Inter payload does not match the source WOFF2")
print("Inter payload matches the source WOFF2")
PY
```

Run the focused contract tests from the repository root:

```sh
deno run -A npm:vitest run \
  apps/desktop/src/lib/distribution/interLicense.test.ts \
  apps/desktop/src/lib/editor/apaCss.test.ts \
  apps/desktop/src/lib/preview/renderEssayHtml.test.ts \
  packages/docx-export/test/export.test.ts
```

For a shared document-font contract change, also run the repository gates:

```sh
deno task check
deno task test
```

When the inline font, CSP, or bundle resource configuration changes, add a
development smoke with `deno task dev` and a packaged application smoke. Verify
that chrome renders in Inter, the selected document font and size agree between
the editor and preview, and the packaged application includes
`Inter-OFL-1.1.txt`. Follow the repository process-safety rules for the
development process, and do not treat a successful fallback face as proof that
Inter or the selected document typeface loaded.

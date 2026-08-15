import { describe, expect, it } from "vitest";

// Same loader as apaCss.test.ts: a `?raw` import of tokens.css resolves to an
// empty string here, because the file is also pulled in as a global stylesheet.
declare const Deno: {
  readTextFileSync(path: URL): string;
};

const read = (path: string) =>
  Deno.readTextFileSync(new URL(path, import.meta.url));

const tokensCss = read("./tokens.css");
const apaCss = read("../editor/apa.css");
const coverSheetSource = read("../components/CoverSheet.svelte");

/**
 * The design system is chrome only. The frozen paper path, however, paints
 * itself from the same shared tokens, so retuning the chrome palette silently
 * restyled the document on screen — body text moved from #111111 to #1c1e23 —
 * without any golden noticing, because export hardcodes its own ink.
 *
 * tokens.css therefore pins the pre-v1 palette on `.apa-editor`. These tests
 * hold that contract: every colour token the document consumes has to be
 * pinned, at its historical value.
 */

/** Tokens the document consumes that are not colours and need no pinning. */
const NON_COLOUR = new Set([
  "--doc-font",
  "--doc-font-size",
  "--body-title",
  "--font",
  "--serif",
  "--mono",
  "--fast",
  "--ease",
  "--r-sm",
  "--r-md",
  "--paper-print",
  "--pagination-overflow-columns",
  "--pagination-overflow-max-height",
  "--pagination-overflow-span",
]);

const LEGACY_LIGHT: Record<string, string> = {
  "--fg": "#111111",
  "--fg-2": "#33373e",
  "--muted": "#6b6b6b",
  "--border": "#e5e5e5",
  "--border-soft": "#eeeeee",
  "--surface": "#ffffff",
  "--paper": "#ffffff",
  "--accent": "#2f6feb",
  "--warn": "#eab308",
  "--danger": "#dc2626",
};

const LEGACY_DARK: Record<string, string> = {
  "--fg": "#e9ecf1",
  "--fg-2": "#c3c9d2",
  "--muted": "#8b93a1",
  "--border": "#272d36",
  "--border-soft": "#1e242c",
  "--surface": "#171b21",
  "--paper": "#1b2027",
  "--accent": "#5b8def",
  "--warn": "#eab308",
  "--danger": "#f0555b",
};

function block(selector: string): string {
  const start = tokensCss.indexOf(`${selector} {`);
  expect(start, `${selector} block is missing from tokens.css`).toBeGreaterThan(
    -1,
  );
  return tokensCss.slice(start, tokensCss.indexOf("}", start));
}

function declaredTokens(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]),
  );
}

describe("document palette", () => {
  const lightBlock = block(".apa-editor");
  const darkBlock = block(':root[data-theme="dark"] .apa-editor');

  it("pins every colour token the frozen document paths consume", () => {
    const consumed = new Set(
      [...`${apaCss}\n${coverSheetSource}`.matchAll(/var\((--[a-z0-9-]+)/g)]
        .map((m) => m[1])
        .filter((token) => !NON_COLOUR.has(token)),
    );
    // Guard the guard: if this ever reads empty the assertions below are vacuous.
    expect(consumed.size).toBeGreaterThan(5);

    const pinned = declaredTokens(lightBlock);
    const missing = [...consumed].filter((token) => !pinned.has(token));
    expect(missing, "not pinned on .apa-editor").toEqual([]);
  });

  it.each(Object.entries(LEGACY_LIGHT))(
    "keeps %s at its pre-v1 light value",
    (token, value) => {
      expect(lightBlock).toContain(`${token}: ${value};`);
    },
  );

  it.each(Object.entries(LEGACY_DARK))(
    "keeps %s at its pre-v1 dark value",
    (token, value) => {
      expect(darkBlock).toContain(`${token}: ${value};`);
    },
  );

  it("restates the derived tokens instead of inheriting the chrome ones", () => {
    // A custom property substitutes var() where it is DECLARED, so :root's
    // --hover would keep resolving against the chrome --fg.
    for (const token of ["--hover", "--accent-soft", "--warn-strong"]) {
      expect(lightBlock).toContain(`${token}:`);
    }
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type DocLocale,
  formatReferenceEntry,
  type Reference,
  runsToMarkup,
} from "../src/index.ts";

interface Fixture {
  name: string;
  ref: Reference;
  expected: string;
}

function loadFixtures(locale: DocLocale): Fixture[] {
  const path = join(import.meta.dirname!, "fixtures", locale, "entries.json");
  return JSON.parse(readFileSync(path, "utf-8")) as Fixture[];
}

for (const locale of ["en", "es"] as const) {
  describe(`golden reference entries (${locale})`, () => {
    for (const fixture of loadFixtures(locale)) {
      it(fixture.name, () => {
        const runs = formatReferenceEntry(fixture.ref, locale);
        expect(runsToMarkup(runs)).toBe(fixture.expected);
      });
    }
  });
}

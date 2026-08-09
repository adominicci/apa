import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = await readFile(
  resolve(import.meta.dirname!, "nativeProof.ts"),
  "utf8",
);
const start = source.indexOf("const referenceRefresh =");
const end = source.indexOf("const referenceEntriesAfter", start);
const operation = source.slice(start, end);

describe("native reference refresh evidence", () => {
  it("uses the production remeasure path and observes the rendered entries", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(operation).toContain("referenceEnv.references = fixture.references");
    expect(operation).toContain("refreshReferenceDecoration(editor)");
    expect(operation).not.toContain("repaintReferenceDecoration(editor)");
    expect(operation).not.toContain(
      'invalidatePagination(editor, "references")',
    );
    expect(operation).toContain(
      'mount.querySelectorAll(".ref-entry").length > referenceEntriesBefore',
    );
  });
});

import { describe, expect, it } from "vitest";
import type { Reference } from "@tesina/engine";
import { missingCitedRefs } from "./reconcile.ts";

function ref(id: string): Reference {
  return {
    id,
    type: "book",
    authors: [{ kind: "person", family: "Autor", given: "A." }],
    date: { year: 2020 },
    title: `Obra ${id}`,
  };
}

function docCiting(...refIds: string[]): unknown {
  return {
    type: "doc",
    content: [
      {
        type: "sectionBody",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "citation",
                attrs: {
                  items: refIds.map((refId) => ({ refId })),
                  mode: "parenthetical",
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("missingCitedRefs", () => {
  it("restores a snapshot ref that is cited but absent from the library", () => {
    const result = missingCitedRefs(
      docCiting("r1"),
      [ref("r1")],
      new Set(),
    );
    expect(result.map((r) => r.id)).toEqual(["r1"]);
  });

  it("ignores refs already present in the library (no duplicates)", () => {
    const result = missingCitedRefs(
      docCiting("r1"),
      [ref("r1")],
      new Set(["r1"]),
    );
    expect(result).toEqual([]);
  });

  it("ignores snapshot refs that are not cited in the document", () => {
    const result = missingCitedRefs(
      docCiting("r1"),
      [ref("r1"), ref("r2")],
      new Set(),
    );
    expect(result.map((r) => r.id)).toEqual(["r1"]);
  });

  it("does not emit the same id twice even if the snapshot repeats it", () => {
    const result = missingCitedRefs(
      docCiting("r1"),
      [ref("r1"), ref("r1")],
      new Set(),
    );
    expect(result.map((r) => r.id)).toEqual(["r1"]);
  });

  it("returns [] for a malformed document", () => {
    expect(missingCitedRefs(null, [ref("r1")], new Set())).toEqual([]);
    expect(missingCitedRefs("nope", [ref("r1")], new Set())).toEqual([]);
  });

  it("returns [] when the snapshot is missing (pre-snapshot essays)", () => {
    expect(missingCitedRefs(docCiting("r1"), undefined, new Set())).toEqual([]);
  });

  it("skips corrupt snapshot entries instead of crashing", () => {
    const snapshot = [null, "nope", { id: 5 }, ref("r1")];
    const result = missingCitedRefs(docCiting("r1"), snapshot, new Set());
    expect(result.map((r) => r.id)).toEqual(["r1"]);
  });
});

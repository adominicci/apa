import { describe, expect, it } from "vitest";
import {
  addAllToCollection,
  createCollection,
  deleteCollection,
  pruneRefId,
  type RefCollection,
  renameCollection,
  toggleMembership,
} from "./collections.ts";

function base(): RefCollection[] {
  return [
    { id: "c1", name: "Metodología", refIds: ["r1", "r2"] },
    { id: "c2", name: "Teoría", refIds: ["r2"] },
  ];
}

describe("createCollection", () => {
  it("appends a trimmed, empty collection with the given id", () => {
    const next = createCollection([], "  Nueva  ", "c9");
    expect(next).toEqual([{ id: "c9", name: "Nueva", refIds: [] }]);
  });

  it("does not mutate the input array", () => {
    const input: RefCollection[] = [];
    createCollection(input, "X", "c9");
    expect(input).toEqual([]);
  });
});

describe("renameCollection", () => {
  it("renames only the target and trims", () => {
    const next = renameCollection(base(), "c1", "  Métodos ");
    expect(next[0].name).toBe("Métodos");
    expect(next[1].name).toBe("Teoría");
  });
});

describe("deleteCollection", () => {
  it("removes the collection without touching any references", () => {
    const next = deleteCollection(base(), "c1");
    expect(next.map((c) => c.id)).toEqual(["c2"]);
    // References themselves are external; nothing here should imply deletion.
    expect(next[0].refIds).toEqual(["r2"]);
  });
});

describe("toggleMembership", () => {
  it("adds a reference when absent", () => {
    const next = toggleMembership(base(), "c2", "r1");
    expect(next[1].refIds).toEqual(["r2", "r1"]);
  });

  it("removes a reference when present", () => {
    const next = toggleMembership(base(), "c1", "r1");
    expect(next[0].refIds).toEqual(["r2"]);
  });

  it("only affects the named collection", () => {
    const next = toggleMembership(base(), "c1", "r1");
    expect(next[1].refIds).toEqual(["r2"]);
  });
});

describe("pruneRefId", () => {
  it("removes the id from every collection that had it", () => {
    const next = pruneRefId(base(), "r2");
    expect(next[0].refIds).toEqual(["r1"]);
    expect(next[1].refIds).toEqual([]);
  });

  it("leaves collections without the id unchanged", () => {
    const next = pruneRefId(base(), "missing");
    expect(next).toEqual(base());
  });
});

describe("addAllToCollection", () => {
  it("appends only the ids not already present, in order", () => {
    const next = addAllToCollection(base(), "c1", ["r2", "r3", "r4"]);
    expect(next[0].refIds).toEqual(["r1", "r2", "r3", "r4"]);
  });

  it("only touches the named collection", () => {
    const next = addAllToCollection(base(), "c1", ["r9"]);
    expect(next[1].refIds).toEqual(["r2"]);
  });

  it("returns the same collection object when nothing is added", () => {
    const input = base();
    const next = addAllToCollection(input, "c2", ["r2"]);
    expect(next[1]).toBe(input[1]);
  });
});

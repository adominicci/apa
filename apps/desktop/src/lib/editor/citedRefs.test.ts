import { describe, expect, it } from "vitest";
import { collectCitedRefIds } from "./citedRefs.ts";

describe("collectCitedRefIds", () => {
  it("counts citation items across nested sections", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "sectionBody",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Hola " },
                {
                  type: "citation",
                  attrs: {
                    items: [{ refId: "a" }, { refId: "b" }],
                    mode: "parenthetical",
                  },
                },
              ],
            },
            {
              type: "paragraph",
              content: [
                {
                  type: "citation",
                  attrs: { items: [{ refId: "a" }], mode: "narrative" },
                },
              ],
            },
          ],
        },
      ],
    };
    const counts = collectCitedRefIds(doc);
    expect(counts.get("a")).toBe(2);
    expect(counts.get("b")).toBe(1);
    expect(counts.size).toBe(2);
  });

  it("returns an empty map for docs without citations or garbage", () => {
    expect(collectCitedRefIds({ type: "doc", content: [] }).size).toBe(0);
    expect(collectCitedRefIds(null).size).toBe(0);
    expect(collectCitedRefIds("nada").size).toBe(0);
  });
});

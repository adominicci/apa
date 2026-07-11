import { describe, expect, it } from "vitest";
import { defaultDoc, ensureSectionedDoc } from "./migrate.ts";

describe("ensureSectionedDoc", () => {
  it("wraps legacy flat docs in a sectionBody", () => {
    const legacy = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hola" }] },
        { type: "heading", attrs: { level: 2 } },
      ],
    };
    expect(ensureSectionedDoc(legacy)).toEqual({
      type: "doc",
      content: [{ type: "sectionBody", content: legacy.content }],
    });
  });

  it("returns sectioned docs untouched", () => {
    const sectioned = {
      type: "doc",
      content: [
        { type: "sectionAbstract", content: [{ type: "paragraph" }] },
        { type: "sectionBody", content: [{ type: "paragraph" }] },
      ],
    };
    expect(ensureSectionedDoc(sectioned)).toBe(sectioned);
  });

  it("falls back to the default doc on garbage input", () => {
    expect(ensureSectionedDoc(null)).toEqual(defaultDoc());
    expect(ensureSectionedDoc("texto")).toEqual(defaultDoc());
    expect(ensureSectionedDoc({ type: "doc", content: [] })).toEqual(
      defaultDoc(),
    );
    expect(ensureSectionedDoc({ type: "paragraph" })).toEqual(defaultDoc());
  });
});

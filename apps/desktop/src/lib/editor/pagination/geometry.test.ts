import { describe, expect, it } from "vitest";
import { canonicalPageGeometry, visualPageGap } from "./geometry.ts";

describe("canonical pagination geometry", () => {
  it("keeps Letter measurements in the fixed CSS-pixel coordinate system", () => {
    expect(canonicalPageGeometry).toMatchObject({
      width: 816,
      height: 1056,
      margin: 96,
      textWidth: 624,
      printableHeight: 864,
    });
  });

  it("keeps the inter-page gap visual-only", () => {
    expect(visualPageGap).toBe(28);
    expect(canonicalPageGeometry.printableHeight).toBe(864);
    expect(canonicalPageGeometry.height - canonicalPageGeometry.margin * 2)
      .toBe(864);
  });
});

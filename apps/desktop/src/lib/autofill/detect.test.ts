import { describe, expect, it } from "vitest";
import { detectInput } from "./detect.ts";

describe("detectInput", () => {
  it("detects bare DOIs and strips trailing punctuation", () => {
    expect(detectInput("10.1234/rei.2020.045.")).toEqual({
      kind: "doi",
      value: "10.1234/rei.2020.045",
    });
  });

  it("extracts DOIs from doi.org URLs", () => {
    expect(detectInput("https://doi.org/10.5555/de.e0450")).toEqual({
      kind: "doi",
      value: "10.5555/de.e0450",
    });
  });

  it("detects ISBN-13 with hyphens when the checksum is valid", () => {
    expect(detectInput("978-84-9801-234-7")).toEqual({
      kind: "isbn",
      value: "9788498012347",
    });
  });

  it("detects ISBN-10 including X check digits", () => {
    expect(detectInput("0 19 852663 6")).toEqual({
      kind: "isbn",
      value: "0198526636",
    });
  });

  it("rejects ISBN-like numbers with a bad checksum", () => {
    expect(detectInput("9788498012348").kind).toBe("unknown");
  });

  it("detects plain URLs", () => {
    expect(detectInput("https://example.org/articulo")).toEqual({
      kind: "url",
      value: "https://example.org/articulo",
    });
  });

  it("classifies anything else as unknown", () => {
    expect(detectInput("solo un título cualquiera").kind).toBe("unknown");
    expect(detectInput("   ").kind).toBe("unknown");
  });
});

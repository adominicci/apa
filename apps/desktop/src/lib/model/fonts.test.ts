import { describe, expect, it } from "vitest";
import { isFontChoice } from "./fonts.ts";

describe("isFontChoice", () => {
  it("accepts every APA font choice and rejects unsupported values", () => {
    expect([
      "times-new-roman-12",
      "georgia-11",
      "computer-modern-10",
      "aptos-12",
      "calibri-11",
      "arial-11",
      "lucida-sans-unicode-10",
      "papyrus-12",
      "",
      null,
      12,
    ].map(isFontChoice)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });
});

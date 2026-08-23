import { describe, expect, it } from "vitest";
import { paragraphs, sentences, tokens } from "./segmentation.ts";

describe("coach segmentation", () => {
  it("retains original UTF-16 ranges through locale-aware normalization", () => {
    expect(tokens("😀 İ Ñandú nandu", "en")).toEqual([
      { text: "İ", normalized: "i̇", from: 3, to: 4 },
      { text: "Ñandú", normalized: "ñandú", from: 5, to: 10 },
      { text: "nandu", normalized: "nandu", from: 11, to: 16 },
    ]);
  });

  it("does not erase Spanish diacritics or ñ", () => {
    expect(
      tokens("AÑO año ano acción accion", "es").map((token) =>
        token.normalized
      ),
    )
      .toEqual(["año", "año", "ano", "acción", "accion"]);
  });

  it("maps sentences and paragraphs without shifting UTF-16 offsets", () => {
    const text = "😀 Uno termina. Dos sigue.\n\nTres vuelve.";
    expect(
      sentences(text).map(({ from, to }) => [from, to, text.slice(from, to)]),
    )
      .toEqual([
        [0, 15, "😀 Uno termina."],
        [16, 26, "Dos sigue."],
        [28, 40, "Tres vuelve."],
      ]);
    expect(paragraphs(text).map(({ from, to }) => [from, to]))
      .toEqual([[0, 26], [28, 40]]);
  });

  it("classifies the exact eight-token fragment boundary", () => {
    expect(tokens("one two three four five six seven", "en")).toHaveLength(7);
    expect(tokens("one two three four five six seven eight", "en"))
      .toHaveLength(8);
  });
});

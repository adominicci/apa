import { describe, expect, it } from "vitest";
import {
  mergeRuns,
  plainText,
  type RichRun,
  runsFromMarkup,
  runsToMarkup,
} from "../src/index.ts";

describe("runsFromMarkup", () => {
  it("parses plain text into a single run", () => {
    expect(runsFromMarkup("García, J. (2020). Un artículo.")).toEqual<
      RichRun[]
    >([{ text: "García, J. (2020). Un artículo." }]);
  });

  it("parses italic spans delimited by asterisks", () => {
    expect(
      runsFromMarkup("García, J. (2020). *El gran libro*. Planeta."),
    ).toEqual<RichRun[]>([
      { text: "García, J. (2020). " },
      { text: "El gran libro", italic: true },
      { text: ". Planeta." },
    ]);
  });

  it("handles markup that starts and ends with italics", () => {
    expect(runsFromMarkup("*Psicología hoy*, 12(3)")).toEqual<RichRun[]>([
      { text: "Psicología hoy", italic: true },
      { text: ", 12(3)" },
    ]);
  });

  it("round-trips through runsToMarkup", () => {
    const markup = "Autor, A. (s. f.). *Título en cursiva*, 8(2), 1–10.";
    expect(runsToMarkup(runsFromMarkup(markup))).toBe(markup);
  });
});

describe("mergeRuns", () => {
  it("merges adjacent runs with identical formatting and drops empties", () => {
    expect(
      mergeRuns([
        { text: "a" },
        { text: "" },
        { text: "b" },
        { text: "c", italic: true },
        { text: "d", italic: true },
      ]),
    ).toEqual<RichRun[]>([
      { text: "ab" },
      { text: "cd", italic: true },
    ]);
  });

  it("does not mutate its input", () => {
    const input: RichRun[] = [{ text: "a" }, { text: "b" }];
    mergeRuns(input);
    expect(input).toEqual([{ text: "a" }, { text: "b" }]);
  });
});

describe("plainText", () => {
  it("flattens runs to their text", () => {
    expect(
      plainText([{ text: "El " }, { text: "título", italic: true }]),
    ).toBe("El título");
  });
});

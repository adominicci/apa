import { describe, expect, it } from "vitest";
import { citationYear, dateSortKey, referenceDate } from "../src/dates.ts";
import { en } from "../src/locale/en.ts";
import { es } from "../src/locale/es.ts";

describe("referenceDate", () => {
  it("renders a bare year", () => {
    expect(referenceDate({ year: 2020 }, en)).toBe("2020");
  });

  it("renders year and month", () => {
    expect(referenceDate({ year: 2020, month: 5 }, en)).toBe("2020, May");
    expect(referenceDate({ year: 2020, month: 5 }, es)).toBe("2020, mayo");
  });

  it("renders full dates per locale", () => {
    expect(referenceDate({ year: 2021, month: 7, day: 3 }, en)).toBe(
      "2021, July 3",
    );
    expect(referenceDate({ year: 2021, month: 7, day: 3 }, es)).toBe(
      "2021, 3 de julio",
    );
  });

  it("renders undated works per locale", () => {
    expect(referenceDate({ noDate: true }, en)).toBe("n.d.");
    expect(referenceDate({ noDate: true }, es)).toBe("s. f.");
  });

  it("treats a missing year as undated", () => {
    expect(referenceDate({}, es)).toBe("s. f.");
  });

  it("renders in-press works per locale and over other fields", () => {
    expect(referenceDate({ year: 2020, inPress: true }, en)).toBe("in press");
    expect(referenceDate({ inPress: true }, es)).toBe("en prensa");
  });
});

describe("citationYear", () => {
  it("renders the year with an optional disambiguation suffix", () => {
    expect(citationYear({ year: 2020 }, en)).toBe("2020");
    expect(citationYear({ year: 2020 }, en, "b")).toBe("2020b");
  });

  it("hyphenates suffixes on undated works", () => {
    expect(citationYear({ noDate: true }, en, "a")).toBe("n.d.-a");
    expect(citationYear({ noDate: true }, es, "a")).toBe("s. f.-a");
  });
});

describe("dateSortKey", () => {
  it("orders undated before years before in-press", () => {
    const undated = dateSortKey({ noDate: true });
    const early = dateSortKey({ year: 1999 });
    const late = dateSortKey({ year: 2024 });
    const inPress = dateSortKey({ inPress: true });
    expect(undated).toBeLessThan(early);
    expect(early).toBeLessThan(late);
    expect(late).toBeLessThan(inPress);
  });
});

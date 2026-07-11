import { describe, expect, it } from "vitest";
import {
  contributorFromDisplayName,
  mapOpenLibraryBook,
} from "./openlibrary.ts";

describe("contributorFromDisplayName", () => {
  it("splits display names into given and family", () => {
    expect(contributorFromDisplayName("Nora Salgado")).toEqual({
      kind: "person",
      family: "Salgado",
      given: "Nora",
    });
    expect(contributorFromDisplayName("Ana María Ruiz")).toEqual({
      kind: "person",
      family: "Ruiz",
      given: "Ana María",
    });
  });

  it("keeps single-word names as family only", () => {
    expect(contributorFromDisplayName("Colectivo")).toEqual({
      kind: "person",
      family: "Colectivo",
    });
  });
});

describe("mapOpenLibraryBook", () => {
  it("maps title, publisher, year, and authors", () => {
    const book = mapOpenLibraryBook(
      {
        title: "Fundamentos de la escritura académica",
        publishers: ["Ediciones Cardenal"],
        publish_date: "May 3, 2017",
      },
      ["Elena Padilla"],
      "ref-9",
    );
    expect(book).toEqual({
      id: "ref-9",
      type: "book",
      authors: [{ kind: "person", family: "Padilla", given: "Elena" }],
      date: { year: 2017 },
      title: "Fundamentos de la escritura académica",
      publisher: "Ediciones Cardenal",
    });
  });

  it("handles missing dates and titles", () => {
    expect(
      mapOpenLibraryBook({ title: "Sin fecha" }, [], "x")?.date,
    ).toEqual({ noDate: true });
    expect(mapOpenLibraryBook({}, [], "x")).toBeNull();
  });
});

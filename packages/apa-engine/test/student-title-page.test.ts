import { describe, expect, it } from "vitest";
import { buildStudentTitlePage } from "../src/index.ts";

const completeInput = {
  locale: "en" as const,
  title: "Reading Habits",
  authors: ["Ana Ruiz", "Jordan Lee"],
  affiliations: ["University of Puerto Rico"],
  course: "EDU 301: Foundations of Education",
  instructor: "Dr. Rivera",
  dueDate: "2026-08-07",
};

describe("buildStudentTitlePage", () => {
  it("maps one author and one affiliation without affiliation numbers", () => {
    const result = buildStudentTitlePage({
      ...completeInput,
      authors: ["Ana Ruiz"],
    });

    expect(result).toEqual({
      issues: [],
      byline: {
        authors: [{ name: "Ana Ruiz", affiliationNumbers: [] }],
        affiliations: [{ name: "University of Puerto Rico" }],
        authorLine: [{ kind: "text", text: "Ana Ruiz" }],
      },
    });
  });

  it("maps multiple authors sharing one affiliation without affiliation numbers", () => {
    const result = buildStudentTitlePage(completeInput);

    expect(result.issues).toEqual([]);
    expect(result.byline.authors).toEqual([
      { name: "Ana Ruiz", affiliationNumbers: [] },
      { name: "Jordan Lee", affiliationNumbers: [] },
    ]);
    expect(result.byline.affiliations).toEqual([
      { name: "University of Puerto Rico" },
    ]);
  });

  it("numbers one affiliation per author after deduplicating affiliation names", () => {
    const result = buildStudentTitlePage({
      ...completeInput,
      authors: ["Ana Ruiz", "Jordan Lee", "Lucía Pérez"],
      affiliations: [
        "University of Puerto Rico",
        "Caribbean College",
        "University of Puerto Rico",
      ],
    });

    expect(result.issues).toEqual([]);
    expect(result.byline.authors).toEqual([
      { name: "Ana Ruiz", affiliationNumbers: [1] },
      { name: "Jordan Lee", affiliationNumbers: [2] },
      { name: "Lucía Pérez", affiliationNumbers: [1] },
    ]);
    expect(result.byline.affiliations).toEqual([
      { number: 1, name: "University of Puerto Rico" },
      { number: 2, name: "Caribbean College" },
    ]);
    expect(result.byline.authorLine).toEqual([
      { kind: "text", text: "Ana Ruiz" },
      { kind: "superscript", text: "1" },
      { kind: "text", text: ", " },
      { kind: "text", text: "Jordan Lee" },
      { kind: "superscript", text: "2" },
      { kind: "text", text: ", and " },
      { kind: "text", text: "Lucía Pérez" },
      { kind: "superscript", text: "1" },
    ]);
  });

  it("uses locale-aware conjunction tokens in English and Spanish", () => {
    const english = buildStudentTitlePage(completeInput);
    const spanish = buildStudentTitlePage({ ...completeInput, locale: "es" });

    expect(english.byline.authorLine).toEqual([
      { kind: "text", text: "Ana Ruiz" },
      { kind: "text", text: " and " },
      { kind: "text", text: "Jordan Lee" },
    ]);
    expect(spanish.byline.authorLine).toEqual([
      { kind: "text", text: "Ana Ruiz" },
      { kind: "text", text: " y " },
      { kind: "text", text: "Jordan Lee" },
    ]);
  });

  it("reports every missing required title-page field", () => {
    const result = buildStudentTitlePage({
      ...completeInput,
      title: "",
      authors: [],
      affiliations: [],
      course: "",
      instructor: "",
      dueDate: "",
    });

    expect(result.issues).toEqual([
      "missingTitle",
      "missingAuthors",
      "missingAffiliations",
      "missingCourse",
      "missingInstructor",
      "missingDueDate",
    ]);
  });

  it.each([
    "",
    "EDU 301",
    ": Foundations of Education",
    "EDU 301:",
    "   :   ",
  ])("requires both course number and name in %j", (course) => {
    expect(buildStudentTitlePage({ ...completeInput, course }).issues)
      .toContain(
        "missingCourse",
      );
  });

  it.each([
    "EDU 301: Foundations of Education",
    "EDU 301 : Foundations of Education",
    "EDU 301: Foundations: Theory and Practice",
  ])("accepts a complete course number and name in %j", (course) => {
    expect(buildStudentTitlePage({ ...completeInput, course }).issues).not
      .toContain("missingCourse");
  });

  it("reports ambiguous affiliations when their count matches neither supported mapping", () => {
    const result = buildStudentTitlePage({
      ...completeInput,
      affiliations: [
        "University of Puerto Rico",
        "Caribbean College",
        "Island Institute",
      ],
    });

    expect(result.issues).toEqual(["ambiguousAffiliations"]);
  });
});

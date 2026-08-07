import { describe, expect, it } from "vitest";
import type { StudentTitlePageIssue } from "@tesina/engine";
import type { TitlePage } from "$lib/model/essay";
import {
  firstStudentTitlePageBlockingIssue,
  runStudentTitlePageValidatedExport,
  studentTitlePageMessageKey,
} from "$lib/model/titlePageValidation";

const completeTitlePage: TitlePage = {
  title: "Reading Habits",
  authors: ["Ana Ruiz"],
  affiliations: ["University of Puerto Rico"],
  course: "EDU 301",
  instructor: "Dr. Rivera",
  dueDate: "2026-08-07",
};

describe("student title-page validation adapter", () => {
  it.each<[StudentTitlePageIssue, string]>([
    ["missingTitle", "titlepage_error_missing_title"],
    ["missingAuthors", "titlepage_error_missing_authors"],
    ["missingAffiliations", "titlepage_error_missing_affiliations"],
    ["missingCourse", "titlepage_error_missing_course"],
    ["missingInstructor", "titlepage_error_missing_instructor"],
    ["missingDueDate", "titlepage_error_missing_due_date"],
    [
      "ambiguousAffiliations",
      "titlepage_error_ambiguous_affiliations",
    ],
  ])("maps %s to %s", (issue, expectedKey) => {
    expect(studentTitlePageMessageKey(issue)).toBe(expectedKey);
  });

  it("returns the first engine issue in deterministic title-page order", () => {
    expect(
      firstStudentTitlePageBlockingIssue(
        {
          title: "",
          authors: [],
          affiliations: [],
        },
        "en",
      ),
    ).toEqual({
      issue: "missingTitle",
      messageKey: "titlepage_error_missing_title",
    });
  });

  it("blocks before invoking the export side effect", async () => {
    let exportCalls = 0;

    const result = await runStudentTitlePageValidatedExport(
      {
        ...completeTitlePage,
        authors: [],
      },
      "en",
      () => {
        exportCalls += 1;
        return Promise.resolve("saved");
      },
    );

    expect(result).toEqual({
      status: "blocked",
      issue: "missingAuthors",
      messageKey: "titlepage_error_missing_authors",
    });
    expect(exportCalls).toBe(0);
  });

  it("invokes a valid export once and returns its outcome", async () => {
    let exportCalls = 0;

    const result = await runStudentTitlePageValidatedExport(
      completeTitlePage,
      "es",
      () => {
        exportCalls += 1;
        return Promise.resolve({
          status: "saved" as const,
          path: "/tmp/paper.docx",
        });
      },
    );

    expect(result).toEqual({
      status: "exported",
      outcome: { status: "saved", path: "/tmp/paper.docx" },
    });
    expect(exportCalls).toBe(1);
  });
});

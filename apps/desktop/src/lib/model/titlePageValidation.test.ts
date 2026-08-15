import { describe, expect, it } from "vitest";
import type { Reference, StudentTitlePageIssue } from "@tesina/engine";
import type { Essay, TitlePage } from "$lib/model/essay";
import {
  createStudentExportSnapshot,
  studentTitlePageMessageKey,
  studentTitlePageWarnings,
} from "$lib/model/titlePageValidation";

const completeTitlePage: TitlePage = {
  title: "Reading Habits",
  authors: ["Ana Ruiz"],
  affiliations: ["University of Puerto Rico"],
  course: "EDU 301: Foundations of Education",
  instructor: "Dr. Rivera",
  dueDate: "2026-08-07",
};

const reference: Reference = {
  id: "ref-1",
  type: "website",
  authors: [{ kind: "person", family: "Ruiz", given: "Ana" }],
  date: { year: 2026 },
  title: "Reading practices",
  siteName: "Learning Lab",
  url: "https://example.test/reading",
};

function completeEssay(): Essay {
  return {
    schemaVersion: 2,
    id: "essay-1",
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:00.000Z",
    settings: {
      documentLanguage: "en",
      variant: "professional",
      font: "times-new-roman-12",
      paperSize: "us-letter",
      runningHead: "READING",
      includeUncitedReferences: false,
    },
    titlePage: {
      ...completeTitlePage,
      authors: [...completeTitlePage.authors],
      affiliations: [...completeTitlePage.affiliations],
    },
    content: { type: "doc", content: [] },
    referencesSnapshot: [reference],
  };
}

describe("student title-page validation adapter", () => {
  it.each<[StudentTitlePageIssue, string]>([
    ["missingTitle", "titlepage_warn_missing_title"],
    ["missingAuthors", "titlepage_warn_missing_authors"],
    ["missingAffiliations", "titlepage_warn_missing_affiliations"],
    ["missingCourse", "titlepage_warn_missing_course"],
    ["missingInstructor", "titlepage_warn_missing_instructor"],
    ["missingDueDate", "titlepage_warn_missing_due_date"],
    [
      "ambiguousAffiliations",
      "titlepage_warn_ambiguous_affiliations",
    ],
  ])("maps %s to %s", (issue, expectedKey) => {
    expect(studentTitlePageMessageKey(issue)).toBe(expectedKey);
  });

  it("reports every shortfall in deterministic title-page order", () => {
    expect(
      studentTitlePageWarnings(
        {
          title: "",
          authors: [],
          affiliations: [],
        },
        "en",
      ),
    ).toEqual([
      { issue: "missingTitle", messageKey: "titlepage_warn_missing_title" },
      { issue: "missingAuthors", messageKey: "titlepage_warn_missing_authors" },
      {
        issue: "missingAffiliations",
        messageKey: "titlepage_warn_missing_affiliations",
      },
      { issue: "missingCourse", messageKey: "titlepage_warn_missing_course" },
      {
        issue: "missingInstructor",
        messageKey: "titlepage_warn_missing_instructor",
      },
      {
        issue: "missingDueDate",
        messageKey: "titlepage_warn_missing_due_date",
      },
    ]);
  });

  it("reports a complete title page as free of shortfalls", () => {
    expect(studentTitlePageWarnings(completeTitlePage, "es")).toEqual([]);
  });

  it.each(["", "EDU 301"])(
    "reports incomplete course information %j",
    (course) => {
      const titlePage: TitlePage = { ...completeTitlePage, course };

      expect(studentTitlePageWarnings(titlePage, "en")).toEqual([
        { issue: "missingCourse", messageKey: "titlepage_warn_missing_course" },
      ]);
    },
  );

  it("detaches the export snapshot from later edits to its sources", () => {
    const essay = completeEssay();
    const document = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "Before" }],
      }],
    };
    const references = [{ ...reference }];
    const snapshot = createStudentExportSnapshot(
      essay,
      document,
      references,
      "es",
    );

    essay.titlePage.title = "";
    essay.titlePage.authors[0] = "Changed author";
    essay.settings.documentLanguage = "en";
    document.content[0]!.content[0]!.text = "After";
    references[0]!.title = "Changed reference";

    expect(snapshot.essay.titlePage.title).toBe("Reading Habits");
    expect(snapshot.essay.titlePage.authors).toEqual(["Ana Ruiz"]);
    expect(snapshot.essay.settings).toMatchObject({
      documentLanguage: "es",
      variant: "student",
    });
    expect(snapshot.document).toEqual({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "Before" }],
      }],
    });
    expect(snapshot.essay.content).toBe(snapshot.document);
    expect(snapshot.references[0]!.title).toBe("Reading practices");
  });
});

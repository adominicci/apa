import { describe, expect, it } from "vitest";
import type { Reference, StudentTitlePageIssue } from "@tesina/engine";
import type { Essay, TitlePage } from "$lib/model/essay";
import {
  createStudentExportSnapshot,
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
    const essay = completeEssay();
    essay.titlePage.authors = [];
    const snapshot = createStudentExportSnapshot(
      essay,
      essay.content,
      [reference],
      "en",
    );

    const result = await runStudentTitlePageValidatedExport(
      snapshot,
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
    const essay = completeEssay();
    const snapshot = createStudentExportSnapshot(
      essay,
      essay.content,
      [reference],
      "es",
    );

    const result = await runStudentTitlePageValidatedExport(
      snapshot,
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

  it("uses one detached snapshot for validation and the export callback", async () => {
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

    const result = await runStudentTitlePageValidatedExport(
      snapshot,
      (exportSnapshot) => {
        essay.titlePage.title = "";
        essay.titlePage.authors[0] = "Changed author";
        essay.settings.documentLanguage = "en";
        document.content[0]!.content[0]!.text = "After";
        references[0]!.title = "Changed reference";
        return Promise.resolve(exportSnapshot);
      },
    );

    expect(result).toEqual({
      status: "exported",
      outcome: snapshot,
    });
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

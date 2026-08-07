import {
  buildStudentTitlePage,
  type DocLocale,
  type StudentTitlePageIssue,
} from "@tesina/engine";
import type { TitlePage } from "$lib/model/essay";

export type TitlePageValidationMessageKey =
  | "titlepage_error_missing_title"
  | "titlepage_error_missing_authors"
  | "titlepage_error_missing_affiliations"
  | "titlepage_error_missing_course"
  | "titlepage_error_missing_instructor"
  | "titlepage_error_missing_due_date"
  | "titlepage_error_ambiguous_affiliations";

const MESSAGE_KEY_BY_ISSUE = {
  missingTitle: "titlepage_error_missing_title",
  missingAuthors: "titlepage_error_missing_authors",
  missingAffiliations: "titlepage_error_missing_affiliations",
  missingCourse: "titlepage_error_missing_course",
  missingInstructor: "titlepage_error_missing_instructor",
  missingDueDate: "titlepage_error_missing_due_date",
  ambiguousAffiliations: "titlepage_error_ambiguous_affiliations",
} as const satisfies Record<
  StudentTitlePageIssue,
  TitlePageValidationMessageKey
>;

export interface StudentTitlePageBlockingIssue {
  issue: StudentTitlePageIssue;
  messageKey: TitlePageValidationMessageKey;
}

export function studentTitlePageMessageKey(
  issue: StudentTitlePageIssue,
): TitlePageValidationMessageKey {
  return MESSAGE_KEY_BY_ISSUE[issue];
}

export function firstStudentTitlePageBlockingIssue(
  titlePage: TitlePage,
  locale: DocLocale,
): StudentTitlePageBlockingIssue | null {
  const [issue] = buildStudentTitlePage({
    locale,
    title: titlePage.title,
    authors: titlePage.authors,
    affiliations: titlePage.affiliations,
    course: titlePage.course ?? "",
    instructor: titlePage.instructor ?? "",
    dueDate: titlePage.dueDate ?? "",
  }).issues;

  return issue
    ? { issue, messageKey: studentTitlePageMessageKey(issue) }
    : null;
}

export type ValidatedStudentTitlePageExport<T> =
  | ({ status: "blocked" } & StudentTitlePageBlockingIssue)
  | { status: "exported"; outcome: T };

export async function runStudentTitlePageValidatedExport<T>(
  titlePage: TitlePage,
  locale: DocLocale,
  exportAction: () => Promise<T>,
): Promise<ValidatedStudentTitlePageExport<T>> {
  const blockingIssue = firstStudentTitlePageBlockingIssue(titlePage, locale);
  if (blockingIssue) return { status: "blocked", ...blockingIssue };

  return { status: "exported", outcome: await exportAction() };
}

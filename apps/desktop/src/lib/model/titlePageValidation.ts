import {
  buildStudentTitlePage,
  type DocLocale,
  type Reference,
  type StudentTitlePageIssue,
} from "@tesina/engine";
import type { Essay, TitlePage } from "$lib/model/essay";

export type TitlePageValidationMessageKey =
  | "titlepage_warn_missing_title"
  | "titlepage_warn_missing_authors"
  | "titlepage_warn_missing_affiliations"
  | "titlepage_warn_missing_course"
  | "titlepage_warn_missing_instructor"
  | "titlepage_warn_missing_due_date"
  | "titlepage_warn_ambiguous_affiliations";

const MESSAGE_KEY_BY_ISSUE = {
  missingTitle: "titlepage_warn_missing_title",
  missingAuthors: "titlepage_warn_missing_authors",
  missingAffiliations: "titlepage_warn_missing_affiliations",
  missingCourse: "titlepage_warn_missing_course",
  missingInstructor: "titlepage_warn_missing_instructor",
  missingDueDate: "titlepage_warn_missing_due_date",
  ambiguousAffiliations: "titlepage_warn_ambiguous_affiliations",
} as const satisfies Record<
  StudentTitlePageIssue,
  TitlePageValidationMessageKey
>;

/**
 * One APA shortfall on the student title page. Advisory only: the engine
 * states what APA asks for, and every surface presents it as guidance. No
 * title-page state stops an export.
 */
export interface StudentTitlePageWarning {
  issue: StudentTitlePageIssue;
  messageKey: TitlePageValidationMessageKey;
}

export interface StudentExportSnapshot {
  readonly essay: Essay;
  readonly document: unknown;
  readonly references: Reference[];
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createStudentExportSnapshot(
  essay: Essay,
  document: unknown,
  references: readonly Reference[],
  documentLanguage: DocLocale,
): StudentExportSnapshot {
  const documentSnapshot = cloneJson(document);
  return {
    essay: {
      ...essay,
      settings: {
        ...essay.settings,
        documentLanguage,
        variant: "student",
      },
      titlePage: {
        ...essay.titlePage,
        authors: [...essay.titlePage.authors],
        affiliations: [...essay.titlePage.affiliations],
      },
      content: documentSnapshot,
      referencesSnapshot: cloneJson(essay.referencesSnapshot),
    },
    document: documentSnapshot,
    references: cloneJson([...references]),
  };
}

export function studentTitlePageMessageKey(
  issue: StudentTitlePageIssue,
): TitlePageValidationMessageKey {
  return MESSAGE_KEY_BY_ISSUE[issue];
}

/** Every APA shortfall, in the engine's deterministic title-page order. */
export function studentTitlePageWarnings(
  titlePage: TitlePage,
  locale: DocLocale,
): StudentTitlePageWarning[] {
  return buildStudentTitlePage({
    locale,
    title: titlePage.title,
    authors: titlePage.authors,
    affiliations: titlePage.affiliations,
    course: titlePage.course ?? "",
    instructor: titlePage.instructor ?? "",
    dueDate: titlePage.dueDate ?? "",
  }).issues.map((issue) => ({
    issue,
    messageKey: studentTitlePageMessageKey(issue),
  }));
}

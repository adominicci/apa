import { getTerms } from "../locale/index.ts";
import type { DocLocale } from "../locale/terms.ts";

export type StudentTitlePageIssue =
  | "missingTitle"
  | "missingAuthors"
  | "missingAffiliations"
  | "missingCourse"
  | "missingInstructor"
  | "missingDueDate"
  | "ambiguousAffiliations";

export interface StudentTitlePageInput {
  locale: DocLocale;
  title: string;
  authors: readonly string[];
  affiliations: readonly string[];
  course: string;
  instructor: string;
  dueDate: string;
}

export interface StudentTitlePageAuthor {
  name: string;
  affiliationNumbers: readonly number[];
}

export interface StudentTitlePageAffiliation {
  name: string;
  number?: number;
}

export type StudentTitlePageAuthorLineToken =
  | { kind: "text"; text: string }
  | { kind: "superscript"; text: string };

export interface StudentTitlePageByline {
  authors: readonly StudentTitlePageAuthor[];
  affiliations: readonly StudentTitlePageAffiliation[];
  authorLine: readonly StudentTitlePageAuthorLineToken[];
}

export interface StudentTitlePageResult {
  issues: readonly StudentTitlePageIssue[];
  byline: StudentTitlePageByline;
}

function nonEmpty(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter((value) =>
    value.length > 0
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isSupportedAffiliationMapping(
  authorCount: number,
  affiliationCount: number,
): boolean {
  return affiliationCount === 1 || affiliationCount === authorCount;
}

function authorSeparator(
  index: number,
  authors: readonly StudentTitlePageAuthor[],
  locale: DocLocale,
): string {
  if (index === 0) return "";
  if (index < authors.length - 1) return ", ";

  const terms = getTerms(locale);
  const conjunction = terms.andBefore(terms.andNarrative, authors[index]!.name);
  const comma = terms.serialCommaBeforeAnd && authors.length > 2 ? "," : "";
  return `${comma} ${conjunction} `;
}

function buildAuthorLine(
  authors: readonly StudentTitlePageAuthor[],
  locale: DocLocale,
): StudentTitlePageAuthorLineToken[] {
  return authors.flatMap((author, index) => {
    const separator = authorSeparator(index, authors, locale);
    return [
      ...(separator ? [{ kind: "text" as const, text: separator }] : []),
      { kind: "text" as const, text: author.name },
      ...author.affiliationNumbers.map((number) => ({
        kind: "superscript" as const,
        text: String(number),
      })),
    ];
  });
}

export function buildStudentTitlePage(
  input: StudentTitlePageInput,
): StudentTitlePageResult {
  const authors = nonEmpty(input.authors);
  const affiliations = nonEmpty(input.affiliations);
  const issues: StudentTitlePageIssue[] = [];

  if (!input.title.trim()) issues.push("missingTitle");
  if (authors.length === 0) issues.push("missingAuthors");
  if (affiliations.length === 0) issues.push("missingAffiliations");
  if (!input.course.trim()) issues.push("missingCourse");
  if (!input.instructor.trim()) issues.push("missingInstructor");
  if (!input.dueDate.trim()) issues.push("missingDueDate");

  const supported = authors.length > 0 && affiliations.length > 0 &&
    isSupportedAffiliationMapping(authors.length, affiliations.length);
  if (authors.length > 0 && affiliations.length > 0 && !supported) {
    issues.push("ambiguousAffiliations");
  }

  const uniqueAffiliations = unique(affiliations);
  const useAffiliationNumbers = supported && uniqueAffiliations.length > 1;
  const affiliationNumbers = new Map(
    uniqueAffiliations.map((name, index) => [name, index + 1]),
  );
  const bylineAuthors = authors.map((name, index) => ({
    name,
    affiliationNumbers: useAffiliationNumbers
      ? [affiliationNumbers.get(affiliations[index]!)!]
      : [],
  }));

  return {
    issues,
    byline: {
      authors: bylineAuthors,
      affiliations: uniqueAffiliations.map((name) =>
        useAffiliationNumbers
          ? { name, number: affiliationNumbers.get(name)! }
          : { name }
      ),
      authorLine: buildAuthorLine(bylineAuthors, input.locale),
    },
  };
}

import { m } from "$lib/paraglide/messages";
import type { TitlePageValidationMessageKey } from "$lib/model/titlePageValidation";

const MESSAGES: Record<TitlePageValidationMessageKey, () => string> = {
  titlepage_warn_missing_title: m.titlepage_warn_missing_title,
  titlepage_warn_missing_authors: m.titlepage_warn_missing_authors,
  titlepage_warn_missing_affiliations: m.titlepage_warn_missing_affiliations,
  titlepage_warn_missing_course: m.titlepage_warn_missing_course,
  titlepage_warn_missing_instructor: m.titlepage_warn_missing_instructor,
  titlepage_warn_missing_due_date: m.titlepage_warn_missing_due_date,
  titlepage_warn_ambiguous_affiliations:
    m.titlepage_warn_ambiguous_affiliations,
};

/** UI-locale text for a title-page validation issue (chrome surface). */
export function localizeTitlePageValidation(
  key: TitlePageValidationMessageKey,
): string {
  return MESSAGES[key]();
}

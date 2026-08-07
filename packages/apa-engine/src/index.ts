// Rich text
export {
  mergeRuns,
  plainText,
  type RichRun,
  runsFromMarkup,
  runsToMarkup,
} from "./richtext.ts";

// Model
export type {
  APADate,
  Artwork,
  Book,
  BookChapter,
  Contributor,
  Film,
  JournalArticle,
  Music,
  Preprint,
  Reference,
  ReferenceType,
  TVEpisode,
  UnpublishedWork,
  Website,
} from "./model/reference.ts";
export type {
  CitationAttrs,
  CitationItem,
  CitationLocator,
} from "./model/citation.ts";

// Locale
export { getTerms, terms } from "./locale/index.ts";
export type { DocLocale, LocaleTerms } from "./locale/terms.ts";

// Student title pages
export {
  buildStudentTitlePage,
  type StudentTitlePageAffiliation,
  type StudentTitlePageAuthor,
  type StudentTitlePageAuthorLineToken,
  type StudentTitlePageByline,
  type StudentTitlePageInput,
  type StudentTitlePageIssue,
  type StudentTitlePageResult,
} from "./paper/student-title-page.ts";

// Reference list
export {
  assignYearSuffixes,
  buildReferenceList,
  formatReferenceEntry,
  type ReferenceListResult,
  type RefListContext,
} from "./reference-list.ts";
export { compareReferences, sortReferences, titleSortKey } from "./sort.ts";

// In-text citations
export {
  buildCitationContext,
  type CitationContext,
  contextFor,
  type PerRefContext,
} from "./disambiguate.ts";
export { formatCitation, type FormatCitationOptions } from "./intext.ts";

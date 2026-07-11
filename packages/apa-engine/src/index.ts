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
  Book,
  BookChapter,
  Contributor,
  JournalArticle,
  Reference,
  ReferenceType,
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

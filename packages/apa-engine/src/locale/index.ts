import { en } from "./en.ts";
import { es } from "./es.ts";
import type { DocLocale, LocaleTerms } from "./terms.ts";

export type { DocLocale, LocaleTerms };

export const terms: Record<DocLocale, LocaleTerms> = { en, es };

export function getTerms(locale: DocLocale): LocaleTerms {
  return terms[locale];
}

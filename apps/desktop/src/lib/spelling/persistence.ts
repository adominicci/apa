import type { DocLocale } from "@tesina/engine";
import type { Essay, EssaySpelling } from "$lib/model/essay";
import {
  addCanonicalTerm,
  canonicalizeStoredTerms,
  isCanonicalStoredTerms,
} from "./canonicalTerms.ts";

function languageTerms(
  spelling: EssaySpelling | undefined,
  language: DocLocale,
) {
  return spelling?.documentIgnores?.[language] ?? [];
}

export function effectiveDocumentIgnores(
  essay: Essay,
  language: DocLocale,
): string[] {
  return canonicalizeStoredTerms(
    languageTerms(essay.spelling, language),
    language,
  );
}

export function sanitizeEssaySpelling(essay: Essay): Essay {
  if (essay.spelling === undefined) return essay;
  if (
    essay.spelling === null || typeof essay.spelling !== "object" ||
    Array.isArray(essay.spelling)
  ) {
    return { ...essay, spelling: { documentIgnores: {} } };
  }
  const raw = essay.spelling.documentIgnores;
  const en = canonicalizeStoredTerms(raw?.en, "en");
  const es = canonicalizeStoredTerms(raw?.es, "es");
  return {
    ...essay,
    spelling: {
      documentIgnores: {
        ...(en.length > 0 ? { en } : {}),
        ...(es.length > 0 ? { es } : {}),
      },
    },
  };
}

export function assertCanonicalEssaySpelling(essay: Essay): void {
  if (essay.spelling === undefined) return;
  if (
    typeof essay.spelling !== "object" || essay.spelling === null ||
    Array.isArray(essay.spelling)
  ) throw new Error("malformed essay.spelling");
  const ignores = essay.spelling.documentIgnores;
  if (
    ignores === undefined
  ) return;
  if (
    typeof ignores !== "object" || ignores === null || Array.isArray(ignores) ||
    (ignores.en !== undefined && !isCanonicalStoredTerms(ignores.en, "en")) ||
    (ignores.es !== undefined && !isCanonicalStoredTerms(ignores.es, "es"))
  ) throw new Error("malformed essay.spelling.documentIgnores.en or .es");
}

export function addDocumentIgnore(
  essay: Essay,
  candidate: unknown,
  language: DocLocale,
) {
  const current = effectiveDocumentIgnores(essay, language);
  const result = addCanonicalTerm(current, candidate, language);
  if (result.status !== "added") return result;
  const other = language === "en" ? "es" : "en";
  const otherTerms = effectiveDocumentIgnores(essay, other);
  essay.spelling = {
    documentIgnores: {
      ...(language === "en" ? { en: result.terms } : { es: result.terms }),
      ...(otherTerms.length > 0
        ? (other === "en" ? { en: otherTerms } : { es: otherTerms })
        : {}),
    },
  };
  return result;
}

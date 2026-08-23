import type { DocLocale } from "@tesina/engine";
import {
  addCanonicalTerm,
  canonicalizeStoredTerms,
  canonicalizeTerm,
  MAX_SPELLING_TERMS,
} from "$lib/spelling/canonicalTerms";
import type {
  DeviceSpellingSettings,
  DictionaryMutationStatus,
  SpellingSettingsState,
} from "$lib/spelling/settingsAddon";

export function loadSpellingSettings(value: unknown): SpellingSettingsState {
  const raw = value !== null && typeof value === "object" &&
      !Array.isArray(value)
    ? value as DeviceSpellingSettings
    : undefined;
  return {
    enabled: typeof raw?.enabled === "boolean" ? raw.enabled : true,
    personalDictionaries: {
      en: canonicalizeStoredTerms(raw?.personalDictionaries?.en, "en"),
      es: canonicalizeStoredTerms(raw?.personalDictionaries?.es, "es"),
    },
  };
}

export function serializeSpellingSettings(
  state: SpellingSettingsState,
): DeviceSpellingSettings {
  return {
    enabled: state.enabled,
    personalDictionaries: {
      ...(state.personalDictionaries.en.length > 0
        ? { en: [...state.personalDictionaries.en] }
        : {}),
      ...(state.personalDictionaries.es.length > 0
        ? { es: [...state.personalDictionaries.es] }
        : {}),
    },
  };
}

export function addPersonalTerm(
  state: SpellingSettingsState,
  candidate: unknown,
  language: DocLocale,
): DictionaryMutationStatus {
  const result = addCanonicalTerm(
    state.personalDictionaries[language],
    candidate,
    language,
  );
  if (result.status === "added") {
    state.personalDictionaries = {
      ...state.personalDictionaries,
      [language]: result.terms,
    };
  }
  return result.status;
}

export function replacePersonalDictionary(
  state: SpellingSettingsState,
  language: DocLocale,
  terms: unknown,
): boolean {
  if (!Array.isArray(terms)) return false;
  const canonicalTerms: string[] = [];
  const keys = new Set<string>();
  for (const candidate of terms) {
    const canonical = canonicalizeTerm(candidate, language);
    if (!canonical) return false;
    if (keys.has(canonical.key)) continue;
    if (canonicalTerms.length >= MAX_SPELLING_TERMS) return false;
    keys.add(canonical.key);
    canonicalTerms.push(canonical.display);
  }
  state.personalDictionaries = {
    ...state.personalDictionaries,
    [language]: canonicalTerms,
  };
  return true;
}

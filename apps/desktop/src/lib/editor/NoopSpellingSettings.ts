import type { DocLocale } from "@tesina/engine";
import type {
  DeviceSpellingSettings,
  DictionaryMutationStatus,
  SpellingSettingsState,
} from "$lib/spelling/settingsAddon";

export function loadSpellingSettings(value: unknown): SpellingSettingsState {
  return {
    enabled: true,
    personalDictionaries: { en: [], es: [] },
    ...(value === undefined ? {} : { preservedSerializedValue: value }),
  };
}

export function serializeSpellingSettings(
  state: SpellingSettingsState,
): DeviceSpellingSettings | unknown | undefined {
  return state.preservedSerializedValue;
}

export function addPersonalTerm(
  _state: SpellingSettingsState,
  _candidate: unknown,
  _language: DocLocale,
): DictionaryMutationStatus {
  return "invalid";
}

export function replacePersonalDictionary(
  _state: SpellingSettingsState,
  _language: DocLocale,
  _terms: unknown,
): boolean {
  return false;
}

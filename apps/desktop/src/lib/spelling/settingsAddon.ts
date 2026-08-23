import type { DocLocale } from "@tesina/engine";

export interface DeviceSpellingSettings {
  enabled?: boolean;
  personalDictionaries?: {
    en?: string[];
    es?: string[];
  };
}

export interface SpellingSettingsState {
  enabled: boolean;
  personalDictionaries: Record<DocLocale, string[]>;
  /** Opaque value retained by the ordinary compile-time adapter only. */
  preservedSerializedValue?: unknown;
}

export type DictionaryMutationStatus =
  | "added"
  | "duplicate"
  | "invalid"
  | "overflow";

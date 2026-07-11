import { readJson, writeJsonAtomic } from "$lib/persist/atomic";
import { overwriteGetLocale } from "$lib/paraglide/runtime";

const SETTINGS_FILE = "settings.json";

export type UiLanguage = "es" | "en";

interface AppSettings {
  schemaVersion: 1;
  uiLanguage?: UiLanguage;
}

/**
 * UI-chrome language (Paraglide axis) — deliberately independent from each
 * essay's document language (engine axis, plan §i18n rule). Persisted in the
 * global $APPDATA/settings.json. Components re-render via the {#key} wrapper
 * in the page shell.
 */
class UiLocaleStore {
  current = $state<UiLanguage>("es");
  loaded = $state(false);

  constructor() {
    overwriteGetLocale(() => this.current);
  }

  async load(): Promise<void> {
    try {
      const settings = await readJson<AppSettings>(SETTINGS_FILE);
      if (settings?.uiLanguage) this.current = settings.uiLanguage;
    } catch (err) {
      console.error("No se pudo cargar settings.json:", err);
    } finally {
      this.loaded = true;
    }
  }

  set(language: UiLanguage): void {
    if (this.current === language) return;
    this.current = language;
    writeJsonAtomic(
      SETTINGS_FILE,
      {
        schemaVersion: 1,
        uiLanguage: language,
      } satisfies AppSettings,
    ).catch((err) => {
      console.error("No se pudo guardar settings.json:", err);
    });
  }
}

export const uiLocale = new UiLocaleStore();

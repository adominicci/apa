import { readJson, writeJsonAtomic } from "$lib/persist/atomic";
import { overwriteGetLocale } from "$lib/paraglide/runtime";
import {
  DEFAULT_DOCK,
  parseDock,
  type ToolbarDock,
} from "$lib/state/toolbarDock";

const SETTINGS_FILE = "settings.json";

export type UiLanguage = "es" | "en";
export type UiTheme = "system" | "light" | "dark";

interface AppSettings {
  schemaVersion: 1;
  uiLanguage?: UiLanguage;
  uiTheme?: UiTheme;
  /** Opcional: un settings.json previo a esta feature cae en DEFAULT_DOCK. */
  toolbarDock?: ToolbarDock;
}

/**
 * Global app settings: UI-chrome language (Paraglide axis — deliberately
 * independent from each essay's document language) and theme. One store
 * owns $APPDATA/settings.json so the fields never clobber each other.
 * Components re-render on language via the {#key} wrapper in the shell;
 * the theme applies via data-theme on <html> (see +layout.svelte).
 */
class UiSettingsStore {
  current = $state<UiLanguage>("es");
  theme = $state<UiTheme>("system");
  dock = $state<ToolbarDock>(DEFAULT_DOCK);
  loaded = $state(false);

  constructor() {
    overwriteGetLocale(() => this.current);
  }

  async load(): Promise<void> {
    try {
      const settings = await readJson<AppSettings>(SETTINGS_FILE);
      if (settings?.uiLanguage) this.current = settings.uiLanguage;
      if (settings?.uiTheme) this.theme = settings.uiTheme;
      this.dock = parseDock(settings?.toolbarDock);
    } catch (err) {
      console.error("No se pudo cargar settings.json:", err);
    } finally {
      this.loaded = true;
    }
  }

  #persist(): void {
    writeJsonAtomic(
      SETTINGS_FILE,
      {
        schemaVersion: 1,
        uiLanguage: this.current,
        uiTheme: this.theme,
        toolbarDock: this.dock,
      } satisfies AppSettings,
    ).catch((err) => {
      console.error("No se pudo guardar settings.json:", err);
    });
  }

  set(language: UiLanguage): void {
    if (this.current === language) return;
    this.current = language;
    this.#persist();
  }

  setTheme(theme: UiTheme): void {
    if (this.theme === theme) return;
    this.theme = theme;
    this.#persist();
  }

  setDock(dock: ToolbarDock): void {
    if (this.dock === dock) return;
    this.dock = dock;
    this.#persist();
  }

  /** Cycle light → dark → system → light (one button, three states). */
  cycleTheme(): void {
    const order: UiTheme[] = ["light", "dark", "system"];
    const next = order[(order.indexOf(this.theme) + 1) % order.length]!;
    this.setTheme(next);
  }
}

export const uiLocale = new UiSettingsStore();
